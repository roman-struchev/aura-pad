import React, { useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { GitBranch, ArrowUpFromLine, ArrowDownToLine, Plus, Minus, RotateCcw } from 'lucide-react'
import type { GitRepoStatus, GitFileEntry } from '../../../shared/gitStatus'
import { Modal } from './Modal'
import { getLanguage } from '../lib/language'

interface GitPanelProps {
  repos: GitRepoStatus[]
  isDark: boolean
  onStage: (root: string, relPath: string) => void
  onUnstage: (root: string, relPath: string) => void
  onDiscard: (root: string, entry: GitFileEntry) => void
  onCommit: (root: string, message: string) => Promise<boolean>
  onPush: (root: string) => void
  onPull: (root: string) => void
  onDiff: (root: string, relPath: string) => Promise<{ original: string; modified: string }>
}

interface FileRowProps {
  entry: GitFileEntry
  onClick: () => void
  actions: { icon: React.ReactNode; title: string; onClick: () => void }[]
}

const FileRow: React.FC<FileRowProps> = ({ entry, onClick, actions }) => (
  <div
    className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-fleet-active cursor-pointer text-xs text-gray-300"
    onClick={onClick}
  >
    <span className="truncate flex-1">{entry.relPath}</span>
    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
      {actions.map((action) => (
        <button
          key={action.title}
          className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white"
          title={action.title}
          onClick={(e) => {
            e.stopPropagation()
            action.onClick()
          }}
        >
          {action.icon}
        </button>
      ))}
    </div>
  </div>
)

// Minimal git panel: current branch, staged/unstaged file lists (click a row
// for a diff, the small +/- button to stage/unstage), a commit box, and
// push/pull. Grouped per workspace root so multiple open repos are legible.
export const GitPanel: React.FC<GitPanelProps> = ({
  repos,
  isDark,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  onPush,
  onPull,
  onDiff
}) => {
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [diffTarget, setDiffTarget] = useState<{
    relPath: string
    original: string
    modified: string
  } | null>(null)

  const openDiff = async (root: string, relPath: string): Promise<void> => {
    const { original, modified } = await onDiff(root, relPath)
    setDiffTarget({ relPath, original, modified })
  }

  if (repos.length === 0) {
    return <div className="text-center mt-10 text-gray-500 text-sm p-4">No git repository.</div>
  }

  return (
    <div className="flex flex-col gap-4 text-sm p-1">
      {repos.map((repo) => (
        <div key={repo.root} className="flex flex-col gap-2">
          {repos.length > 1 && (
            <div className="text-xs font-medium text-gray-400 truncate">
              {repo.root.split('/').pop()}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <GitBranch size={12} />
            <span className="truncate">{repo.branch}</span>
            <div className="flex-1" />
            <button
              className="p-1 hover:bg-fleet-active rounded text-gray-400 hover:text-white"
              title="Pull"
              onClick={() => onPull(repo.root)}
            >
              <ArrowDownToLine size={13} />
            </button>
            <button
              className="p-1 hover:bg-fleet-active rounded text-gray-400 hover:text-white"
              title="Push"
              onClick={() => onPush(repo.root)}
            >
              <ArrowUpFromLine size={13} />
            </button>
          </div>

          {repo.staged.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Staged ({repo.staged.length})
              </div>
              {repo.staged.map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  onClick={() => openDiff(repo.root, entry.relPath)}
                  actions={[
                    {
                      icon: <Minus size={12} />,
                      title: 'Unstage',
                      onClick: () => onUnstage(repo.root, entry.relPath)
                    },
                    {
                      icon: <RotateCcw size={12} />,
                      title: 'Discard changes',
                      onClick: () => onDiscard(repo.root, entry)
                    }
                  ]}
                />
              ))}
            </div>
          )}

          {repo.unstaged.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Changes ({repo.unstaged.length})
              </div>
              {repo.unstaged.map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  onClick={() => openDiff(repo.root, entry.relPath)}
                  actions={[
                    {
                      icon: <Plus size={12} />,
                      title: 'Stage',
                      onClick: () => onStage(repo.root, entry.relPath)
                    },
                    {
                      icon: <RotateCcw size={12} />,
                      title: entry.state === 'untracked' ? 'Delete' : 'Discard changes',
                      onClick: () => onDiscard(repo.root, entry)
                    }
                  ]}
                />
              ))}
            </div>
          )}

          {repo.staged.length === 0 && repo.unstaged.length === 0 && (
            <div className="text-xs text-gray-500 italic">No changes.</div>
          )}

          <textarea
            className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-xs text-fleet-text outline-none focus:border-blue-500 resize-none"
            rows={2}
            placeholder="Commit message"
            value={messages[repo.root] || ''}
            onChange={(e) => setMessages((prev) => ({ ...prev, [repo.root]: e.target.value }))}
          />
          <button
            className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white self-start"
            disabled={repo.staged.length === 0 || !messages[repo.root]?.trim()}
            onClick={async () => {
              const ok = await onCommit(repo.root, messages[repo.root].trim())
              if (ok) setMessages((prev) => ({ ...prev, [repo.root]: '' }))
            }}
          >
            Commit
          </button>
        </div>
      ))}

      {diffTarget && (
        <Modal onClose={() => setDiffTarget(null)} width="w-[90vw]" height="h-[80vh]">
          <div className="text-xs text-gray-400 mb-2 truncate shrink-0">{diffTarget.relPath}</div>
          <div className="flex-1 min-h-0">
            <DiffEditor
              height="100%"
              language={getLanguage(diffTarget.relPath)}
              theme={isDark ? 'vs-dark' : 'vs'}
              original={diffTarget.original}
              modified={diffTarget.modified}
              options={{ readOnly: true, minimap: { enabled: false } }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
