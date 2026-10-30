import { DEFAULT_TIMEOUT_MS, type HttpHeader, type HttpRequestSpec } from '../../../../shared/http'
import { looksLikeCurl, parseCurl } from './curl'

// The `.http` / `.rest` file format: a plain-text list of requests separated
// by `###`, the convention JetBrains' HTTP Client and VS Code's REST Client
// both use, so files move between them and this editor unchanged.
//
//   @base = https://api.example.com
//
//   ### list tasks
//   GET {{base}}/tasks
//   Authorization: Bearer {{token}}
//
//   ### create one
//   # @timeout 60
//   POST {{base}}/tasks
//   Content-Type: application/json
//
//   { "title": "hi" }
//
// A block whose body is just a pasted `curl ...` command works too - that is
// the whole point of having one parser for both.

export interface HttpBlock {
  // The text after `###`, or the request line if the separator had none.
  name: string
  // 0-based line of the request line, for the CodeLens anchor.
  requestLine: number
  // 0-based inclusive range of the whole block, for "run the block the
  // cursor is in".
  startLine: number
  endLine: number
  lines: string[]
  // Variable values in effect at this point in the file.
  variables: Record<string, string>
}

export type BuildResult = { ok: true; spec: HttpRequestSpec } | { ok: false; error: string }

const SEPARATOR = /^\s*###/
const VARIABLE_DEF = /^\s*@([A-Za-z_][\w.-]*)\s*=\s*(.*)$/
const COMMENT = /^\s*(#|\/\/)/
const REQUEST_LINE =
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)?\s*(\S.*?)\s*(HTTP\/[\d.]+)?\s*$/i

function isBlank(line: string): boolean {
  return line.trim() === ''
}

// Splits the file into blocks, carrying the variable scope down as it goes -
// a later `@base = ...` redefinition only affects the blocks below it, which
// is how these files are written (staging on top, production further down).
//
// `env` is the selected environment's variables (src/main/httpEnv.ts). They
// seed the scope so a definition can build on them (`@url = {{host}}/v1`),
// *and* they are re-applied on top of each block: picking an environment has
// to beat the file's own `@host = ...`, or the same file could never be run
// against dev and prod - which is the whole reason environments exist.
export function parseHttpFile(text: string, env: Record<string, string> = {}): HttpBlock[] {
  const lines = text.split('\n')
  const blocks: HttpBlock[] = []
  const variables: Record<string, string> = { ...env }

  let current: {
    name: string
    start: number
    lines: string[]
    vars: Record<string, string>
    seenContent: boolean
  } | null = null

  const flush = (endLine: number): void => {
    if (!current) return
    // A block that never got a request line (trailing comments, an empty
    // trailer after the last ###) isn't runnable, so it isn't a block.
    const requestLine = current.lines.findIndex((l) => !isBlank(l) && !COMMENT.test(l))
    if (requestLine !== -1) {
      blocks.push({
        name: current.name || current.lines[requestLine].trim(),
        requestLine: current.start + requestLine,
        startLine: current.start,
        endLine,
        lines: current.lines,
        variables: { ...current.vars, ...env }
      })
    }
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (SEPARATOR.test(line)) {
      flush(i - 1)
      current = {
        name: line.replace(/^\s*#+/, '').trim(),
        start: i + 1,
        lines: [],
        vars: { ...variables },
        seenContent: false
      }
      continue
    }

    // A variable definition only counts before the block's request line -
    // past it, an `@`-leading line is part of a body and stays untouched.
    if (!current?.seenContent && VARIABLE_DEF.test(line)) {
      const varMatch = VARIABLE_DEF.exec(line)!
      // Definitions may reference earlier ones: @url = {{base}}/v1.
      variables[varMatch[1]] = substitute(varMatch[2].trim(), variables).text
      if (current) current.vars = { ...variables }
      continue
    }

    if (!current) {
      // Content before the first ### is a block too - a one-request file
      // doesn't need a separator at all.
      if (isBlank(line) || COMMENT.test(line)) continue
      current = { name: '', start: i, lines: [], vars: { ...variables }, seenContent: false }
    }
    current.lines.push(line)
    if (!isBlank(line) && !COMMENT.test(line)) current.seenContent = true
  }
  flush(lines.length - 1)
  return blocks
}

export function blockAtLine(blocks: HttpBlock[], line: number): HttpBlock | null {
  if (!blocks.length) return null
  for (const block of blocks) {
    if (line >= block.startLine && line <= block.endLine) return block
  }
  // Outside every block: the variable header at the top belongs to the first
  // request (that's where a freshly opened file puts the cursor), and trailing
  // blank lines belong to the last one.
  return line < blocks[0].startLine ? blocks[0] : blocks[blocks.length - 1]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// crypto.randomUUID needs a secure context, which a packaged file:// renderer
// isn't guaranteed to be; getRandomValues always exists.
function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// {{name}} plus a few generated values, so a request can send something
// unique without editing the file every time.
function builtin(name: string): string | null {
  const [fn, ...args] = name.slice(1).split(/\s+/)
  if (fn === 'uuid') return randomUuid()
  if (fn === 'timestamp') return String(Math.floor(Date.now() / 1000))
  if (fn === 'isoTimestamp') return new Date().toISOString()
  if (fn === 'randomInt') {
    const min = Number(args[0] ?? 0)
    const max = Number(args[1] ?? 1000)
    return String(randomInt(Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 1000))
  }
  return null
}

export function substitute(
  text: string,
  variables: Record<string, string>
): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_all, name: string) => {
    if (name.startsWith('$')) {
      const generated = builtin(name)
      if (generated !== null) return generated
      missing.push(name)
      return ''
    }
    if (name in variables) return variables[name]
    missing.push(name)
    return ''
  })
  return { text: out, missing }
}

