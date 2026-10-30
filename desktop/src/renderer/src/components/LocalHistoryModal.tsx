import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { DiffEditor } from '@monaco-editor/react'
import { Modal } from './Modal'
import { getLanguage } from '../lib/language'
import type { LocalHistoryEntry } from '../../../shared/localHistory'

interface LocalHistoryModalProps {
  filePath: string
  // The buffer as it is right now - what each stored version is diffed
  // against, so the comparison matches what the user is looking at rather
  // than what happens to be on disk.
  currentContent: string
  monacoTheme: string
  onRestore: (content: string) => void
  onClose: () => void
}

function relativeTime(at: number): string {
  const seconds = Math.floor((Date.now() - at) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(at).toLocaleDateString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
}

// The way back out of a save. Every version AuraPad stored for this file on
// the left, the diff from that version to the current buffer on the right.
//
// Restore hands the text to the editor rather than writing it to disk: it
// lands as one undoable edit in the tab, so Cmd+Z takes it back and the
// ordinary save path (with its own encoding handling) is what puts it on
// disk - the same route Format Document takes.
export const LocalHistoryModal: React.FC<LocalHistoryModalProps> = ({
  filePath,
  currentContent,
  monacoTheme,
  onRestore,
  onClose
}) => {
  const [entries, setEntries] = useState<LocalHistoryEntry[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The version that has actually been fetched, tagged with the id it belongs
  // to - one piece of state rather than three, so switching versions never
  // has to be cleared synchronously and can't show one version's text under
  // another one's selection.
  const [loaded, setLoaded] = useState<{ id: string; content?: string; error?: string } | null>(
    null
  )

  useEffect(() => {
    let alive = true
    void window.api.localHistoryList(filePath).then((list) => {
      if (!alive) return
      setEntries(list)
      setSelectedId(list[0]?.id ?? null)
    })
    return () => {
      alive = false
    }
  }, [filePath])

  useEffect(() => {
    if (!selectedId) return
    let alive = true
    void window.api.localHistoryRead(filePath, selectedId).then((result) => {
      if (!alive) return
      setLoaded({
        id: selectedId,
        content: result.success ? (result.content ?? '') : undefined,
        error: result.success ? undefined : (result.error ?? 'That version could not be read.')
      })
    })
    return () => {
      alive = false
    }
  }, [filePath, selectedId])

  // Only the fetch that belongs to the current selection counts; anything
  // else is a stale answer for a version that is no longer showing.
  const shown = loaded?.id === selectedId ? loaded : null
  const snapshot = shown?.content ?? null

  const name = filePath.split('/').pop() ?? filePath

  return (
    <Modal
      onClose={onClose}
      title={`Local History — ${name}`}
      width="w-[90vw]"
      height="h-[80vh]"
      bodyClassName="flex flex-1 min-h-0"
    >
      <div className="w-56 shrink-0 border-r border-fleet-border overflow-y-auto py-1">
        {entries === null && <div className="px-3 py-2 text-xs text-gray-500">Loading…</div>}
        {entries?.length === 0 && (
          <div className="px-3 py-2 text-xs text-gray-500">
            No earlier versions yet. One is stored each time AuraPad writes this file.
          </div>
        )}
        {entries?.map((entry) => (
          <button
            key={entry.id}
            data-history-entry={entry.id}
            onClick={() => setSelectedId(entry.id)}
            className={clsx(
              'w-full text-left px-3 py-1.5 flex flex-col gap-0.5 transition-colors',
              entry.id === selectedId ? 'bg-fleet-active' : 'hover:bg-fleet-active/50'
            )}
            title={new Date(entry.at).toLocaleString()}
          >
            <span className="text-xs text-fleet-text truncate">{relativeTime(entry.at)}</span>
            <span className="text-[10px] text-gray-500 truncate">
              {entry.label} · {formatSize(entry.bytes)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-fleet-border shrink-0">
          <span className="text-[11px] text-gray-500 truncate">
            Left: the stored version. Right: this tab as it is now.
          </span>
          <button
            className="ml-auto px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shrink-0"
            disabled={snapshot === null}
            onClick={() => {
              if (snapshot === null) return
              onRestore(snapshot)
              onClose()
            }}
          >
            Restore This Version
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {shown?.error && <div className="p-3 text-xs text-red-400">{shown.error}</div>}
          {snapshot !== null && (
            <DiffEditor
              height="100%"
              language={getLanguage(filePath)}
              theme={monacoTheme}
              original={snapshot}
              modified={currentContent}
              options={{ readOnly: true, minimap: { enabled: false } }}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
