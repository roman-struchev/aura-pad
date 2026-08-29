import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Command as CommandIcon } from 'lucide-react'
import { formatAccelerator, type Command } from '../lib/commands'
import { fuzzyRank } from '../lib/fuzzy'

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

// Highlights the characters the query matched, so a fuzzy hit explains
// itself ("tgp" landing on Toggle Git Panel). Weight rather than a colour:
// the app has four themes, two of them light, and an accent picked for one
// of them is unreadable on another.
const Highlighted: React.FC<{ text: string; indices: number[] }> = ({ text, indices }) => {
  const marked = new Set(indices)
  return (
    <>
      {[...text].map((ch, i) =>
        marked.has(i) ? (
          <span key={i} className="font-semibold text-fleet-textHover">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  )
}

// Every action the app has, in one list, found by typing part of its name -
// the IDEA "Find Action" key. Nothing is registered here: the entries come
// from lib/commands.ts, which is a view over the same handlers the native
// menu already drives.
export const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, onClose }) => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The group is searched along with the label, so "git" finds "Toggle Git
  // Panel" and "view" lists what lives in the View menu.
  const results = useMemo(
    () => fuzzyRank(commands, query, (c) => `${c.label} ${c.group}`).slice(0, 40),
    [commands, query]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keeps the highlighted row in view while arrowing past the visible slice.
  useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // The key handler subscribes once and reads the live list and selection
  // through refs - a state updater is not the place to run a command from
  // (React may invoke it twice).
  const resultsRef = useRef(results)
  const selectedRef = useRef(selectedIndex)
  useEffect(() => {
    resultsRef.current = results
    selectedRef.current = selectedIndex
  })

  const run = useCallback(
    (command: Command): void => {
      // Close first: several commands open a dialog of their own, and this one
      // must be out of the way (and out of the focus chain) before it does.
      onClose()
      command.run()
    },
    [onClose]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const rows = resultsRef.current
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, rows.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      }
      if (e.key === 'Enter') {
        const command = rows[selectedRef.current]?.item
        if (command) run(command)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, run])

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm">
      <div className="w-[520px] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center p-3 border-b border-fleet-border gap-2">
          <CommandIcon size={18} className="text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type an action…"
            className="flex-1 bg-transparent border-none outline-none text-fleet-text text-base"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              // Reset here rather than in an effect on `query`: typing is the
              // only thing that changes it, and an effect would re-render.
              setSelectedIndex(0)
            }}
          />
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {results.map(({ item, indices }, i) => (
            <div
              key={item.id}
              data-command={item.id}
              className={`px-4 py-2 flex items-center gap-3 cursor-pointer ${
                selectedIndex === i ? 'bg-fleet-active' : 'hover:bg-fleet-active/50'
              }`}
              onClick={() => run(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="text-[10px] uppercase tracking-wider text-gray-600 w-10 shrink-0">
                {item.group}
              </span>
              <span className="text-sm text-fleet-text truncate">
                <Highlighted
                  text={item.label}
                  indices={indices.filter((n) => n < item.label.length)}
                />
              </span>
              {item.accelerator && (
                <span className="ml-auto text-[10px] text-gray-500 shrink-0">
                  {formatAccelerator(item.accelerator, window.api.platform)}
                </span>
              )}
            </div>
          ))}
          {results.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">
              No action matching “{query}”
            </div>
          )}
        </div>

        <div className="px-3 py-1.5 bg-fleet-header border-t border-fleet-border text-[9px] text-gray-600 flex justify-between uppercase tracking-wider">
          <span>{results.length === 1 ? '1 action' : `${results.length} actions`}</span>
          <span>Enter to run · Esc to close</span>
        </div>
      </div>
    </div>
  )
}