// Turns one block into a request. `cwd` is the directory of the .http file,
// so `< ./body.json` resolves the way the file's author meant it.
export function buildRequest(block: HttpBlock, cwd: string | null): BuildResult {
  const directives = { insecure: false, followRedirects: true, timeoutMs: DEFAULT_TIMEOUT_MS }
  const body: string[] = []
  const headers: HttpHeader[] = []
  let bodyFilePath: string | undefined
  let requestLine: string | null = null
  let inHeaders = false
  const missingAll: string[] = []

  const resolve = (raw: string): string => {
    const { text, missing } = substitute(raw, block.variables)
    missingAll.push(...missing)
    return text
  }

  // A block that *is* a curl command goes to the curl parser whole, before
  // anything below can mistake its `-H 'Name: value'` continuation lines for
  // .http header lines.
  const first = block.lines.findIndex((l) => !isBlank(l) && !COMMENT.test(l))
  if (first !== -1 && looksLikeCurl(block.lines[first])) {
    const command = block.lines.slice(first).map(resolve).join('\n')
    if (missingAll.length) {
      return { ok: false, error: `Undefined variable: ${[...new Set(missingAll)].join(', ')}` }
    }
    return curlToResult(command, cwd)
  }

  for (const raw of block.lines) {
    if (requestLine === null) {
      if (isBlank(raw)) continue
      if (COMMENT.test(raw)) {
        const directive = raw.replace(COMMENT, '').trim()
        if (directive === '@insecure' || directive === '@no-verify') directives.insecure = true
        if (directive === '@no-redirect') directives.followRedirects = false
        const timeout = /^@timeout\s+(\d+)/.exec(directive)
        if (timeout) directives.timeoutMs = Number(timeout[1]) * 1000
        continue
      }
      requestLine = resolve(raw)
      inHeaders = true
      continue
    }

    if (inHeaders) {
      if (isBlank(raw)) {
        inHeaders = false
        continue
      }
      if (COMMENT.test(raw)) continue
      // A wrapped URL: REST Client lets a long query string continue on the
      // next line as long as it is indented and starts with ? or &.
      if (/^\s+[?&]/.test(raw) && headers.length === 0) {
        requestLine += resolve(raw.trim())
        continue
      }
      const colon = raw.indexOf(':')
      if (colon === -1) return { ok: false, error: `Malformed header line: ${raw.trim()}` }
      headers.push({
        name: raw.slice(0, colon).trim(),
        value: resolve(raw.slice(colon + 1).trim())
      })
      continue
    }

    if (bodyFilePath === undefined && /^\s*<\s+\S/.test(raw)) {
      const relative = resolve(raw.trim().replace(/^<\s*/, ''))
      bodyFilePath =
        relative.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relative)
          ? relative
          : cwd
            ? `${cwd}/${relative.replace(/^\.\//, '')}`
            : relative
      continue
    }
    body.push(resolve(raw))
  }

  if (requestLine === null) return { ok: false, error: 'No request in this block' }

  const match = REQUEST_LINE.exec(requestLine)
  if (!match || !match[2]) return { ok: false, error: `Cannot parse request line: ${requestLine}` }
  if (missingAll.length) {
    return { ok: false, error: `Undefined variable: ${[...new Set(missingAll)].join(', ')}` }
  }

  let url = match[2].trim()
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = `https://${url}`

  // Trailing blank lines belong to the file's layout, not to the payload.
  while (body.length && isBlank(body[body.length - 1])) body.pop()

  return {
    ok: true,
    spec: {
      method: (match[1] ?? 'GET').toUpperCase(),
      url,
      headers,
      body: body.length ? body.join('\n') : undefined,
      bodyFilePath,
      followRedirects: directives.followRedirects,
      insecure: directives.insecure,
      timeoutMs: directives.timeoutMs
    }
  }
}

