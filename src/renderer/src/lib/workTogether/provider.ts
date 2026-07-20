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

  constructor(sessionId: string, doc: Y.Doc, awareness: awarenessProtocol.Awareness) {
    this.sessionId = sessionId
    this.doc = doc
    this.awareness = awareness
    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  async connect(backendUrl: string, token: string): Promise<{ success: boolean; error?: string }> {
    this.unsubscribeMessage = window.api.onWorkTogetherMessage(this.sessionId, this.handleMessage)
    this.unsubscribeClosed = window.api.onWorkTogetherClosed(this.sessionId, (code, reason) => {
      this.connected = false
      this.onStatus?.('disconnected')
      this.onClosed?.(code, reason)
    })

    this.onStatus?.('connecting')
    const result = await window.api.workTogetherConnect(this.sessionId, backendUrl, token)
    if (!result.success) {
      this.onStatus?.('disconnected')
      return result
    }
    this.connected = true
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
    if (!this.connected) return
    this.connected = false
    window.api.workTogetherDisconnect(this.sessionId)
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
