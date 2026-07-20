import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { MonacoBinding } from 'y-monaco'
import { WorkTogetherProvider, type WorkTogetherProviderStatus } from '../lib/workTogether/provider'
import type {
  WorkTogetherLink,
  WorkTogetherLinkRole,
  WorkTogetherParticipant
} from '../../../shared/workTogether'

// Ceiling requested when a session is created (specification.md §3.1's
// maxTtlSeconds) - a cap on how long any link minted for it can live, not how
// long the session itself is guaranteed to be kept around. Must cover the
// longest option ShareDialog offers (30 days).
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60

const PARTICIPANT_COLORS = ['#5B8DEF', '#E2574C', '#2FBF71', '#F5A623', '#9B59B6', '#1ABC9C']
const colorForClient = (clientId: number): string =>
  PARTICIPANT_COLORS[clientId % PARTICIPANT_COLORS.length]

export interface WorkTogetherSessionView {
  status: WorkTogetherProviderStatus
  links: WorkTogetherLink[]
  participants: WorkTogetherParticipant[]
  closedReason: string | null
}

interface SessionEntry {
  sessionId: string
  hostToken: string
  backendUrl: string
  doc: Y.Doc
  awareness: Awareness
  onAwarenessChange: () => void
  provider: WorkTogetherProvider
  binding: MonacoBinding | null
  links: WorkTogetherLink[]
}

function disposeEntry(entry: SessionEntry): void {
  // Must come before doc.destroy(): y-protocols' Awareness registers its own
  // `doc.on('destroy', () => this.destroy())`, and Awareness#destroy() calls
  // setLocalState(null) - which fires a synchronous 'change' event - before
  // it clears its own listeners. Left subscribed, our refreshParticipants
  // listener below would still catch that event and patchView() a path
  // already removed from `view`, whose "no entry yet" fallback recreates a
  // stub session there - resurrecting the just-stopped share for
  // isSharing()/the ShareDialog to see on the next open.
  entry.awareness.off('change', entry.onAwarenessChange)
  entry.binding?.destroy()
  entry.provider.destroy()
  entry.doc.destroy()
}

export interface UseWorkTogetherResult {
  sessions: Record<string, WorkTogetherSessionView>
  registerEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void
  share: (
    path: string,
    content: string,
    language: string,
    role: WorkTogetherLinkRole,
    ttlSeconds: number
  ) => Promise<{ link?: WorkTogetherLink; error?: string }>
  revokeLink: (path: string, linkId: string) => Promise<void>
  stop: (path: string) => Promise<void>
  isSharing: (path: string) => boolean
}

