import { BrowserWindow, net } from 'electron'
import WebSocket from 'ws'
import type {
  WorkTogetherLink,
  WorkTogetherLinkRole,
  WorkTogetherResult,
  WorkTogetherSession,
  WorkTogetherSessionStatus
} from '../shared/workTogether'

// Client for the "Work Together" backend contract (docs/edit-together/
// specification.md): the REST session/link API in main via net.fetch (same
// pattern as translate.ts's Google endpoint), plus a WebSocket relay per
// session for the Yjs sync/awareness traffic.
//
// The WebSocket half lives here rather than the renderer because the backend
// URL is arbitrary and user-configured (self-hosted) - the renderer's CSP
// connect-src is a fixed allowlist (index.html) that can't be widened for an
// address only known at runtime, and the `ws` package isn't available inside
// a browser-context renderer anyway. The renderer only ever sees decoded
// binary frames over IPC (see shared/ipc.ts's work-together-message-<id> /
// work-together-closed-<id> dynamic channels).

const REQUEST_TIMEOUT_MS = 15_000
const CONNECT_TIMEOUT_MS = 15_000

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function toWsUrl(backendUrl: string): string {
  return trimSlash(backendUrl).replace(/^http/i, (m) =>
    m.toLowerCase() === 'https' ? 'wss' : 'ws'
  )
}

async function restCall<T>(
  backendUrl: string,
  path: string,
  method: string,
  token?: string,
  body?: unknown
): Promise<WorkTogetherResult<T>> {
  try {
    const response = await net.fetch(`${trimSlash(backendUrl)}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return { success: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` }
    }
    // 204 No Content (revoke/end) has no body to parse.
    const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T)
    return { success: true, data }
  } catch (e) {
    const message =
      e instanceof Error ? (e.name === 'TimeoutError' ? 'request timed out' : e.message) : String(e)
    return { success: false, error: message }
  }
}

export function createSession(
  backendUrl: string,
  filePath: string,
  language: string,
  content: string,
  maxTtlSeconds: number
): Promise<WorkTogetherResult<WorkTogetherSession>> {
  return restCall(backendUrl, '/v1/sessions', 'POST', undefined, {
    filePath,
    language,
    content,
    maxTtlSeconds
  })
}

export function mintLink(
  backendUrl: string,
  sessionId: string,
  hostToken: string,
  role: WorkTogetherLinkRole,
  ttlSeconds: number
): Promise<WorkTogetherResult<WorkTogetherLink>> {
  return restCall(
    backendUrl,
    `/v1/sessions/${encodeURIComponent(sessionId)}/links`,
    'POST',
    hostToken,
    { role, ttlSeconds }
  )
}

export function revokeLink(
  backendUrl: string,
  sessionId: string,
  hostToken: string,
  linkId: string
): Promise<WorkTogetherResult<void>> {
  return restCall(
    backendUrl,
    `/v1/sessions/${encodeURIComponent(sessionId)}/links/${encodeURIComponent(linkId)}`,
    'DELETE',
    hostToken
  )
}

export function endSession(
  backendUrl: string,
  sessionId: string,
  hostToken: string
): Promise<WorkTogetherResult<void>> {
  return restCall(backendUrl, `/v1/sessions/${encodeURIComponent(sessionId)}`, 'DELETE', hostToken)
}

export function getSessionStatus(
  backendUrl: string,
  sessionId: string,
  hostToken: string
): Promise<WorkTogetherResult<WorkTogetherSessionStatus>> {
  return restCall(backendUrl, `/v1/sessions/${encodeURIComponent(sessionId)}`, 'GET', hostToken)
}

// ---------------------------------------------------------------------------
// WebSocket relay: one connection per session, forwarding raw binary frames
// (Yjs sync/awareness/control, message-type-tagged per specification.md §4)
// between the backend and whichever renderer window is current.

const connections = new Map<string, WebSocket>()

// Same "resolve lazily, not at registration time" reasoning as terminals.ts:
// a connection can outlive a window close/reopen (macOS dock-activate cycle)
// and must keep delivering to a window that still exists. The fallback is the
// app's primary window, which is where a session survives its own window
// closing; while that window is alive, a session belongs to whichever window
// opened it, so a shared tab in a second window gets its own messages.
let getPrimaryWindow: () => BrowserWindow | null = () => null
const sessionOwners = new Map<string, number>()

export function registerWorkTogetherWindowProvider(
  windowProvider: () => BrowserWindow | null
): void {
  getPrimaryWindow = windowProvider
}

function ownerWindow(sessionId: string): BrowserWindow | null {
  const ownerId = sessionOwners.get(sessionId)
  const owned =
    ownerId === undefined
      ? undefined
      : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.id === ownerId)
  return owned ?? getPrimaryWindow()
}

function sendToRenderer(sessionId: string, channel: string, ...args: unknown[]): void {
  const win = ownerWindow(sessionId)
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

export function connectSession(
  sessionId: string,
  backendUrl: string,
  token: string,
  ownerId?: number
): Promise<{ success: boolean; error?: string }> {
  disconnectSession(sessionId)
  if (ownerId !== undefined) sessionOwners.set(sessionId, ownerId)

  return new Promise((resolve) => {
    let settled = false
    const settle = (result: { success: boolean; error?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const url = `${toWsUrl(backendUrl)}/v1/sessions/${encodeURIComponent(sessionId)}/connect?token=${encodeURIComponent(token)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      resolve({ success: false, error: e instanceof Error ? e.message : String(e) })
      return
    }
    ws.binaryType = 'nodebuffer'

    const timeout = setTimeout(() => {
      try {
        ws.terminate()
      } catch {
        // already closed
      }
      settle({ success: false, error: 'connection timed out' })
    }, CONNECT_TIMEOUT_MS)

    ws.on('open', () => {
      connections.set(sessionId, ws)
      settle({ success: true })
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      sendToRenderer(sessionId, `work-together-message-${sessionId}`, new Uint8Array(buf))
    })

    ws.on('close', (code: number, reasonBuf: Buffer) => {
      connections.delete(sessionId)
      sendToRenderer(sessionId, `work-together-closed-${sessionId}`, code, reasonBuf.toString())
      settle({ success: false, error: `connection closed (${code})` })
    })

    ws.on('error', (err: Error) => {
      settle({ success: false, error: err.message })
    })
  })
}

export function sendSessionMessage(sessionId: string, data: Uint8Array): void {
  const ws = connections.get(sessionId)
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

export function disconnectSession(sessionId: string): void {
  sessionOwners.delete(sessionId)
  const ws = connections.get(sessionId)
  if (!ws) return
  connections.delete(sessionId)
  ws.removeAllListeners()
  try {
    ws.close()
  } catch {
    // already closed
  }
}

export function disconnectAllSessions(): void {
  for (const sessionId of [...connections.keys()]) disconnectSession(sessionId)
}
