// The file's structure, without a language server: Markdown headings and
// regex-extracted declarations for JS/TS and Python. Feeds Quick Open's
// `#symbol` mode (see components/FileSearch.tsx).
//
// This is a navigation aid, not a parser. It reads one line at a time and
// deliberately errs towards missing a declaration rather than inventing one -
// a list with junk in it is worse than a short list, because the point is to
// jump somewhere in one keystroke.

export type SymbolKind = 'heading' | 'class' | 'interface' | 'type' | 'function' | 'constant'

export interface FileSymbol {
  name: string
  kind: SymbolKind
  // 1-based, as Monaco counts them.
  line: number
  // Nesting depth, purely for indentation in the list.
  level: number
}

const MARKDOWN = /\.(md|markdown)$/i
const SCRIPT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const PYTHON = /\.py$/i

export function supportsSymbols(path: string | null): boolean {
  return !!path && (MARKDOWN.test(path) || SCRIPT.test(path) || PYTHON.test(path))
}

// Headings, skipping fenced code blocks (a `# comment` inside a shell snippet
// is not a heading) - the same rule the Markdown folding provider uses.
function markdownSymbols(lines: string[]): FileSymbol[] {
  const symbols: FileSymbol[] = []
  let inFence = false
  lines.forEach((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const match = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match) {
      symbols.push({
        name: match[2],
        kind: 'heading',
        line: i + 1,
        level: match[1].length - 1
      })
    }
  })
  return symbols
}

// Words that would otherwise be read as a method declaration: `if (…) {`
// looks exactly like one to a regex.
const NOT_A_NAME = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'else',
  'do',
  'try',
  'function',
  'constructor',
  'await',
  'typeof',
  'new'
])

const SCRIPT_PATTERNS: { re: RegExp; kind: SymbolKind }[] = [
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: 'class'
  },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: 'type' },
  { re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: 'function'
  }
]

// `const foo = () => {`, `const Foo: React.FC<P> = ({ a }) => {`, and the
// multi-line forms where only the opening paren fits on the first line.
const ARROW =
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|<[^>]*>\s*\(|\()/
// A plain exported constant is worth listing when it reads as one (a shouty
// name), and only then - every other assignment would flood the list.
const CONSTANT = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/
// A class member: indented, ends by opening its body. The trailing `{` is
// what separates a declaration from a call spanning several lines.
const METHOD =
  /^\s+(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/

function scriptSymbols(lines: string[]): FileSymbol[] {
  const symbols: FileSymbol[] = []
  let inBlockComment = false
  lines.forEach((text, i) => {
    if (inBlockComment) {
      if (text.includes('*/')) inBlockComment = false
      return
    }
    const trimmed = text.trim()
    if (trimmed.startsWith('//')) return
    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      inBlockComment = true
      return
    }
    const indent = text.length - text.trimStart().length
    const level = Math.min(2, Math.floor(indent / 2))
    const push = (name: string, kind: SymbolKind): void => {
      symbols.push({ name, kind, line: i + 1, level })
    }
    for (const { re, kind } of SCRIPT_PATTERNS) {
      const match = text.match(re)
      if (match) {
        push(match[1], kind)
        return
      }
    }
    const arrow = text.match(ARROW)
    if (arrow) {
      push(arrow[1], 'function')
      return
    }
    const constant = text.match(CONSTANT)
    if (constant) {
      push(constant[1], 'constant')
      return
    }
    const method = text.match(METHOD)
    if (method && !NOT_A_NAME.has(method[1])) push(method[1], 'function')
  })
  return symbols
}

function pythonSymbols(lines: string[]): FileSymbol[] {
  const symbols: FileSymbol[] = []
  lines.forEach((text, i) => {
    const match = text.match(/^(\s*)(?:(?:async\s+)?def|class)\s+([A-Za-z_]\w*)/)
    if (!match) return
    symbols.push({
      name: match[2],
      kind: text.trimStart().startsWith('class') ? 'class' : 'function',
      line: i + 1,
      level: Math.min(2, Math.floor(match[1].replace(/\t/g, '    ').length / 4))
    })
  })
  return symbols
}

export function extractSymbols(path: string | null, content: string): FileSymbol[] {
  if (!path) return []
  const lines = content.split('\n')
  if (MARKDOWN.test(path)) return markdownSymbols(lines)
  if (SCRIPT.test(path)) return scriptSymbols(lines)
  if (PYTHON.test(path)) return pythonSymbols(lines)
  return []
}
