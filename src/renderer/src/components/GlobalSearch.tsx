import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import {
  Search as SearchIcon,
  X,
  FileText,
  ChevronDown,
  ChevronRight,
  CaseSensitive,
  WholeWord,
  Regex,
  Replace as ReplaceIcon,
  Undo2
} from 'lucide-react'
import type { SearchResult } from '../../../shared/searchResult'
import {
  buildSearchRegex,
  replacementFor,
  type ReplaceResult,
  type SearchOptions
} from '../../../shared/searchQuery'

interface GlobalSearchProps {
  onClose: () => void
  onSelect: (path: string, line?: number, highlight?: { col: number; matchLen: number }) => void
  // Files whose tab has edits that haven't hit disk yet. Replacing in one
  // would be overwritten by that tab's next autosave, so they are excluded
  // from the selection and say why.
  unsavedPaths?: string[]
  // IDEA-style query persistence: the query this overlay opens with (last
  // session query, or the editor selection), reported back on every change
  // so the next opening can restore it.
  initialQuery?: string
  onQueryChange?: (query: string) => void
  // "Replace in Files" opens the same overlay with the replace row already
  // showing (Cmd+Shift+R), rather than being a second dialog.
  initialShowReplace?: boolean
}

interface FileGroup {
  path: string
  file: string
  matches: SearchResult[]
}