function curlToResult(command: string, cwd: string | null): BuildResult {
  const parsed = parseCurl(command, cwd)
  return parsed.ok ? { ok: true, spec: parsed.spec } : { ok: false, error: parsed.error }
}

// Shared entry point for "run this text": a selection in any file, or the
// whole of a small scratch buffer.
export function buildRequestFromText(
  text: string,
  cwd: string | null,
  env: Record<string, string> = {}
): BuildResult {
  if (looksLikeCurl(text)) return curlToResult(text, cwd)
  const blocks = parseHttpFile(text, env)
  if (!blocks.length) return { ok: false, error: 'No request found in the selection' }
  return buildRequest(blocks[0], cwd)
}

// The other direction: a request built in the HTTP Client form, written out as
// a block that belongs in a `.http` file. What the form can't express (a
// multipart body) is left out rather than faked - it would parse back into a
// different request.
// What the request is called when nobody says: enough to tell two blocks in
// the same file apart at a glance.
export function defaultRequestName(spec: HttpRequestSpec): string {
  try {
    const parsed = new URL(spec.url)
    const suffix = parsed.pathname === '/' ? parsed.host : parsed.pathname
    return `${spec.method} ${suffix}`
  } catch {
    return `${spec.method} ${spec.url}`
  }
}

export function specToHttpBlock(spec: HttpRequestSpec, requestName?: string): string {
  const lines = [`### ${requestName?.trim() || defaultRequestName(spec)}`]
  if (spec.insecure) lines.push('# @insecure')
  if (!spec.followRedirects) lines.push('# @no-redirect')
  if (spec.timeoutMs !== DEFAULT_TIMEOUT_MS) {
    lines.push(`# @timeout ${Math.round(spec.timeoutMs / 1000)}`)
  }
  lines.push(`${spec.method} ${spec.url}`)
  for (const header of spec.headers) {
    if (header.name.trim() === '') continue
    lines.push(`${header.name}: ${header.value}`)
  }
  if (spec.bodyFilePath) lines.push('', `< ${spec.bodyFilePath}`)
  else if (spec.body !== undefined && spec.body !== '') lines.push('', spec.body)
  return `${lines.join('\n')}\n`
}
