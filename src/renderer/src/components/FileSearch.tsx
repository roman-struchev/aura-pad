import React, { useState, useEffect, useMemo, useRef } from 'react'
import { File as FileIcon, Folder, Hash, Search, SquareFunction, Box, Variable } from 'lucide-react'
import type { FileNode } from '../../../shared/fileNode'
import { extractSymbols, supportsSymbols, type FileSymbol } from '../lib/symbols'
import { parseQuickOpen, type QuickOpenLocator } from '../lib/quickOpenQuery'
import { fuzzyRank } from '../lib/fuzzy'
import { basename } from '../lib/path'

interface FileResult {
  name: string
  path: string
  type: 'file' | 'directory'
}

// What a row in the list stands for: a file (or folder) to open, a symbol in
// the file that is already open, or a plain line number in it.
type Row =
  | { kind: 'file'; file: FileResult }
  | { kind: 'symbol'; path: string; symbol: FileSymbol }
  | { kind: 'line'; path: string; line: number }

interface FileSearchProps {
  onClose: () => void
  // `line` is only ever set for a locator query (":42" / "#symbol").
  onSelect: (path: string, type: 'file' | 'directory', line?: number) => void
  rootNodes: FileNode[]
  // The open file, whose structure the "#" and ":" modes navigate.
  activePath: string | null
  activeContent: string
  // Normally empty: only set when the user switched here from
  // search-in-files, which hands over whatever was typed there - or when a
  // command ("Go to Line…") opens this dialog already in one of its modes.
  initialQuery?: string
  // Reported on every change so the switch works in the other direction too.
  onQueryChange?: (query: string) => void
}

// Strips the matching workspace root's absolute path off, prefixing the
// root folder's own name instead - so results read like "myproject/src/App.tsx"
// rather than a full local filesystem path.
function toRelativeDisplay(path: string, rootNodes: FileNode[]): string {
  const root = rootNodes.find((r) => path === r.path || path.startsWith(r.path + '/'))
  if (!root) return path
  return root.name + path.slice(root.path.length)
}

// Typing an absolute or home-relative path switches Quick Open from fuzzy
// workspace search into browsing the real filesystem - the only way to
// reach a file that isn't under any open workspace without adding it as one.
function isPathQuery(query: string): boolean {
  return query.startsWith('~') || query.startsWith('/')
}

const SYMBOL_ICON: Record<FileSymbol['kind'], typeof Hash> = {
  heading: Hash,
  class: Box,
  interface: Box,
  type: Box,
  function: SquareFunction,
  constant: Variable
}