// The keyboard/mouse-navigable rows: a collapsible per-file header followed by
// its matches (omitted while the file is collapsed).
type VisibleItem = { kind: 'file'; group: FileGroup } | { kind: 'match'; result: SearchResult }

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  onClose,
  onSelect,
  initialQuery,
  onQueryChange,
  initialShowReplace,
  unsavedPaths
}) => {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  // Search options, kept as separate primitives so the fetch effect depends on
  // values rather than on a freshly-built object every render.
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [include, setInclude] = useState('')
  const [showReplace, setShowReplace] = useState(!!initialShowReplace)
  const [replacement, setReplacement] = useState('')
  // Opt-*out*: everything found is replaced unless the user unchecks it, which
  // is the way this is used - narrow with the query, not with the checkboxes.
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set())
  const [isReplacing, setIsReplacing] = useState(false)
  const [replaceStatus, setReplaceStatus] = useState<{
    text: string
    canUndo: boolean
    failed: boolean
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRowRef = useRef<HTMLDivElement>(null)

  const options = useMemo<SearchOptions>(
    () => ({ caseSensitive: matchCase, wholeWord, regex: useRegex, include }),
    [matchCase, wholeWord, useRegex, include]
  )
  const unsaved = useMemo(() => new Set(unsavedPaths ?? []), [unsavedPaths])
  // Only a regex the user typed can be invalid; a literal query is escaped.
  const patternInvalid = useRegex && query.length > 0 && !buildSearchRegex(query, options)
  // `results`/`isSearching` can briefly hold stale data from an abandoned
  // search (e.g. right after the query shrinks back below 2 characters,
  // before this becomes false) - gating every render branch on it, rather
  // than resetting those two pieces of state reactively, keeps the effect
  // below a plain "fetch on change" one with no unconditional setState calls
  // of its own.
  const hasQuery = query.length >= 2

  const groups = useMemo<FileGroup[]>(() => {
    const byPath = new Map<string, FileGroup>()
    for (const res of results) {
      let group = byPath.get(res.path)
      if (!group) {
        group = { path: res.path, file: res.file, matches: [] }
        byPath.set(res.path, group)
      }
      group.matches.push(res)
    }
    return [...byPath.values()]
  }, [results])

  const visibleItems = useMemo<VisibleItem[]>(() => {
    const items: VisibleItem[] = []
    for (const group of groups) {
      items.push({ kind: 'file', group })
      if (!collapsedPaths.has(group.path)) {
        for (const result of group.matches) items.push({ kind: 'match', result })
      }
    }
    return items
  }, [groups, collapsedPaths])

  // Collapsing a group can shrink the list below the current selection.
  const selIndex = Math.min(selectedIndex, Math.max(visibleItems.length - 1, 0))

  const activateResult = useCallback(
    (res: SearchResult): void =>
      onSelect(res.path, res.line, { col: res.col, matchLen: res.matchLen }),
    [onSelect]
  )

  const toggleCollapsed = useCallback((path: string): void => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    // Pre-select any restored query so just starting to type replaces it,
    // while Enter/arrows still work with it as-is.
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selIndex, visibleItems])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(Math.min(selIndex + 1, Math.max(visibleItems.length - 1, 0)))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(Math.max(selIndex - 1, 0))
      }
      const item = hasQuery ? visibleItems[selIndex] : undefined
      if (!item) return
      if (e.key === 'Enter') {
        if (item.kind === 'match') activateResult(item.result)
        else toggleCollapsed(item.group.path)
      }
      if (e.key === 'ArrowRight' && item.kind === 'file' && collapsedPaths.has(item.group.path)) {
        e.preventDefault()
        toggleCollapsed(item.group.path)
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (item.kind === 'file') {
          if (!collapsedPaths.has(item.group.path)) toggleCollapsed(item.group.path)
        } else {
          // Jump from a match back up to its file header.
          const headerIndex = visibleItems.findIndex(
            (v) => v.kind === 'file' && v.group.path === item.result.path
          )
          if (headerIndex !== -1) setSelectedIndex(headerIndex)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, visibleItems, selIndex, hasQuery, activateResult, toggleCollapsed, collapsedPaths])

  useEffect(() => {
    if (!hasQuery) return undefined

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsSearching(true)
      const searchResults = await window.api.searchProjects(query, options)
      if (cancelled) return
      setResults(searchResults)
      setSelectedIndex(0)
      setCollapsedPaths(new Set())
      setExcludedPaths(new Set())
      setIsSearching(false)
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, hasQuery, options])

  // The files Replace All would rewrite: everything found, minus what the
  // user unchecked, minus anything with unsaved edits in a tab.
  const targetPaths = useMemo(
    () => groups.map((g) => g.path).filter((p) => !excludedPaths.has(p) && !unsaved.has(p)),
    [groups, excludedPaths, unsaved]
  )
  const targetMatches = useMemo(
    () => results.filter((r) => targetPaths.includes(r.path)).length,
    [results, targetPaths]
  )
  const blockedByUnsaved = useMemo(
    () => groups.filter((g) => unsaved.has(g.path)).length,
    [groups, unsaved]
  )

  // What a line looks like after the replacement, computed with the same
  // matcher main will use (shared/searchQuery) so the preview cannot promise
  // something else.
  const previewLine = useCallback(
    (line: string): string => {
      const matcher = buildSearchRegex(query, options)
      if (!matcher) return line
      return line.replace(matcher, replacementFor(replacement, options))
    },
    [query, options, replacement]
  )

  const refreshResults = useCallback(async (): Promise<void> => {
    const searchResults = await window.api.searchProjects(query, options)
    setResults(searchResults)
    setSelectedIndex(0)
  }, [query, options])

  const runReplace = useCallback(async (): Promise<void> => {
    if (targetPaths.length === 0 || isReplacing) return
    setIsReplacing(true)
    const result: ReplaceResult = await window.api.replaceInFiles({
      paths: targetPaths,
      query,
      replacement,
      options
    })
    const summary = `Replaced ${result.replacements} ${
      result.replacements === 1 ? 'occurrence' : 'occurrences'
    } in ${result.filesChanged} ${result.filesChanged === 1 ? 'file' : 'files'}`
    setReplaceStatus({
      text: result.error ? `${summary} — ${result.error.split('\n')[0]}` : summary,
      canUndo: result.canUndo,
      failed: !result.success
    })
    await refreshResults()
    setIsReplacing(false)
  }, [targetPaths, isReplacing, query, replacement, options, refreshResults])

  const undoReplace = useCallback(async (): Promise<void> => {
    setIsReplacing(true)
    const result = await window.api.undoReplaceInFiles()
    setReplaceStatus({
      text: result.success
        ? `Reverted ${result.filesChanged} ${result.filesChanged === 1 ? 'file' : 'files'}`
        : (result.error ?? 'Could not undo'),
      canUndo: false,
      failed: !result.success
    })
    await refreshResults()
    setIsReplacing(false)
  }, [refreshResults])

  const toggleFile = useCallback((path: string): void => {
    setExcludedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[600px] max-h-[60vh] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Search Input Area */}
        <div className="p-4 border-b border-fleet-border flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowReplace((open) => !open)}
              aria-label={showReplace ? 'Hide Replace' : 'Show Replace'}
              title={showReplace ? 'Hide replace' : 'Replace in files'}
              className="p-1 rounded text-gray-500 hover:bg-fleet-active hover:text-gray-200"
            >
              {showReplace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <SearchIcon size={20} className="text-gray-500" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search in all projects..."
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-fleet-text text-lg"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                onQueryChange?.(e.target.value)
              }}
            />
            {/* The three matcher toggles, in the order every search field puts
                them; each one re-runs the search through the same effect the
                query does. */}
            {(
              [
                ['Match case', CaseSensitive, matchCase, setMatchCase],
                ['Whole word', WholeWord, wholeWord, setWholeWord],
                ['Regular expression', Regex, useRegex, setUseRegex]
              ] as const
            ).map(([label, Icon, active, set]) => (
              <button
                key={label}
                aria-label={label}
                title={label}
                aria-pressed={active}
                onClick={() => set((on) => !on)}
                className={clsx(
                  'p-1 rounded shrink-0',
                  active
                    ? 'bg-fleet-active text-blue-400'
                    : 'text-gray-500 hover:bg-fleet-active hover:text-gray-200'
                )}
              >
                <Icon size={16} />
              </button>
            ))}
            <button onClick={onClose} className="p-1 hover:bg-fleet-active rounded text-gray-500">
              <X size={18} />
            </button>
          </div>

          {showReplace && (
            <div className="flex items-center gap-3 pl-[30px]">
              <ReplaceIcon size={20} className="text-gray-500 shrink-0" />
              <input
                type="text"
                placeholder="Replace with..."
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-fleet-text text-lg"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
              <button
                onClick={runReplace}
                disabled={!hasQuery || patternInvalid || isReplacing || targetPaths.length === 0}
                className="px-3 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500 shrink-0"
              >
                {isReplacing ? 'Replacing…' : `Replace All (${targetMatches})`}
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 pl-[30px]">
            <input
              type="text"
              placeholder="Files to include: *.ts, src/**"
              className="flex-1 min-w-0 bg-fleet-header/60 rounded px-2 py-1 border border-transparent focus:border-fleet-border outline-none text-xs text-fleet-text placeholder:text-gray-600"
              value={include}
              onChange={(e) => setInclude(e.target.value)}
            />
            {patternInvalid && (
              <span className="text-[10px] text-red-400 shrink-0">Invalid regular expression</span>
            )}
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto min-h-[100px]">
          {hasQuery && isSearching && (
            <div className="p-8 text-center text-gray-500 text-sm animate-pulse">Searching...</div>
          )}

          {hasQuery && !isSearching && visibleItems.length > 0 && (
            <div className="py-2">
              {visibleItems.map((item, i) => {
                const rowRef = i === selIndex ? selectedRowRef : undefined
                const rowBg = selIndex === i ? 'bg-fleet-active' : 'hover:bg-fleet-active'
                if (item.kind === 'file') {
                  const isCollapsed = collapsedPaths.has(item.group.path)
                  const isUnsaved = unsaved.has(item.group.path)
                  return (
                    <div
                      key={item.group.path}
                      ref={rowRef}
                      className={`px-3 py-1.5 cursor-pointer select-none flex items-center gap-2 ${rowBg}`}
                      onClick={() => {
                        setSelectedIndex(i)
                        toggleCollapsed(item.group.path)
                      }}
                    >
                      {showReplace && (
                        <input
                          type="checkbox"
                          aria-label={`Replace in ${item.group.file}`}
                          className="shrink-0 accent-blue-500 disabled:opacity-40"
                          checked={!excludedPaths.has(item.group.path) && !isUnsaved}
                          disabled={isUnsaved}
                          title={
                            isUnsaved ? 'Save this tab first — its edits are not on disk yet' : ''
                          }
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleFile(item.group.path)}
                        />
                      )}
                      {isCollapsed ? (
                        <ChevronRight size={14} className="text-gray-500 shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-500 shrink-0" />
                      )}
                      <FileText size={14} className="text-blue-400 shrink-0" />
                      <span className="text-blue-400 text-sm font-medium truncate">
                        {item.group.file}
                      </span>
                      <span className="text-[10px] text-gray-600 truncate flex-1">
                        {item.group.path}
                      </span>
                      {showReplace && isUnsaved && (
                        <span className="text-[10px] text-amber-400 shrink-0">unsaved</span>
                      )}
                      <span className="text-[10px] text-gray-500 bg-fleet-header rounded-full px-2 py-0.5 shrink-0">
                        {item.group.matches.length}
                      </span>
                    </div>
                  )
                }
                const preview = showReplace ? previewLine(item.result.content) : null
                const willChange =
                  preview !== null &&
                  preview !== item.result.content &&
                  !unsaved.has(item.result.path) &&
                  !excludedPaths.has(item.result.path)
                return (
                  <div
                    key={`${item.result.path}-${item.result.line}-${i}`}
                    ref={rowRef}
                    className={`pl-12 pr-4 py-1 cursor-pointer flex items-baseline gap-3 ${rowBg}`}
                    onClick={() => activateResult(item.result)}
                  >
                    <span className="text-[10px] text-gray-600 shrink-0 w-8 text-right">
                      {item.result.line}
                    </span>
                    <span className="min-w-0 flex flex-col">
                      <span
                        className={clsx(
                          'text-xs font-mono truncate',
                          willChange
                            ? 'text-gray-500 line-through decoration-gray-700'
                            : 'text-gray-400'
                        )}
                      >
                        {item.result.content}
                      </span>
                      {willChange && (
                        <span className="text-xs text-emerald-400 font-mono truncate">
                          {preview}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {hasQuery && !isSearching && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">
              {`No results found for "${query}"`}
            </div>
          )}

          {!hasQuery && (
            <div className="p-8 text-center text-gray-600 text-sm italic">
              Type at least 2 characters to search...
            </div>
          )}
        </div>

        {/* Footer */}
        {replaceStatus && (
          <div
            className={clsx(
              'px-4 py-2 border-t border-fleet-border text-xs flex items-center justify-between gap-3',
              replaceStatus.failed ? 'text-red-400' : 'text-emerald-400'
            )}
          >
            <span className="truncate">{replaceStatus.text}</span>
            {replaceStatus.canUndo && (
              <button
                onClick={undoReplace}
                disabled={isReplacing}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-fleet-text hover:bg-fleet-active shrink-0 disabled:opacity-40"
              >
                <Undo2 size={12} />
                Undo
              </button>
            )}
          </div>
        )}
        <div className="px-4 py-2 bg-fleet-header border-t border-fleet-border text-[10px] text-gray-600 flex justify-between">
          <span>
            {hasQuery ? `${results.length} matches in ${groups.length} files` : '0 matches found'}
            {showReplace && blockedByUnsaved > 0 && (
              <span className="text-amber-500">
                {` • ${blockedByUnsaved} skipped (unsaved edits)`}
              </span>
            )}
          </span>
          <span>ESC to close • ENTER to open • ←/→ to fold</span>
        </div>
      </div>
    </div>
  )
}
