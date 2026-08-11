import { net, session, type Session } from 'electron'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import iconv from 'iconv-lite'
import { recordHttpRequest } from './httpHistory'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_BINARY_PREVIEW_BYTES,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  isTextualContentType,
  parseContentType,
  type HttpFormPart,
  type HttpHeader,
  type HttpRequestSpec,
  type HttpSendResult
} from '../shared/http'

// The HTTP client's engine. Requests arrive as a structured HttpRequestSpec
// (the renderer parses curl / .http blocks into one), never as a command
// line - a .http file can come from a cloned repository, and handing its
// text to a shell would make "Run" arbitrary code execution.
//
// Electron's net module rather than Node's http: it goes through Chromium's
// network stack, so system proxy/PAC settings, the OS certificate store and
// transparent gzip/brotli all work the way the user's browser does.

// Requests run in their own in-memory session partitions so the client can
// never pick up (or pollute) the app's cookies, cache or auth state. The
// insecure one exists only to serve curl's -k.
let clientSession: Session | null = null
let insecureSession: Session | null = null

function getSession(insecure: boolean): Session {
  if (insecure) {
    if (!insecureSession) {
      insecureSession = session.fromPartition('http-client-insecure')
      // 0 = "trust this certificate": exactly what -k asks for, scoped to
      // this partition so no other request in the app is affected.
      insecureSession.setCertificateVerifyProc((_request, callback) => callback(0))
    }
    return insecureSession
  }
  if (!clientSession) clientSession = session.fromPartition('http-client')
  return clientSession
}

// requestId -> abort handle, so the renderer's Cancel button can stop a
// request that is still streaming.
const inFlight = new Map<string, () => void>()

export function cancelHttpRequest(requestId: string): void {
  inFlight.get(requestId)?.()
}