export const FileSearch: React.FC<FileSearchProps> = ({
  onClose,
  onSelect,
  rootNodes,
  activePath,
  activeContent,
  initialQuery,
  onQueryChange
}) => {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<Row[]>([])
  const [allEntries, setAllEntries] = useState<FileResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pathMode = isPathQuery(query)
  const parsed = pathMode ? { file: query, locator: null } : parseQuickOpen(query)
  // "Everything after the : or # applies to the file already open" - the mode
  // that turns Quick Open into a file-structure view.
  const localMode = !!parsed.locator && parsed.file === ''
  // Read through a ref: App passes a fresh arrow on every render, and this
  // must not turn into "report the query again on each parent render".
  const onQueryChangeRef = useRef(onQueryChange)
  useEffect(() => {
    onQueryChangeRef.current = onQueryChange
  })

  // An effect rather than a call next to each setQuery: the query also
  // changes on Tab completion and on drilling into a directory, and all of
  // those should be what a switch to search-in-files carries over.
  useEffect(() => {
    onQueryChangeRef.current?.(query)
  }, [query])

  // One scan of the open file, reused for every keystroke of the filter.
  const symbols = useMemo(
    () => (localMode ? extractSymbols(activePath, activeContent) : []),
    [localMode, activePath, activeContent]
  )

  // Where a locator sends us in a file that isn't the open one: the line as
  // typed, or the first symbol matching what was typed after the "#". Null
  // means "just open it" - a symbol that isn't there shouldn't swallow the
  // Enter press.
  const resolveLocator = async (
    path: string,
    locator: QuickOpenLocator
  ): Promise<number | undefined> => {
    if (locator.kind === 'line') return locator.line ?? undefined
    const result = await window.api.readFile(path)
    if (!result.success) return undefined
    const found = fuzzyRank(extractSymbols(path, result.content || ''), locator.text, (s) => s.name)
    return found[0]?.item.line
  }

  // Selecting a directory while browsing a real path drills into it instead
  // of "opening" it - there's no workspace to reveal it in. Everywhere else
  // (fuzzy workspace search) behaves exactly as before, plus the locator.
  const activateResult = async (row: Row): Promise<void> => {
    if (row.kind !== 'file') {
      onSelect(row.path, 'file', row.kind === 'line' ? row.line : row.symbol.line)
      return
    }
    const res = row.file
    if (pathMode && res.type === 'directory') {
      setQuery(res.path + '/')
      return
    }
    if (parsed.locator && res.type === 'file') {
      onSelect(res.path, 'file', await resolveLocator(res.path, parsed.locator))
      return
    }
    onSelect(res.path, res.type)
  }

  // Mount-only: focus the input and load the workspace file list once. This
  // must NOT depend on results/selectedIndex/query - it used to, which meant
  // every arrow-key press or keystroke re-ran this fetch, and the async
  // response landing afterward reset selectedIndex back to 0 (via the effect
  // below), so Arrow keys and mouse hover never visibly moved the selection.
  useEffect(() => {
    inputRef.current?.focus()
    // Pre-select a handed-over query so typing replaces it, the way the
    // search-in-files overlay treats its restored one. A query that opened
    // this dialog in a mode (":" / "#") keeps its cursor at the end instead,
    // so the next keystroke continues it rather than wiping the mode.
    // Read off the input rather than the prop, so this stays a mount-only
    // effect with nothing in its dependency list.
    const seeded = inputRef.current?.value ?? ''
    if (/[:#]$/.test(seeded)) {
      inputRef.current?.setSelectionRange(seeded.length, seeded.length)
    } else {
      inputRef.current?.select()
    }

    // The trees from getWorkspaces() are already filtered server-side
    // (.gitignore + the built-in ignore list), so no need to filter again.
    window.api.getWorkspaces().then((trees) => {
      const flat: FileResult[] = []
      const flatten = (nodes: FileNode[]) => {
        for (const node of nodes) {
          flat.push({ name: node.name, path: node.path, type: node.type })
          if (node.children) flatten(node.children)
        }
      }
      flatten(trees)
      setAllEntries(flat)
    })
  }, [])

  // The activation path is async now (a locator in another file has to read
  // it), so the key handler can't stay in the effect's dependency list -
  // it reads the current row through a ref instead.
  const activateRef = useRef(activateResult)
  useEffect(() => {
    activateRef.current = activateResult
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        activateRef.current(results[selectedIndex])
      }
      if (e.key === 'Tab' && pathMode && results[selectedIndex]?.kind === 'file') {
        e.preventDefault()
        const res = (results[selectedIndex] as { file: FileResult }).file
        const lastSlash = query.lastIndexOf('/')
        setQuery(query.slice(0, lastSlash + 1) + res.name + (res.type === 'directory' ? '/' : ''))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, results, selectedIndex, query, pathMode])

  useEffect(() => {
    if (query.trim() === '') {
      setResults([])
      return
    }

    if (pathMode) {
      // Deliberately does not auto-complete the input as matches narrow
      // down - that would fight Backspace (erasing would just re-trigger
      // the same completion). Matches are shown below the input and only
      // applied to the query on an explicit Tab press.
      let cancelled = false
      window.api.listPathMatches(query).then(({ entries }) => {
        if (cancelled) return
        setResults(entries.map((file: FileResult) => ({ kind: 'file' as const, file })))
        setSelectedIndex(0)
      })
      return () => {
        cancelled = true
      }
    }

    // Re-parsed here rather than closing over the value computed during
    // render, which would drag it into the dependency list below.
    const { file, locator } = parseQuickOpen(query)

    // ":42" / "#symbol" with nothing before them: navigate inside the file
    // that is already open, rather than looking for another one.
    if (localMode && activePath) {
      if (locator?.kind === 'line') {
        setResults(locator.line ? [{ kind: 'line', path: activePath, line: locator.line }] : [])
      } else if (locator?.kind === 'symbol') {
        setResults(
          fuzzyRank(symbols, locator.text, (s) => s.name)
            .slice(0, 50)
            .map(({ item }) => ({ kind: 'symbol' as const, path: activePath, symbol: item }))
        )
      }
      setSelectedIndex(0)
      return undefined
    }

    const q = file.toLowerCase()
    const filtered = allEntries
      .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 20) // Show top 20 matches
    setResults(filtered.map((file) => ({ kind: 'file' as const, file })))
    setSelectedIndex(0)
    return undefined
  }, [query, allEntries, pathMode, localMode, activePath, symbols])

  // What the footer and the empty state should say, which is entirely about
  // which of the three modes the typed query put the dialog in.
  const modeHint = pathMode
    ? 'Tab to Complete · Double-Shift to Close'
    : parsed.locator?.kind === 'symbol'
      ? 'Symbol · Double-Shift to Close'
      : parsed.locator?.kind === 'line'
        ? 'Line · Double-Shift to Close'
        : 'Double-Shift to Close'

  const emptyMessage = (): string => {
    if (!localMode) return `No files matching "${parsed.file}"`
    if (!activePath) return 'Open a file first — ":" and "#" navigate inside it'
    if (parsed.locator?.kind === 'line') return 'Type a line number'
    if (!supportsSymbols(activePath)) return `No structure for ${basename(activePath)}`
    return symbols.length === 0
      ? `Nothing to jump to in ${basename(activePath)}`
      : `No symbol matching "${parsed.locator?.kind === 'symbol' ? parsed.locator.text : ''}"`
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm">
      <div className="w-[500px] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center p-3 border-b border-fleet-border gap-2">
          <Search size={18} className="text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search files, :42 for a line, #symbol for structure..."
            className="flex-1 bg-transparent border-none outline-none text-fleet-text text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {localMode && activePath && (
          <div className="px-3 py-1 border-b border-fleet-border text-[10px] text-gray-500 truncate">
            in {basename(activePath)}
          </div>
        )}

        <div className="max-h-[300px] overflow-y-auto">
          {results.map((row, i) => {
            const selected = selectedIndex === i
            const rowClass = `px-4 py-2 flex flex-col cursor-pointer ${
              selected ? 'bg-fleet-active' : 'hover:bg-fleet-active/50'
            }`
            if (row.kind === 'file') {
              const res = row.file
              return (
                <div
                  key={res.path}
                  // The three row kinds are labelled for the smoke suite,
                  // which cannot tell them apart by text: the editor
                  // underneath the overlay contributes the same words.
                  data-quick-open-file={res.path}
                  className={rowClass}
                  onClick={() => activateResult(row)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className="flex items-center gap-2 text-sm text-fleet-text">
                    {res.type === 'directory' ? (
                      <Folder size={14} className="text-gray-400" />
                    ) : (
                      <FileIcon size={14} className="text-blue-400" />
                    )}
                    <span className="font-medium">{res.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 truncate pl-6">
                    {pathMode ? res.path : toRelativeDisplay(res.path, rootNodes)}
                  </div>
                </div>
              )
            }
            if (row.kind === 'line') {
              return (
                <div
                  key="line"
                  data-quick-open-line={row.line}
                  className={rowClass}
                  onClick={() => activateResult(row)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className="flex items-center gap-2 text-sm text-fleet-text">
                    <Hash size={14} className="text-gray-400" />
                    <span className="font-medium">Go to line {row.line}</span>
                  </div>
                </div>
              )
            }
            const Icon = SYMBOL_ICON[row.symbol.kind]
            return (
              <div
                key={`${row.symbol.line}:${row.symbol.name}`}
                data-quick-open-symbol={row.symbol.name}
                className={rowClass}
                onClick={() => activateResult(row)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div
                  className="flex items-center gap-2 text-sm text-fleet-text"
                  style={{ paddingLeft: row.symbol.level * 12 }}
                >
                  <Icon size={14} className="text-purple-500 shrink-0" />
                  <span className="font-medium truncate">{row.symbol.name}</span>
                  <span className="ml-auto text-[10px] text-gray-500 shrink-0">
                    {row.symbol.line}
                  </span>
                </div>
              </div>
            )
          })}
          {query && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">{emptyMessage()}</div>
          )}
          {!query && (
            <div className="p-8 text-center text-gray-600 text-sm italic">
              Start typing a filename — or <span className="not-italic">:42</span> for a line,{' '}
              <span className="not-italic">#name</span> for this file&apos;s structure
            </div>
          )}
        </div>

        <div className="px-3 py-1.5 bg-fleet-header border-t border-fleet-border text-[9px] text-gray-600 flex justify-between uppercase tracking-wider">
          <span>{results.length === 1 ? '1 result found' : `${results.length} results found`}</span>
          <span>{modeHint}</span>
        </div>
      </div>
    </div>
  )
}
