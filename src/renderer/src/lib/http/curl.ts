import {
  DEFAULT_TIMEOUT_MS,
  type HttpFormPart,
  type HttpHeader,
  type HttpRequestSpec
} from '../../../../shared/http'

// curl <-> HttpRequestSpec.
//
// The command line is *parsed*, never executed: a curl command can arrive
// from a file in a cloned repository, and `sh -c` on it would make "Run" a
// remote code execution button. Anything that would need a shell (pipes,
// redirects, command substitution) or that writes to disk (-o, -K, -T) is
// rejected with a message naming the flag, rather than quietly ignored -
// silently dropping half a command and showing a confident response is worse
// than refusing to run it.

export type CurlParseResult = { ok: true; spec: HttpRequestSpec } | { ok: false; error: string }

// Short flags that consume the rest of the token (or the next one) as their
// value, curl-style: -XPOST and -X POST are the same thing.
const SHORT_WITH_VALUE = new Set([
  'X',
  'H',
  'd',
  'F',
  'u',
  'b',
  'A',
  'e',
  'm',
  'o',
  'T',
  'x',
  'w',
  'K',
  'c',
  'D',
  'E',
  'r',
  'z',
  'C',
  'U'
])

// Flags that only affect curl's own output or transport tuning; the response
// pane always shows headers and timings, so these are simply no-ops.
const IGNORED_NO_VALUE = new Set([
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '-i',
  '--include',
  '--compressed',
  '--no-progress-meter',
  '-#',
  '--progress-bar',
  '-f',
  '--fail',
  '--fail-with-body',
  '-g',
  '--globoff',
  '-N',
  '--no-buffer',
  '-j',
  '--junk-session-cookies',
  '-4',
  '--ipv4',
  '-6',
  '--ipv6',
  '--http1.1',
  '--http2',
  '--no-keepalive'
])

const IGNORED_WITH_VALUE = new Set([
  '--retry',
  '--retry-delay',
  '--retry-max-time',
  '--connect-timeout',
  '--max-redirs',
  '--limit-rate',
  '--expect100-timeout'
])

// Flags we refuse rather than approximate: they write files, read further
// command lines, or need transport features this client doesn't implement.
const REJECTED: Record<string, string> = {
  '-o': 'writes the response to a file',
  '--output': 'writes the response to a file',
  '-O': 'writes the response to a file',
  '--remote-name': 'writes the response to a file',
  '-K': 'reads more options from a file',
  '--config': 'reads more options from a file',
  '-T': 'uploads a file with PUT',
  '--upload-file': 'uploads a file with PUT',
  '-c': 'writes a cookie jar',
  '--cookie-jar': 'writes a cookie jar',
  '-w': 'formats output with a template',
  '--write-out': 'formats output with a template',
  '-x': 'uses a proxy',
  '--proxy': 'uses a proxy',
  '--socks5': 'uses a proxy',
  '-E': 'uses a client certificate',
  '--cert': 'uses a client certificate',
  '--key': 'uses a client certificate',
  '--resolve': 'overrides DNS resolution',
  '--interface': 'binds a network interface',
  '--trace': 'writes a trace file',
  '--trace-ascii': 'writes a trace file'
}

