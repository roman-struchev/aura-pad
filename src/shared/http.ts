// The HTTP client's wire types, shared by the renderer (which builds a spec
// from a curl command or a .http block) and main (which actually sends it).
//
// Deliberately a *description* of one request rather than a curl string: the
// renderer parses curl, main never sees a shell command, and nothing in this
// app ever hands user text to a shell. See src/main/http.ts.

export interface HttpHeader {
  name: string
  value: string
}

// One multipart/form-data part (curl's -F). Either a literal value or a file
// read from disk by main - the renderer has no filesystem access.
export interface HttpFormPart {
  name: string
  value?: string
  filePath?: string
  fileName?: string
  contentType?: string
}

export interface HttpRequestSpec {
  method: string
  url: string
  headers: HttpHeader[]
  // Text body. Mutually exclusive with bodyFilePath/form.
  body?: string
  // `-d @file` / a `< ./payload.json` line in a .http block.
  bodyFilePath?: string
  form?: HttpFormPart[]
  followRedirects: boolean
  // curl's -k: skip TLS verification. Routed through a throwaway session
  // partition so it can never loosen the rest of the app's networking.
  insecure: boolean
  timeoutMs: number
}

export interface HttpTimings {
  // Time to the response head; the rest is body download.
  ttfbMs: number
  totalMs: number
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: HttpHeader[]
  // Decoded text, empty for binary payloads (see bodyBase64).
  body: string
  // Small binary payloads (images, mostly) so the pane can render them.
  bodyBase64?: string
  bodyBytes: number
  // Body hit MAX_RESPONSE_BYTES and the rest was dropped.
  truncated: boolean
  contentType: string | null
  charset: string | null
  timings: HttpTimings
  // Where the request ended up after redirects, and how many there were.
  finalUrl: string
  redirects: number
}

// One sent request, as kept in the history log (main/httpHistory.ts). The
// full spec is stored so an entry can be loaded back into the form and re-run.
export interface HttpHistoryEntry {
  id: string
  sentAt: number
  spec: HttpRequestSpec
  status?: number
  durationMs?: number
  bodyBytes?: number
  error?: string
}

export type HttpSendResult =
  { success: true; response: HttpResponse } | { success: false; error: string; cancelled?: boolean }

// A response bigger than this is truncated rather than pulled into memory and
// handed to the renderer - the viewer is for reading, not for downloading.
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
// Binary bodies are base64'd (4/3 overhead) purely to be previewed, so they
// get a much tighter cap.
export const MAX_BINARY_PREVIEW_BYTES = 2 * 1024 * 1024
export const DEFAULT_TIMEOUT_MS = 30_000
// How many past requests the history keeps. Long enough to find yesterday's
// call, short enough that the file stays small and readable.
export const HTTP_HISTORY_LIMIT = 50
export const MAX_REDIRECTS = 10

export function findHeader(headers: HttpHeader[], name: string): string | null {
  const lower = name.toLowerCase()
  for (const h of headers) if (h.name.toLowerCase() === lower) return h.value
  return null
}

export function hasHeader(headers: HttpHeader[], name: string): boolean {
  return findHeader(headers, name) !== null
}

// `application/json; charset=utf-8` -> { type, charset }.
export function parseContentType(raw: string | null): {
  type: string | null
  charset: string | null
} {
  if (!raw) return { type: null, charset: null }
  const [first, ...params] = raw.split(';')
  let charset: string | null = null
  for (const p of params) {
    const [k, v] = p.split('=')
    if (k?.trim().toLowerCase() === 'charset' && v) charset = v.trim().replace(/^["']|["']$/g, '')
  }
  return { type: first.trim().toLowerCase() || null, charset }
}

// Whether a content type is text we can decode and show in the body viewer.
// Anything structured-but-textual (+json, +xml, javascript, urlencoded) counts.
export function isTextualContentType(type: string | null): boolean {
  if (!type) return true // no content-type at all: assume text, that's the common case
  if (type.startsWith('text/')) return true
  if (/^application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql)$/.test(type))
    return true
  if (/^application\/.*\+(json|xml)$/.test(type)) return true
  if (type === 'application/x-ndjson' || type === 'application/problem+json') return true
  return false
}
