import { useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { ChevronRight } from 'lucide-react'
import { extractSymbols, supportsSymbols, type FileSymbol } from '../lib/symbols'
import { modelUri } from '../lib/modelUri'

// The strip above the editor: where the file is (project › folders › file)
// and where the cursor is inside it (the enclosing heading or declaration
// chain, from the same best-effort symbol list as Quick Open's `#` mode - no
// language server, so a symbol "encloses" the cursor from its line until the
// next symbol at its level or above). Clicking the path reveals the file in
// the tree; clicking a symbol jumps to it.

interface Props {
  editor: monaco.editor.IStandaloneCodeEditor | null
  path: string
  rootPaths: string[]
  // Show that folder (or the file itself) in the tree.
  onRevealPath: (path: string) => void
  // The file's action buttons, moved here from their spot over the editor.
  actions?: React.ReactNode
}

const SYMBOL_DELAY_MS = 150

const indentOf = (text: string): number => text.length - text.trimStart().length

// The symbols whose span contains `line`, outermost first. Headings nest by
// level and run until the next one at their level or above. A declaration in
// code has no such marker, so its body is read off the indentation: it ends
// at the first later line indented no deeper than the declaration itself -
// its closing brace, or the next statement in a brace-less language. Lines
// opening with `)` or `]` are let through so a signature wrapped over several
// lines doesn't close the function before its body starts.
function symbolChain(symbols: FileSymbol[], lines: string[], line: number): FileSymbol[] {
  let chain: FileSymbol[] = []
  for (const symbol of symbols) {
    if (symbol.line > line) break
    chain = chain.filter((s) => s.level < symbol.level)
    chain.push(symbol)
  }
  return chain.filter((symbol) => {
    if (symbol.kind === 'heading') return true
    const indent = indentOf(lines[symbol.line - 1] ?? '')
    for (let i = symbol.line; i < line - 1; i++) {
      const text = lines[i]
      if (!text.trim() || /^\s*[)\]]/.test(text)) continue
      if (indentOf(text) <= indent) return false
    }
    return true
  })
}

interface Segment {
  label: string
  path: string
}

// project › folders › file, each with the path a click reveals.
function pathSegments(path: string, rootPaths: string[]): Segment[] {
  const root = rootPaths
    .filter((r) => path.startsWith(r + '/'))
    .sort((a, b) => b.length - a.length)[0]
  const parts = (root ? path.slice(root.length + 1) : path).split('/').filter(Boolean)
  const segments: Segment[] = []
  let current = root ?? ''
  if (root) segments.push({ label: root.split('/').pop() ?? root, path: root })
  for (const part of parts) {
    current = `${current}/${part}`
    segments.push({ label: part, path: current })
  }
  // Outside every workspace there is nothing to anchor to; the last few
  // folders say enough.
  return root ? segments : segments.slice(-3)
}

export function Breadcrumbs({
  editor,
  path,
  rootPaths,
  onRevealPath,
  actions
}: Props): React.JSX.Element {
  // Tagged with the file it was computed for, so switching tabs shows no
  // symbols (rather than the previous file's) until the new ones are in.
  const [computed, setComputed] = useState<{ path: string; chain: FileSymbol[] } | null>(null)
  const chain = editor && computed?.path === path ? computed.chain : []

  useEffect(() => {
    if (!editor || !supportsSymbols(path)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const model = editor.getModel()
        const position = editor.getPosition()
        if (!model || !position || model.uri.toString() !== modelUri(path).toString()) return
        const text = model.getValue()
        setComputed({
          path,
          chain: symbolChain(extractSymbols(path, text), text.split('\n'), position.lineNumber)
        })
      }, SYMBOL_DELAY_MS)
    }
    update()
    const subs = [
      editor.onDidChangeCursorPosition(update),
      editor.onDidChangeModelContent(update),
      editor.onDidChangeModel(update)
    ]
    return () => {
      clearTimeout(timer)
      subs.forEach((s) => s.dispose())
    }
  }, [editor, path])

  const segments = pathSegments(path, rootPaths)
  const jumpTo = (line: number): void => {
    if (!editor) return
    editor.revealLineInCenterIfOutsideViewport(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
  }
  const separator = <ChevronRight size={11} className="shrink-0 opacity-50" />

  return (
    // Not overflow-hidden itself: the action buttons' tooltips hang below
    // the strip, over the editor - only the crumbs are clipped.
    <div
      data-testid="breadcrumbs"
      className={
        'relative z-20 flex items-center gap-2 pl-3 pr-1 shrink-0 text-[11.5px] text-fleet-text border-b border-fleet-border bg-fleet-bg whitespace-nowrap select-none ' +
        (actions ? 'h-[24px]' : 'h-[22px]')
      }
    >
      <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        {segments.map((segment, i) => (
          <span key={segment.path} className="flex items-center gap-1 min-w-0">
            {i > 0 && separator}
            <button
              className={
                i === segments.length - 1
                  ? 'text-fleet-textHover hover:underline truncate'
                  : 'opacity-70 hover:opacity-100 hover:underline truncate'
              }
              onClick={() => onRevealPath(segment.path)}
              title="Reveal in file tree"
            >
              {segment.label}
            </button>
          </span>
        ))}
        {chain.map((symbol) => (
          <span key={`${symbol.line}:${symbol.name}`} className="flex items-center gap-1 min-w-0">
            {separator}
            <button
              data-testid="breadcrumb-symbol"
              className="opacity-80 hover:opacity-100 hover:underline truncate"
              onClick={() => jumpTo(symbol.line)}
              title={`${symbol.kind} · line ${symbol.line}`}
            >
              {symbol.name}
            </button>
          </span>
        ))}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}