// Splits a command line into argv the way a POSIX shell would, minus every
// feature that would need an actual shell. Backslash-newline continuations
// (how curl commands are usually pasted) collapse into nothing.
function tokenize(input: string): { ok: true; argv: string[] } | { ok: false; error: string } {
  const argv: string[] = []
  let current = ''
  let hasCurrent = false
  let i = 0

  const push = (): void => {
    if (hasCurrent) argv.push(current)
    current = ''
    hasCurrent = false
  }

  while (i < input.length) {
    const c = input[i]

    if (c === '\\' && input[i + 1] === '\n') {
      i += 2
      continue
    }
    if (c === '^' && input[i + 1] === '\n') {
      // Windows cmd line continuation, so a command copied from a .bat or
      // from Windows browser devtools parses too.
      i += 2
      continue
    }
    if (c === '\\') {
      if (i + 1 >= input.length) return { ok: false, error: 'Command ends with a backslash' }
      current += input[i + 1]
      hasCurrent = true
      i += 2
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      push()
      i += 1
      continue
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) return { ok: false, error: 'Unbalanced single quote' }
      current += input.slice(i + 1, end)
      hasCurrent = true
      i = end + 1
      continue
    }
    if (c === '$' && input[i + 1] === "'") {
      // ANSI-C quoting ($'line\nline') - devtools' "Copy as cURL" emits it
      // for bodies with newlines.
      let j = i + 2
      let out = ''
      while (j < input.length && input[j] !== "'") {
        if (input[j] === '\\') {
          const esc = input[j + 1]
          out +=
            esc === 'n'
              ? '\n'
              : esc === 't'
                ? '\t'
                : esc === 'r'
                  ? '\r'
                  : esc === '0'
                    ? '\0'
                    : (esc ?? '')
          j += 2
          continue
        }
        out += input[j]
        j += 1
      }
      if (j >= input.length) return { ok: false, error: 'Unbalanced $’ quote' }
      current += out
      hasCurrent = true
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      let out = ''
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\') {
          const esc = input[j + 1]
          // Inside double quotes a backslash is literal unless it escapes
          // one of these four, exactly as in a POSIX shell.
          out += esc === '"' || esc === '\\' || esc === '$' || esc === '`' ? esc : `\\${esc ?? ''}`
          j += 2
          continue
        }
        if (input[j] === '`' || (input[j] === '$' && input[j + 1] === '(')) {
          return { ok: false, error: 'Command substitution is not supported' }
        }
        out += input[j]
        j += 1
      }
      if (j >= input.length) return { ok: false, error: 'Unbalanced double quote' }
      current += out
      hasCurrent = true
      i = j + 1
      continue
    }
    if (c === '`' || (c === '$' && input[i + 1] === '(')) {
      return { ok: false, error: 'Command substitution is not supported' }
    }
    if (c === '|' || c === ';' || c === '>' || c === '<') {
      return { ok: false, error: `Shell operator "${c}" is not supported` }
    }
    if (c === '&' && input[i + 1] === '&') {
      return { ok: false, error: 'Shell operator "&&" is not supported' }
    }

    current += c
    hasCurrent = true
    i += 1
  }
  push()
  return { ok: true, argv }
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function parseFormPart(raw: string, literal: boolean): HttpFormPart | null {
  const eq = raw.indexOf('=')
  if (eq === -1) return null
  const name = raw.slice(0, eq)
  let value = raw.slice(eq + 1)
  if (literal) return { name, value }

  // `field=@path;type=text/csv;filename=x.csv` - the file form. `<path`
  // uploads file *contents* as the value, which is close enough to the same
  // thing for our purposes.
  if (value.startsWith('@') || value.startsWith('<')) {
    let rest = value.slice(1)
    let contentType: string | undefined
    let fileName: string | undefined
    const parts = rest.split(';')
    rest = parts.shift() ?? ''
    for (const p of parts) {
      const [k, v] = p.split('=')
      if (k?.trim() === 'type') contentType = v?.trim()
      if (k?.trim() === 'filename') fileName = v?.trim()
    }
    return { name, filePath: rest, contentType, fileName }
  }
  const parts = value.split(';')
  value = parts.shift() ?? ''
  let contentType: string | undefined
  for (const p of parts) {
    const [k, v] = p.split('=')
    if (k?.trim() === 'type') contentType = v?.trim()
  }
  return { name, value, contentType }
}