function buildMultipart(
  parts: HttpFormPart[],
  files: Map<string, Buffer>
): {
  body: Buffer
  contentType: string
} {
  const boundary = `----AuraPadFormBoundary${crypto.randomBytes(12).toString('hex')}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    const head: string[] = [`--${boundary}`]
    if (part.filePath) {
      const filename = part.fileName ?? path.basename(part.filePath)
      head.push(
        `Content-Disposition: form-data; name="${part.name}"; filename="${filename}"`,
        `Content-Type: ${part.contentType ?? 'application/octet-stream'}`
      )
      chunks.push(Buffer.from(`${head.join('\r\n')}\r\n\r\n`))
      chunks.push(files.get(part.filePath) ?? Buffer.alloc(0))
    } else {
      head.push(`Content-Disposition: form-data; name="${part.name}"`)
      if (part.contentType) head.push(`Content-Type: ${part.contentType}`)
      chunks.push(Buffer.from(`${head.join('\r\n')}\r\n\r\n`))
      chunks.push(Buffer.from(part.value ?? '', 'utf8'))
    }
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

// Reads every file the spec references (a `-d @file` body, `-F` file parts)
// up front, so a missing file fails before anything hits the network.
async function readReferencedFiles(spec: HttpRequestSpec): Promise<Map<string, Buffer>> {
  const paths = new Set<string>()
  if (spec.bodyFilePath) paths.add(spec.bodyFilePath)
  for (const part of spec.form ?? []) if (part.filePath) paths.add(part.filePath)
  const out = new Map<string, Buffer>()
  for (const p of paths) out.set(p, await fs.readFile(p))
  return out
}

// Electron hands back headers as name -> value | value[]; flatten to the
// ordered pairs the viewer shows, keeping repeated headers (Set-Cookie)
// as separate rows instead of silently collapsing them.
function toHeaderPairs(raw: Record<string, string | string[]>): HttpHeader[] {
  const out: HttpHeader[] = []
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) out.push({ name, value: v })
    else out.push({ name, value })
  }
  return out
}

function decodeBody(
  buffer: Buffer,
  contentType: string | null,
  charset: string | null
): { body: string; bodyBase64?: string } {
  if (!isTextualContentType(contentType)) {
    return buffer.length <= MAX_BINARY_PREVIEW_BYTES
      ? { body: '', bodyBase64: buffer.toString('base64') }
      : { body: '' }
  }
  // iconv-lite is already a dependency (the editor's encoding support), so
  // a windows-1251 or koi8-r response reads correctly instead of as mojibake.
  if (charset && !/^utf-?8$/i.test(charset) && iconv.encodingExists(charset)) {
    return { body: iconv.decode(buffer, charset) }
  }
  return { body: buffer.toString('utf8') }
}

export async function sendHttpRequest(
  requestId: string,
  spec: HttpRequestSpec
): Promise<HttpSendResult> {
  let url: URL
  try {
    url = new URL(spec.url)
  } catch {
    return { success: false, error: `Invalid URL: ${spec.url}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { success: false, error: `Unsupported protocol: ${url.protocol.replace(':', '')}` }
  }

  let files: Map<string, Buffer>
  try {
    files = await readReferencedFiles(spec)
  } catch (error) {
    return { success: false, error: `Cannot read request body file: ${(error as Error).message}` }
  }

  // Assemble the outgoing body and the content-type it implies (an explicit
  // header in the spec always wins - the user asked for it by name).
  let body: Buffer | null = null
  let impliedContentType: string | null = null
  if (spec.form?.length) {
    const multipart = buildMultipart(spec.form, files)
    body = multipart.body
    impliedContentType = multipart.contentType
  } else if (spec.bodyFilePath) {
    body = files.get(spec.bodyFilePath) ?? Buffer.alloc(0)
  } else if (spec.body !== undefined && spec.body !== '') {
    body = Buffer.from(spec.body, 'utf8')
  }

  const startedAt = Date.now()
  let ttfbMs = 0
  let redirects = 0
  let finalUrl = spec.url

  return new Promise<HttpSendResult>((resolve) => {
    let settled = false
    const settle = (result: HttpSendResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      inFlight.delete(requestId)
      // Recorded here rather than at each call site so every outcome - a
      // response, a failure, a cancellation - lands in the history exactly
      // once, whichever event settled it.
      recordHttpRequest(spec, {
        response: result.success ? result.response : undefined,
        error: result.success ? undefined : result.error
      })
      resolve(result)
    }

    const request = net.request({
      method: spec.method,
      url: spec.url,
      session: getSession(spec.insecure),
      // Redirects are followed by hand so they can be counted, capped, and
      // turned off (curl without -L stops at the 3xx and shows it).
      redirect: 'manual',
      // No ambient cookies or cached credentials: what the user wrote in the
      // request is the whole request.
      credentials: 'omit'
    })

    // Cancelled and timed-out requests both surface as 'abort'; these flags
    // say which message to report. truncated aborts resolve successfully.
    let cancelled = false
    let timedOut = false
    let truncated = false
    // Set once the response head arrives: resolves with whatever body has
    // been read so far. Every abort path calls it (settle is idempotent)
    // rather than trusting one particular event to fire - a stream aborted
    // mid-read doesn't reliably emit 'end' *or* 'aborted', and a request that
    // never settles leaves the pane spinning forever.
    let finishResponse: (() => void) | null = null

    const timeoutMs = Math.max(1000, spec.timeoutMs || DEFAULT_TIMEOUT_MS)
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      request.abort()
      if (truncated) finishResponse?.()
      else settle({ success: false, error: `Timed out after ${timeoutMs} ms` })
    }, timeoutMs)

    inFlight.set(requestId, () => {
      cancelled = true
      request.abort()
    })

    // setHeader overwrites, so repeated headers (two -H 'Cookie: ...', a
    // multi-valued Accept) have to be folded into one value first or only the
    // last one would be sent. Cookies are separated by '; ' per RFC 6265, and
    // every other header by ', ' per RFC 9110.
    const folded = new Map<string, { name: string; values: string[] }>()
    for (const header of spec.headers) {
      const key = header.name.toLowerCase()
      const existing = folded.get(key)
      if (existing) existing.values.push(header.value)
      else folded.set(key, { name: header.name, values: [header.value] })
    }
    for (const [key, header] of folded) {
      try {
        request.setHeader(header.name, header.values.join(key === 'cookie' ? '; ' : ', '))
      } catch {
        // Chromium refuses a few headers it manages itself (Content-Length,
        // Connection). Dropping one is better than failing the whole request.
      }
    }
    if (impliedContentType && !spec.headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      request.setHeader('Content-Type', impliedContentType)
    }

    request.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
      redirects += 1
      finalUrl = redirectUrl
      if (!spec.followRedirects) {
        // Stop here and report the 3xx itself - the body of a redirect
        // response is almost always empty, and its Location is the point.
        settle({
          success: true,
          response: {
            status: statusCode,
            statusText: '',
            headers: toHeaderPairs(responseHeaders),
            body: '',
            bodyBytes: 0,
            truncated: false,
            contentType: null,
            charset: null,
            timings: { ttfbMs: Date.now() - startedAt, totalMs: Date.now() - startedAt },
            finalUrl: redirectUrl,
            redirects
          }
        })
        request.abort()
        return
      }
      if (redirects > MAX_REDIRECTS) {
        settle({ success: false, error: `Too many redirects (>${MAX_REDIRECTS})` })
        request.abort()
        return
      }
      request.followRedirect()
    })

    request.on('response', (response) => {
      ttfbMs = Date.now() - startedAt
      const chunks: Buffer[] = []
      let received = 0

      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > MAX_RESPONSE_BYTES) {
          if (!truncated) {
            truncated = true
            const room = MAX_RESPONSE_BYTES - (received - chunk.length)
            if (room > 0) chunks.push(chunk.subarray(0, room))
            request.abort()
          }
          return
        }
        chunks.push(chunk)
      })

      const finish = (): void => {
        const buffer = Buffer.concat(chunks)
        const headers = toHeaderPairs(response.headers)
        const { type, charset } = parseContentType(
          headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? null
        )
        const decoded = decodeBody(buffer, type, charset)
        settle({
          success: true,
          response: {
            status: response.statusCode,
            statusText: response.statusMessage ?? '',
            headers,
            ...decoded,
            bodyBytes: truncated ? MAX_RESPONSE_BYTES : buffer.length,
            truncated,
            contentType: type,
            charset,
            timings: { ttfbMs, totalMs: Date.now() - startedAt },
            finalUrl,
            redirects
          }
        })
      }

      finishResponse = finish
      response.on('end', finish)
      // A truncated read aborts the stream on purpose: report what arrived
      // rather than the abort.
      response.on('aborted', () => {
        if (truncated) finish()
      })
      response.on('error', (error: Error) => {
        settle({ success: false, error: error.message })
      })
    })

    request.on('abort', () => {
      // Aborted because the body outgrew the cap: that is a successful read
      // of a truncated response, not a failure.
      if (truncated) {
        finishResponse?.()
        return
      }
      if (cancelled) settle({ success: false, error: 'Cancelled', cancelled: true })
      else if (timedOut) settle({ success: false, error: `Timed out after ${timeoutMs} ms` })
      else settle({ success: false, error: 'Request aborted' })
    })

    request.on('error', (error) => {
      settle({ success: false, error: error.message })
    })

    if (body) request.write(body)
    request.end()
  })
}