// Owns every currently-shared tab's live collaboration state: one Yjs
// session (doc + awareness + backend connection) per shared path, bound into
// that tab's already-open Monaco model via y-monaco. Tabs that were never
// shared cost nothing - a session only comes into existence on the first
// `share()` call for a given path.
export function useWorkTogether(backendUrl: string, displayName: string): UseWorkTogetherResult {
  const [view, setView] = useState<Record<string, WorkTogetherSessionView>>({})
  const sessionsRef = useRef(new Map<string, SessionEntry>())
  // All bindings share this one Set: this app has a single visible Monaco
  // editor instance whose model gets swapped on tab switch (see useTabs.ts),
  // so every session's MonacoBinding can watch the same editor - each one
  // already no-ops its own decoration rendering when that editor's current
  // model isn't the one it owns.
  const editorsRef = useRef(new Set<monaco.editor.IStandaloneCodeEditor>())

  const registerEditor = useCallback((editor: monaco.editor.IStandaloneCodeEditor): void => {
    editorsRef.current.add(editor)
  }, [])

  const patchView = useCallback((path: string, patch: Partial<WorkTogetherSessionView>): void => {
    setView((prev) => {
      const current = prev[path] ?? {
        status: 'connecting',
        links: [],
        participants: [],
        closedReason: null
      }
      return { ...prev, [path]: { ...current, ...patch } }
    })
  }, [])

  const refreshParticipants = useCallback(
    (path: string, awareness: Awareness, doc: Y.Doc): void => {
      const participants: WorkTogetherParticipant[] = []
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return
        const user = (state.user ?? {}) as { name?: string; color?: string }
        participants.push({
          connectionId: String(clientId),
          role: (state.role as WorkTogetherParticipant['role']) ?? 'read',
          displayName: user.name || 'Guest',
          joinedAt: ''
        })
      })
      patchView(path, { participants })
    },
    [patchView]
  )

  const ensureSession = useCallback(
    async (
      path: string,
      content: string,
      language: string
    ): Promise<{ entry: SessionEntry | null; error?: string }> => {
      const existing = sessionsRef.current.get(path)
      if (existing) return { entry: existing }

      const created = await window.api.workTogetherCreateSession(
        backendUrl,
        path,
        language,
        content,
        MAX_TTL_SECONDS
      )
      if (!created.success) return { entry: null, error: created.error }

      const doc = new Y.Doc()
      const awareness = new Awareness(doc)
      awareness.setLocalState({
        user: { name: displayName || 'Host', color: colorForClient(doc.clientID) },
        role: 'host'
      })

      const yText = doc.getText('monaco')
      // The backend never decodes Yjs itself (specification.md §3.1) - the
      // `content` it was just sent is only for the guest page's pre-sync
      // placeholder paint, not an authoritative seed. The real document only
      // exists in participants' own runtimes, so it's this Host's job to
      // seed its own doc to match what's already on screen: the Monaco model
      // already holds this exact text, so the MonacoBinding constructed just
      // below finds them equal and leaves the model (and its undo stack)
      // alone. A joining guest starts from an empty doc and gets the real
      // content via the ordinary sync-step handshake once connected.
      const model = monaco.editor.getModel(monaco.Uri.parse(path))
      // Use the model's actual value, which has already been through Monaco's
      // internal line-ending normalization. `content` from the arg might have
      // \r\n while the model normalized to \n, which would make `yText` and
      // the model have different string lengths and desync CRDT offsets.
      const initialText = model ? model.getValue() : content.replace(/\r\n|\r/g, '\n')
      if (initialText) yText.insert(0, initialText)
      const binding = model ? new MonacoBinding(yText, model, editorsRef.current, awareness) : null

      const provider = new WorkTogetherProvider(created.data.sessionId, doc, awareness)
      provider.onStatus = (status) => patchView(path, { status })
      provider.onClosed = (code, reason) =>
        patchView(path, { closedReason: reason || `connection closed (code ${code})` })
      // Kept as a named reference (not an inline arrow) so disposeEntry can
      // explicitly unsubscribe it - see the comment there for why that
      // matters.
      const onAwarenessChange = (): void => refreshParticipants(path, awareness, doc)
      awareness.on('change', onAwarenessChange)

      const entry: SessionEntry = {
        sessionId: created.data.sessionId,
        hostToken: created.data.hostToken,
        backendUrl,
        doc,
        awareness,
        onAwarenessChange,
        provider,
        binding,
        links: []
      }
      sessionsRef.current.set(path, entry)
      patchView(path, { status: 'connecting', links: [], participants: [], closedReason: null })

      const connectResult = await provider.connect(backendUrl, created.data.hostToken)
      if (!connectResult.success) return { entry, error: connectResult.error }
      return { entry }
    },
    [backendUrl, displayName, patchView, refreshParticipants]
  )

  const share = useCallback(
    async (
      path: string,
      content: string,
      language: string,
      role: WorkTogetherLinkRole,
      ttlSeconds: number
    ): Promise<{ link?: WorkTogetherLink; error?: string }> => {
      const { entry, error } = await ensureSession(path, content, language)
      if (!entry) return { error: error ?? 'Failed to start the session.' }

      const minted = await window.api.workTogetherMintLink(
        backendUrl,
        entry.sessionId,
        entry.hostToken,
        role,
        ttlSeconds
      )
      if (!minted.success) return { error: minted.error }
      entry.links.push(minted.data)
      patchView(path, { links: [...entry.links] })
      return { link: minted.data }
    },
    [backendUrl, ensureSession, patchView]
  )

  const revokeLink = useCallback(
    async (path: string, linkId: string): Promise<void> => {
      const entry = sessionsRef.current.get(path)
      if (!entry) return
      await window.api.workTogetherRevokeLink(backendUrl, entry.sessionId, entry.hostToken, linkId)
      entry.links = entry.links.filter((l) => l.linkId !== linkId)
      patchView(path, { links: [...entry.links] })
    },
    [backendUrl, patchView]
  )

  const stop = useCallback(async (path: string): Promise<void> => {
    const entry = sessionsRef.current.get(path)
    if (!entry) return
    sessionsRef.current.delete(path)
    setView((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
    // Disposed before the end-session round-trip below, not after: destroy()
    // unsubscribes the provider's onStatus/onClosed callbacks synchronously.
    // Awaiting the network call first left them live for however long that
    // took - if the backend dropped the connection while it was in flight
    // (closing the session server-side naturally does), the stale onClosed
    // callback would call patchView() with a path already deleted from
    // `view`, and patchView's "no entry yet" fallback would recreate it -
    // resurrecting a session for the "Stop Sharing" button to appear on.
    disposeEntry(entry)
    await window.api.workTogetherEndSession(entry.backendUrl, entry.sessionId, entry.hostToken)
  }, [])

  // Best-effort teardown of every still-live session on unmount (app close,
  // or the feature getting disabled mid-session) - doesn't block on the
  // end-session round-trip.
  useEffect(() => {
    // Same Map object for the lifetime of this hook (only ever mutated via
    // .set/.delete, never reassigned) - aliased here so the cleanup reads it
    // through a plain variable rather than `.current`, without changing
    // which sessions it actually sees at unmount time.
    const sessions = sessionsRef.current
    return () => {
      for (const entry of sessions.values()) {
        window.api.workTogetherEndSession(entry.backendUrl, entry.sessionId, entry.hostToken)
        disposeEntry(entry)
      }
      sessions.clear()
    }
  }, [])

  const isSharing = useCallback((path: string): boolean => sessionsRef.current.has(path), [])

  return { sessions: view, registerEditor, share, revokeLink, stop, isSharing }
}
