import React, { useState, useEffect, useRef } from 'react'
import { File as FileIcon, Folder, Search } from 'lucide-react'
import type { FileNode } from '../../../shared/fileNode'

interface FileResult {
  name: string
  path: string
  type: 'file' | 'directory'
}

interface FileSearchProps {
  onClose: () => void
  onSelect: (path: string, type: 'file' | 'directory') => void
  rootNodes: FileNode[]
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

export const FileSearch: React.FC<FileSearchProps> = ({ onClose, onSelect, rootNodes }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileResult[]>([])
  const [allEntries, setAllEntries] = useState<FileResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pathMode = isPathQuery(query)

  // Selecting a directory while browsing a real path drills into it instead
  // of "opening" it - there's no workspace to reveal it in. Everywhere else
  // (fuzzy workspace search) behaves exactly as before.
  const activateResult = (res: FileResult): void => {
    if (pathMode && res.type === 'directory') {
      setQuery(res.path + '/')
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
        activateResult(results[selectedIndex])
      }
      if (e.key === 'Tab' && pathMode && results[selectedIndex]) {
        e.preventDefault()
        const res = results[selectedIndex]
        const lastSlash = query.lastIndexOf('/')
        setQuery(query.slice(0, lastSlash + 1) + res.name + (res.type === 'directory' ? '/' : ''))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, results, selectedIndex, onSelect, query, pathMode])

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
        setResults(entries)
        setSelectedIndex(0)
      })
      return () => {
        cancelled = true
      }
    }

    const q = query.toLowerCase()
    const filtered = allEntries
      .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 20) // Show top 20 matches
    setResults(filtered)
    setSelectedIndex(0)
    return undefined
  }, [query, allEntries, pathMode])

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm">
      <div className="w-[500px] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center p-3 border-b border-fleet-border gap-2">
          <Search size={18} className="text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search files, or type ~/ for a path outside the workspace..."
            className="flex-1 bg-transparent border-none outline-none text-fleet-text text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {results.map((res, i) => (
            <div
              key={res.path}
              className={`px-4 py-2 flex flex-col cursor-pointer ${selectedIndex === i ? 'bg-fleet-active' : 'hover:bg-fleet-active/50'}`}
              onClick={() => activateResult(res)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="flex items-center gap-2 text-sm text-gray-200">
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
          ))}
          {query && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No files matching "{query}"</div>
          )}
          {!query && (
            <div className="p-8 text-center text-gray-600 text-sm italic">
              Start typing a filename...
            </div>
          )}
        </div>

        <div className="px-3 py-1.5 bg-fleet-header border-t border-fleet-border text-[9px] text-gray-600 flex justify-between uppercase tracking-wider">
          <span>{results.length} results found</span>
          <span>
            {pathMode ? 'Tab to Complete · Double-Shift to Close' : 'Double-Shift to Close'}
          </span>
        </div>
      </div>
    </div>
  )
}