// Turns `curl ...` into a request spec. `cwd` resolves relative @file paths;
// without one, a relative path is reported as an error rather than guessed.
export function parseCurl(command: string, cwd?: string | null): CurlParseResult {
  const tokenized = tokenize(command.trim())
  if (!tokenized.ok) return { ok: false, error: tokenized.error }

  const argv = tokenized.argv.filter((t) => t !== '')
  if (argv.length === 0) return { ok: false, error: 'Empty command' }
  // Tolerate a copied shell prompt and a leading `curl`.
  let start = 0
  if (argv[start] === '$' || argv[start] === '%' || argv[start] === '>') start += 1
  if (argv[start] === 'curl') start += 1
  else if (argv[start]?.endsWith('/curl')) start += 1
  else if (start === 0) return { ok: false, error: 'Not a curl command' }

  const headers: HttpHeader[] = []
  const form: HttpFormPart[] = []
  const dataParts: string[] = []
  let dataIsRaw = false
  let bodyFilePath: string | undefined
  let method: string | null = null
  let url: string | null = null
  let followRedirects = false
  let insecure = false
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let asQuery = false
  let jsonShorthand = false

  const resolveFile = (p: string): string | null => {
    if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return p
    if (!cwd) return null
    return `${cwd}/${p.replace(/^\.\//, '')}`
  }

  // Expands `-sSLX POST` into individual flags. A short flag that takes a
  // value swallows whatever follows it inside the same token.
  const expand = (token: string): string[] => {
    if (!/^-[A-Za-z0-9#]/.test(token) || token.startsWith('--') || token.length <= 2) return [token]
    const out: string[] = []
    for (let k = 1; k < token.length; k++) {
      const ch = token[k]
      if (SHORT_WITH_VALUE.has(ch)) {
        out.push(`-${ch}`)
        const rest = token.slice(k + 1)
        if (rest) out.push(rest)
        return out
      }
      out.push(`-${ch}`)
    }
    return out
  }

  const flat: string[] = []
  for (const token of argv.slice(start)) flat.push(...expand(token))

  for (let i = 0; i < flat.length; i++) {
    const arg = flat[i]
    const next = (): string | null => {
      i += 1
      return i < flat.length ? flat[i] : null
    }
    // `--header=value` is accepted by curl's long-option parser too.
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = eq === -1 ? arg : arg.slice(0, eq)
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1)
    const value = (): string | null => inlineValue ?? next()

    if (REJECTED[name]) {
      return { ok: false, error: `${name} is not supported here (it ${REJECTED[name]})` }
    }
    if (IGNORED_WITH_VALUE.has(name)) {
      value()
      continue
    }

    switch (name) {
      case '-k':
      case '--insecure':
        insecure = true
        continue
      case '-L':
      case '--location':
      case '--location-trusted':
        followRedirects = true
        continue
      case '-I':
      case '--head':
        method = method ?? 'HEAD'
        continue
      case '-G':
      case '--get':
        asQuery = true
        continue
      case '-X':
      case '--request': {
        const v = value()
        if (!v) return { ok: false, error: '-X needs a method' }
        method = v.toUpperCase()
        continue
      }
      case '--url': {
        const v = value()
        if (!v) return { ok: false, error: '--url needs a value' }
        url = v
        continue
      }
      case '-H':
      case '--header': {
        const v = value()
        if (!v) return { ok: false, error: '-H needs a header' }
        const colon = v.indexOf(':')
        // `-H "X-Empty;"` is curl's way of sending an empty header.
        if (colon === -1) {
          if (v.endsWith(';')) headers.push({ name: v.slice(0, -1).trim(), value: '' })
          else return { ok: false, error: `Malformed header: ${v}` }
          continue
        }
        headers.push({ name: v.slice(0, colon).trim(), value: v.slice(colon + 1).trim() })
        continue
      }
      case '-d':
      case '--data':
      case '--data-ascii':
      case '--data-binary':
      case '--data-raw':
      case '--json': {
        const v = value()
        if (v === null) return { ok: false, error: `${name} needs data` }
        if (name === '--json') jsonShorthand = true
        if (name !== '--data-raw' && name !== '--json' && v.startsWith('@')) {
          const resolved = resolveFile(v.slice(1))
          if (!resolved) {
            return {
              ok: false,
              error: `Cannot resolve ${v} - save the file first or use an absolute path`
            }
          }
          bodyFilePath = resolved
          continue
        }
        dataParts.push(v)
        if (name === '--data-raw' || name === '--json' || name === '--data-binary') dataIsRaw = true
        continue
      }
      case '--data-urlencode': {
        const v = value()
        if (v === null) return { ok: false, error: '--data-urlencode needs data' }
        const eqAt = v.indexOf('=')
        const atAt = v.indexOf('@')
        if (eqAt === 0) dataParts.push(rfc3986(v.slice(1)))
        else if (eqAt > 0) dataParts.push(`${v.slice(0, eqAt)}=${rfc3986(v.slice(eqAt + 1))}`)
        else if (atAt >= 0)
          return { ok: false, error: '--data-urlencode with @file is not supported' }
        else dataParts.push(rfc3986(v))
        continue
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const v = value()
        if (!v) return { ok: false, error: '-F needs a part' }
        const part = parseFormPart(v, name === '--form-string')
        if (!part) return { ok: false, error: `Malformed form part: ${v}` }
        if (part.filePath) {
          const resolved = resolveFile(part.filePath)
          if (!resolved) return { ok: false, error: `Cannot resolve form file ${part.filePath}` }
          part.filePath = resolved
        }
        form.push(part)
        continue
      }
      case '-u':
      case '--user': {
        const v = value()
        if (!v) return { ok: false, error: '-u needs credentials' }
        headers.push({ name: 'Authorization', value: `Basic ${btoa(v)}` })
        continue
      }
      case '-b':
      case '--cookie': {
        const v = value()
        if (!v) return { ok: false, error: '-b needs cookies' }
        if (!v.includes('=')) return { ok: false, error: '-b with a cookie file is not supported' }
        headers.push({ name: 'Cookie', value: v })
        continue
      }
      case '-A':
      case '--user-agent': {
        const v = value()
        if (v) headers.push({ name: 'User-Agent', value: v })
        continue
      }
      case '-e':
      case '--referer': {
        const v = value()
        if (v) headers.push({ name: 'Referer', value: v })
        continue
      }
      case '-m':
      case '--max-time': {
        const v = value()
        const seconds = Number(v)
        if (Number.isFinite(seconds) && seconds > 0) timeoutMs = Math.round(seconds * 1000)
        continue
      }
      default:
        break
    }

    if (IGNORED_NO_VALUE.has(name)) continue

    if (arg.startsWith('-') && arg !== '-') {
      return { ok: false, error: `Unsupported curl option: ${name}` }
    }
    if (url !== null) return { ok: false, error: 'More than one URL in one command' }
    url = arg
  }

  if (!url) return { ok: false, error: 'No URL in the command' }
  // curl still defaults a schemeless host to http://; keep that rather than
  // silently upgrading and getting a different result than the terminal did.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = `http://${url}`

  let body: string | undefined
  if (dataParts.length) {
    // Multiple -d flags concatenate with & (that is curl's rule, and it is
    // why -d a=1 -d b=2 posts a form).
    body = dataIsRaw && dataParts.length === 1 ? dataParts[0] : dataParts.join('&')
  }

  if (asQuery && body) {
    const separator = url.includes('?') ? '&' : '?'
    url = `${url}${separator}${body}`
    body = undefined
  }

  const hasPayload = body !== undefined || bodyFilePath !== undefined || form.length > 0
  const resolvedMethod = method ?? (hasPayload ? 'POST' : 'GET')

  const lower = new Set(headers.map((h) => h.name.toLowerCase()))
  if (jsonShorthand) {
    if (!lower.has('content-type'))
      headers.push({ name: 'Content-Type', value: 'application/json' })
    if (!lower.has('accept')) headers.push({ name: 'Accept', value: 'application/json' })
  } else if (body !== undefined && !lower.has('content-type')) {
    // curl's default for -d, and the reason `-d '{"a":1}'` often surprises
    // people with a 415 - keep the same behavior so results match.
    headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' })
  }

  return {
    ok: true,
    spec: {
      method: resolvedMethod,
      url,
      headers,
      body,
      bodyFilePath,
      form: form.length ? form : undefined,
      followRedirects,
      insecure,
      timeoutMs
    }
  }
}

// Detects the "this text is a curl command" case for run-from-selection and
// for .http blocks that are just a pasted curl.
export function looksLikeCurl(text: string): boolean {
  return /^\s*(?:[$%>]\s+)?(?:[\w./-]*\/)?curl\s/.test(text)
}

// Expands a caret position into the whole curl command around it, following
// backslash continuations up and down - so "Run" works with the cursor
// anywhere inside a multi-line curl pasted into a .md or .sh file, without
// making the user select it first.
export function curlCommandAt(lines: string[], line: number): string | null {
  if (line < 0 || line >= lines.length) return null
  const continues = (text: string): boolean => /\\\s*$/.test(text)

  // A blank line directly below a command still counts as being "in" it -
  // that is where the caret lands after typing one, and where Cmd+End (or a
  // file's trailing newline) leaves it.
  if (lines[line].trim() === '' && line > 0 && lines[line - 1].trim() !== '') line -= 1

  let start = line
  while (start > 0 && continues(lines[start - 1])) start -= 1
  if (!looksLikeCurl(lines[start])) return null

  let end = start
  while (end < lines.length - 1 && continues(lines[end])) end += 1
  return lines.slice(start, end + 1).join('\n')
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// The inverse direction: hand a request to a colleague, a terminal, or a bug
// report. Multi-line with backslash continuations, the way people write them.
export function toCurl(spec: HttpRequestSpec): string {
  const lines: string[] = [`curl -i -X ${spec.method} ${shellQuote(spec.url)}`]
  for (const header of spec.headers) {
    lines.push(`  -H ${shellQuote(`${header.name}: ${header.value}`)}`)
  }
  for (const part of spec.form ?? []) {
    lines.push(
      `  -F ${shellQuote(part.filePath ? `${part.name}=@${part.filePath}` : `${part.name}=${part.value ?? ''}`)}`
    )
  }
  if (spec.bodyFilePath) lines.push(`  --data-binary ${shellQuote(`@${spec.bodyFilePath}`)}`)
  else if (spec.body) lines.push(`  --data-raw ${shellQuote(spec.body)}`)
  if (spec.followRedirects) lines.push('  -L')
  if (spec.insecure) lines.push('  -k')
  return lines.join(' \\\n')
}
