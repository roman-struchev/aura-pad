import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { MonacoBinding } from 'y-monaco'
import { WorkTogetherProvider, type WorkTogetherProviderStatus } from '../lib/workTogether/provider'
import { alertDialog } from '../lib/dialogs'
import type {
  WorkTogetherLink,
  WorkTogetherLinkRole,
  WorkTogetherParticipant,
  WorkTogetherResumableSession
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
  // Set while bindEntryModel is waiting for a resumed session's empty doc to
  // receive its first update before binding it (see there). Must be invoked
  // from disposeEntry if the session is stopped mid-wait, or the update
  // listener would leak past the doc's destruction.
  cancelPendingBind?: () => void
}

function disposeEntry(entry: SessionEntry): void {
  entry.cancelPendingBind?.()
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

// Binds a session's Yjs text to its tab's Monaco model, if that model exists
// yet and isn't already bound (or pending). Split out from
// ensureSession/resumeSession because a resumed session's path often has no
// live model at mount time - the model only comes into existence once that
// tab is actually the active one (see App.tsx's notifyActivePath effect on
// tabs.selectedPath) - so the same bind attempt has to be retried later, not
// just made once at creation.
function bindEntryModel(
  path: string,
  entry: SessionEntry,
  editors: Set<monaco.editor.IStandaloneCodeEditor>
): void {
  if (entry.binding || entry.cancelPendingBind) return
  const model = monaco.editor.getModel(monaco.Uri.parse(path))
  if (!model) return

  // Doc already has content (ensureSession seeded it, or a snapshot/sync has
  // already arrived): y-monaco's constructor finds model === ytext (or fills
  // an empty model) and binds cleanly.
  if (entry.doc.getText('monaco').length > 0) {
    entry.binding = new MonacoBinding(entry.doc.getText('monaco'), model, editors, entry.awareness)
    return
  }

  // A resumed session starts with an empty doc (see resumeSession). Binding it
  // now would let y-monaco's constructor force the model to '' to match the
  // empty ytext, blanking a tab that already shows its real on-disk content.
  // Instead wait for the doc's first update - the backend replays its cached
  // full-state snapshot right after we connect (specification.md §4.4), and a
  // live peer's sync would do the same - and bind then, so the model keeps
  // showing its current content until real state actually arrives. No timeout
  // fallback: as long as the session is alive server-side (resumeSession
  // already confirmed that via workTogetherGetStatus), the backend has a
  // snapshot to send, so this fires promptly; if it somehow never does, the
  // tab stays on its real content rather than being blanked.
  const onFirstUpdate = (): void => {
    entry.cancelPendingBind?.()
    if (entry.binding) return
    const liveModel = monaco.editor.getModel(monaco.Uri.parse(path))
    if (!liveModel) return
    entry.binding = new MonacoBinding(
      entry.doc.getText('monaco'),
      liveModel,
      editors,
      entry.awareness
    )
  }
  entry.doc.on('update', onFirstUpdate)
  entry.cancelPendingBind = () => {
    entry.doc.off('update', onFirstUpdate)
    entry.cancelPendingBind = undefined
  }
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
  // Called whenever a tab becomes the active one (App.tsx, keyed on
  // tabs.selectedPath) - lets a resumed session whose Monaco model didn't
  // exist yet at reconnect time bind to it once the tab is actually opened.
  notifyActivePath: (path: string) => void
}

// Owns every currently-shared tab's live collaboration state: one Yjs
// session (doc + awareness + backend connection) per shared path, bound into
// that tab's already-open Monaco model via y-monaco. Tabs that were never
// shared cost nothing - a session only comes into existence on the first
// `share()` call for a given path.
//
// Sessions outlive this hook's own lifetime: quitting/reloading AuraPad
// doesn't end them server-side (specification.md §2), so their
// sessionId/hostToken/links are persisted (see persistSession/forgetSession
// below) and reconnected to - not re-created - on next launch (resumeSession).
export interface UseWorkTogetherOptions {
  // The extension's Settings flag. Nothing connects while it's off: the
  // resume pass below is skipped, and any session still live when it's
  // switched off is torn down locally.
  enabled: boolean
  // `enabled` is only the user's own choice once the persisted settings have
  // arrived (it starts out as its DEFAULT_SETTINGS value) - the resume pass
  // waits for this so it can't run against the default.
  settingsLoaded: boolean
  backendUrl: string
  displayName: string
}

export function useWorkTogether({
  enabled,
  settingsLoaded,
  backendUrl,
  displayName
}: UseWorkTogetherOptions): UseWorkTogetherResult {
  const [view, setView] = useState<Record<string, WorkTogetherSessionView>>({})
  // Backs isSharing. Kept separate from `view` (which also changes on every
  // participant/status patch, e.g. a remote cursor moving) so that a
  // TabBar/FileTree badge bound to isSharing only re-renders when a path is
  // actually added to or removed from sharing, not on every awareness tick.
  const [sharedPaths, setSharedPaths] = useState<ReadonlySet<string>>(new Set())
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
          joinedAt: '',
          color: user.color || colorForClient(clientId)
        })
      })
      patchView(path, { participants })
    },
    [patchView]
  )

  // Keeps the on-disk resume record for `path` in sync with its current
  // entry (sessionId/hostToken never change after creation, but `links` does
  // on every mint/revoke) - read-modify-write against the whole file, same as
  // useTabs' openTabs.json, since writes only ever happen one user action at
  // a time.
  const persistSession = useCallback(async (path: string): Promise<void> => {
    const entry = sessionsRef.current.get(path)
    if (!entry) return
    const state = await window.api.getWorkTogetherResumeState()
    const sessions = state.sessions.filter((s) => s.path !== path)
    sessions.push({
      path,
      backendUrl: entry.backendUrl,
      sessionId: entry.sessionId,
      hostToken: entry.hostToken,
      links: entry.links
    })
    await window.api.saveWorkTogetherResumeState({ sessions })
  }, [])

  const forgetSession = useCallback(async (path: string): Promise<void> => {
    const state = await window.api.getWorkTogetherResumeState()
    await window.api.saveWorkTogetherResumeState({
      sessions: state.sessions.filter((s) => s.path !== path)
    })
  }, [])

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
      // Clear any prior closedReason once we're back up: the provider now
      // auto-reconnects after a transient drop, and a stale reason must not
      // outlive the reconnection.
      provider.onStatus = (status) =>
        patchView(path, status === 'connected' ? { status, closedReason: null } : { status })
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
      await persistSession(path)
      setSharedPaths((prev) => new Set(prev).add(path))
      patchView(path, { status: 'connecting', links: [], participants: [], closedReason: null })

      const connectResult = await provider.connect(backendUrl, created.data.hostToken)
      if (!connectResult.success) return { entry, error: connectResult.error }
      return { entry }
    },
    [backendUrl, displayName, patchView, refreshParticipants, persistSession]
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
        entry.backendUrl,
        entry.sessionId,
        entry.hostToken,
        role,
        ttlSeconds
      )
      if (!minted.success) return { error: minted.error }
      entry.links.push(minted.data)
      await persistSession(path)
      patchView(path, { links: [...entry.links] })
      return { link: minted.data }
    },
    [ensureSession, patchView, persistSession]
  )

  const revokeLink = useCallback(
    async (path: string, linkId: string): Promise<void> => {
      const entry = sessionsRef.current.get(path)
      if (!entry) return
      await window.api.workTogetherRevokeLink(
        entry.backendUrl,
        entry.sessionId,
        entry.hostToken,
        linkId
      )
      entry.links = entry.links.filter((l) => l.linkId !== linkId)
      await persistSession(path)
      patchView(path, { links: [...entry.links] })
    },
    [patchView, persistSession]
  )

  const stop = useCallback(
    async (path: string): Promise<void> => {
      const entry = sessionsRef.current.get(path)
      if (!entry) return
      sessionsRef.current.delete(path)
      setView((prev) => {
        const next = { ...prev }
        delete next[path]
        return next
      })
      setSharedPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
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
      const ended = await window.api.workTogetherEndSession(
        entry.backendUrl,
        entry.sessionId,
        entry.hostToken
      )
      // The persisted record is only dropped once the backend confirms the
      // session is gone. If the call failed (offline, backend down), the
      // session - and every link minted for it - is still live server-side,
      // so forgetting it here would leave it running with no way back to it.
      // Keeping the record means the next launch reconnects to it and "Stop
      // Sharing" can be retried; say so instead of silently implying the
      // share was closed.
      if (ended.success) {
        await forgetSession(path)
      } else {
        await alertDialog(
          `Stopped sharing locally, but the session could not be ended on the server (${ended.error}). Existing links stay live until they expire - AuraPad will reconnect to this session on the next launch so you can stop it again.`
        )
      }
    },
    [forgetSession]
  )

  // Local-only teardown of every still-live session on unmount (app close,
  // reload, or the feature getting disabled mid-session) - unlike stop(),
  // this must NOT end the session server-side: per specification.md §2 the
  // session outlives the Host's connection, and that's exactly what makes
  // resumeSession below able to reconnect to it (not re-create it, which
  // would mint a new sessionId/hostToken and orphan any links already handed
  // out) on the next launch. Only disconnects the socket and drops the local
  // Yjs/MonacoBinding objects, which can't survive a reload anyway.
  useEffect(() => {
    // Same Map object for the lifetime of this hook (only ever mutated via
    // .set/.delete, never reassigned) - aliased here so the cleanup reads it
    // through a plain variable rather than `.current`, without changing
    // which sessions it actually sees at unmount time.
    const sessions = sessionsRef.current
    return () => {
      for (const entry of sessions.values()) {
        disposeEntry(entry)
      }
      sessions.clear()
    }
  }, [])

  // Reconnects to a session that was still live when AuraPad last quit or
  // reloaded (see persistSession/the effect below). Deliberately does not
  // seed the Yjs doc from local content the way ensureSession does for a
  // brand-new session: unlike a fresh share, a resumed session may have been
  // edited by a still-connected guest while this Host was away, so an empty
  // doc brought up to date by the backend's replayed snapshot (or a live
  // peer's sync) is what reflects the true current state - exactly like a
  // guest joining fresh. Seeding it here too would insert a second,
  // independent copy of the text once the real state merges in. bindEntryModel
  // holds off binding this empty doc until that first update lands, so the tab
  // keeps showing its on-disk content in the meantime rather than blanking.
  const resumeSession = useCallback(
    async (persisted: WorkTogetherResumableSession): Promise<void> => {
      if (sessionsRef.current.has(persisted.path)) return

      // Confirms the session is still alive server-side (not ended, not all
      // links expired/revoked) before spending a WS handshake on it, and
      // gives us a byte-for-byte reason to drop the stale record rather than
      // silently retrying it forever if it's gone.
      const status = await window.api.workTogetherGetStatus(
        persisted.backendUrl,
        persisted.sessionId,
        persisted.hostToken
      )
      if (!status.success) {
        await forgetSession(persisted.path)
        return
      }

      // The status endpoint reports which of this client's own minted links
      // are still valid, but never re-exposes a link's token/url (see the
      // WorkTogetherResumableSession doc comment) - so cross-reference by id
      // to drop anything revoked/expired, keeping the rest from `persisted`.
      const liveById = new Map(status.data.links.map((l) => [l.linkId, l]))
      const links = persisted.links.filter((l) => {
        const live = liveById.get(l.linkId)
        return !!live && !live.revoked && new Date(live.expiresAt).getTime() > Date.now()
      })

      const doc = new Y.Doc()
      const awareness = new Awareness(doc)
      awareness.setLocalState({
        user: { name: displayName || 'Host', color: colorForClient(doc.clientID) },
        role: 'host'
      })

      const provider = new WorkTogetherProvider(persisted.sessionId, doc, awareness)
      provider.onStatus = (s) =>
        patchView(
          persisted.path,
          s === 'connected' ? { status: s, closedReason: null } : { status: s }
        )
      provider.onClosed = (code, reason) =>
        patchView(persisted.path, { closedReason: reason || `connection closed (code ${code})` })
      const onAwarenessChange = (): void => refreshParticipants(persisted.path, awareness, doc)
      awareness.on('change', onAwarenessChange)

      const entry: SessionEntry = {
        sessionId: persisted.sessionId,
        hostToken: persisted.hostToken,
        backendUrl: persisted.backendUrl,
        doc,
        awareness,
        onAwarenessChange,
        provider,
        binding: null,
        links
      }
      sessionsRef.current.set(persisted.path, entry)
      setSharedPaths((prev) => new Set(prev).add(persisted.path))
      // The tab (and its Monaco model) this session belongs to may not be
      // open at all yet - notifyActivePath retries this once it is.
      bindEntryModel(persisted.path, entry, editorsRef.current)
      patchView(persisted.path, {
        status: 'connecting',
        links,
        participants: [],
        closedReason: null
      })

      await provider.connect(persisted.backendUrl, persisted.hostToken)
    },
    [displayName, patchView, refreshParticipants, forgetSession]
  )

  // Guards against React 18 StrictMode's double-invoked mount effects (dev
  // only) starting two overlapping reconnect passes over the same persisted
  // list - same pattern as useTabs' restoreStartedRef.
  const resumeStartedRef = useRef(false)
  useEffect(() => {
    // Nothing reconnects until the real settings are in and the extension is
    // actually on: a disabled extension used to still resume every persisted
    // session on launch, quietly relaying the file's contents to the backend
    // with no UI anywhere to reveal it. Not once-only by ref alone, so
    // switching the extension on mid-session picks the sessions up too.
    if (!settingsLoaded || !enabled) return
    if (resumeStartedRef.current) return
    resumeStartedRef.current = true
    ;(async () => {
      const state = await window.api.getWorkTogetherResumeState()
      for (const persisted of state.sessions) {
        await resumeSession(persisted)
      }
    })()
  }, [settingsLoaded, enabled, resumeSession])

  // Switched off mid-session: drop every live session locally (socket,
  // provider, Yjs doc, MonacoBinding) so nothing is relayed while the
  // extension is off. Deliberately local-only, exactly like the unmount
  // teardown above - the sessions stay alive server-side (§2) and their
  // persisted records are kept, so switching the extension back on (or the
  // next launch) reconnects to them rather than orphaning links that were
  // already handed out. Ending them for good is what "Stop Sharing" is for.
  useEffect(() => {
    if (enabled) return
    resumeStartedRef.current = false
    if (sessionsRef.current.size === 0) return
    for (const entry of sessionsRef.current.values()) disposeEntry(entry)
    sessionsRef.current.clear()
    // Deferred out of the effect body: setting state synchronously from an
    // effect is what react-hooks/set-state-in-effect forbids (same pattern as
    // useTabs' extension-tab reconciliation).
    void Promise.resolve().then(() => {
      setView({})
      setSharedPaths(new Set())
    })
  }, [enabled])

  const notifyActivePath = useCallback((path: string): void => {
    const entry = sessionsRef.current.get(path)
    if (entry) bindEntryModel(path, entry, editorsRef.current)
  }, [])

  // Backed by `sharedPaths` (React state), not a plain read of the
  // sessionsRef map: TabBar/FileTree/Sidebar's isPathShared badges are
  // memoized components, and a ref mutation alone doesn't change any of
  // their props, so it would never actually trigger the re-render that reads
  // the new value.
  const isSharing = useCallback((path: string): boolean => sharedPaths.has(path), [sharedPaths])

  return {
    sessions: view,
    registerEditor,
    share,
    revokeLink,
    stop,
    isSharing,
    notifyActivePath
  }
}
