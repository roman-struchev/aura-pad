import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

// Message-type tags match y-websocket's own wire format (see
// docs/edit-together/specification.md §4) - a backend built against the spec
// with an off-the-shelf y-websocket server is drop-in compatible with this
// client, even though the transport underneath isn't a raw browser
// WebSocket (see main/workTogether.ts for why).
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

// Terminal close codes from specification.md §5.1: the session/token is gone
// for good, so reconnecting would just fail forever. Every other close (a
// network drop, a backend restart, an abnormal 1006) is transient and worth
// retrying.
const TERMINAL_CLOSE_CODES = new Set([4001, 4002, 4003, 4004])

// Reconnect backoff: first retry after 1s, doubling up to 30s, then steady.
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export type WorkTogetherProviderStatus = 'connecting' | 'connected' | 'disconnected'

// Bridges a Y.Doc + Awareness instance to the backend through the main
// process's WebSocket relay. Functionally a from-scratch y-websocket-style
// provider: local doc/awareness updates are encoded and forwarded to main via
// `workTogetherSend`; incoming frames (delivered over the per-session
// `onWorkTogetherMessage` event) are decoded and applied. `this` is passed as
// the transaction/update origin on every apply, so the corresponding
// doc/awareness 'update' handlers below can recognize and skip their own
// echoes instead of bouncing a just-received remote change straight back out.
export class WorkTogetherProvider {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness

  onStatus: ((status: WorkTogetherProviderStatus) => void) | null = null
  onClosed: ((code: number, reason: string) => void) | null = null

  private readonly sessionId: string
  private unsubscribeMessage: (() => void) | null = null
  private unsubscribeClosed: (() => void) | null = null
  private connected = false

  // Reconnection state. `backendUrl`/`token` are captured on the first
  // connect() so a later retry can reuse them; `wantConnection` stays true
  // until disconnect()/destroy() or a terminal close, and gates whether a
  // dropped socket schedules a retry.
  private backendUrl = ''
  private token = ''
  private wantConnection = false
  private opening = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(sessionId: string, doc: Y.Doc, awareness: awarenessProtocol.Awareness) {
    this.sessionId = sessionId
    this.doc = doc
    this.awareness = awareness
    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  async connect(backendUrl: string, token: string): Promise<{ success: boolean; error?: string }> {
    this.backendUrl = backendUrl
    this.token = token
    this.wantConnection = true

    // Subscribed once here, not per attempt: the per-session IPC channels are
    // keyed on sessionId (stable across reconnects), and the main process
    // re-points them at each new socket, so resubscribing on every retry would
    // just pile up duplicate listeners.
    this.unsubscribeMessage = window.api.onWorkTogetherMessage(this.sessionId, this.handleMessage)
    this.unsubscribeClosed = window.api.onWorkTogetherClosed(this.sessionId, (code, reason) => {
      this.connected = false
      this.onStatus?.('disconnected')
      this.onClosed?.(code, reason)
      // A clean, expected shutdown (we asked to stop, or the session/token is
      // permanently gone) must not trigger the retry loop.
      if (TERMINAL_CLOSE_CODES.has(code)) this.wantConnection = false
      this.scheduleReconnect()
    })

    const result = await this.open()
    if (!result.success && !this.wantConnection) {
      // A first connect that failed for good (terminal / caller gave up):
      // tear the subscriptions back down, matching the old behavior.
      this.unsubscribeMessage?.()
      this.unsubscribeClosed?.()
      this.unsubscribeMessage = null
      this.unsubscribeClosed = null
    }
    return result
  }

  // One connect attempt against the backend, including the sync/awareness
  // handshake on success. A failure while we still want a connection schedules
  // a retry; the Yjs handshake on the next successful open re-syncs anything
  // edited while offline (state-vector exchange), so no local edits are lost.
  private async open(): Promise<{ success: boolean; error?: string }> {
    this.opening = true
    this.onStatus?.('connecting')
    const result = await window.api.workTogetherConnect(this.sessionId, this.backendUrl, this.token)
    this.opening = false
    if (!result.success) {
      this.onStatus?.('disconnected')
      this.scheduleReconnect()
      return result
    }
    this.connected = true
    this.reconnectAttempts = 0
    this.onStatus?.('connected')

    const syncEncoder = encoding.createEncoder()
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(syncEncoder, this.doc)
    this.send(encoding.toUint8Array(syncEncoder))

    // Publish whatever local awareness state (display name/color/role) was
    // already set before connecting, so a guest who joins mid-session sees us
    // immediately rather than waiting for our next cursor move.
    const localState = this.awareness.getLocalState()
    if (localState !== null) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
      )
      this.send(encoding.toUint8Array(awarenessEncoder))
    }

    return { success: true }
  }

  disconnect(): void {
    // Always clears the retry intent/timer, even mid-backoff (connected is
    // false during the wait) - otherwise a pending timer could fire after
    // destroy() and reopen a socket for a session we're tearing down.
    this.wantConnection = false
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (!this.connected) return
    this.connected = false
    window.api.workTogetherDisconnect(this.sessionId)
  }

  private scheduleReconnect(): void {
    if (!this.wantConnection) return
    if (this.reconnectTimer !== null) return // one already pending
    if (this.opening) return // an attempt is in flight; it will reschedule on failure
    if (this.connected) return // already back up
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.wantConnection || this.connected) return
      void this.open()
    }, delay)
  }

  destroy(): void {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], this)
    this.disconnect()
    this.unsubscribeMessage?.()
    this.unsubscribeClosed?.()
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
  }

  private send(data: Uint8Array): void {
    if (!this.connected) return
    window.api.workTogetherSend(this.sessionId, data)
  }

  private handleMessage = (data: Uint8Array): void => {
    const decoder = decoding.createDecoder(data)
    while (decoding.hasContent(decoder)) {
      const messageType = decoding.readVarUint(decoder)
      switch (messageType) {
        case MESSAGE_SYNC: {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
          // readSyncMessage only writes a reply for SyncStep1 (it answers with
          // SyncStep2); anything else leaves just the tag byte in the encoder.
          if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder))
          break
        }
        case MESSAGE_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this
          )
          break
        default:
          // Unknown message type, stop processing this frame
          return
      }
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    this.send(encoding.toUint8Array(encoder))
  }

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === this) return
    const changedClients = changes.added.concat(changes.updated, changes.removed)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
    )
    this.send(encoding.toUint8Array(encoder))
  }
}
