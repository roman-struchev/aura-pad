import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { ArrowUpFromLine, ArrowDownToLine, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import type {
  GitCommit,
  GitFileEntry,
  GitFileState,
  GitRepoStatus
} from '../../../shared/gitStatus'
import { BranchSelector } from './BranchSelector'
import { Modal } from './Modal'
import { getLanguage } from '../lib/language'

interface GitPanelProps {
  repos: GitRepoStatus[]
  monacoTheme: string
  onStage: (root: string, relPaths: string[]) => void
  onUnstage: (root: string, relPaths: string[]) => void
  onDiscard: (root: string, entry: GitFileEntry) => void
  onCommit: (root: string, message: string, relPaths: string[], amend: boolean) => Promise<boolean>
  onCommitAndPush: (
    root: string,
    message: string,
    relPaths: string[],
    amend: boolean
  ) => Promise<boolean>
  onPush: (root: string) => void
  onPull: (root: string) => void
  onDiff: (root: string, relPath: string) => Promise<{ original: string; modified: string }>
  onLastCommitMessage: (root: string) => Promise<string>
  onLog: (root: string, limit: number, skip: number) => Promise<GitCommit[]>
  onBranches: (root: string) => Promise<string[]>
  onCheckout: (root: string, branch: string) => Promise<boolean>
}

// Status colors shared by both the letter and the filename, matching the
// JetBrains IDEA palette so a file's color is the same in the commit list
// and the file tree (see FileTree's GIT_BADGE).
const STATUS_STYLE: Record<GitFileState, { letter: string; className: string }> = {
  staged: { letter: '●', className: 'text-blue-400' },
  modified: { letter: 'M', className: 'text-blue-400' },
  renamed: { letter: 'R', className: 'text-blue-400' },
  added: { letter: 'A', className: 'text-green-500' },
  untracked: { letter: 'U', className: 'text-red-400' },
  deleted: { letter: 'D', className: 'text-gray-500' }
}

interface MergedEntry {
  relPath: string
  path: string
  state: GitFileState
  checked: boolean
  added?: number
  removed?: number
  discardEntry: GitFileEntry
}

// Merges staged + unstaged entries for one repo into a single per-file row,
// the way IDEA's Commit tool window shows one row per file with a checkbox
// rather than separate staged/unstaged sections.
function mergeEntries(repo: GitRepoStatus): { changes: MergedEntry[]; unversioned: MergedEntry[] } {
  const staged = new Map(repo.staged.map((e) => [e.relPath, e]))
  const unstaged = new Map(repo.unstaged.map((e) => [e.relPath, e]))
  const relPaths = new Set([...staged.keys(), ...unstaged.keys()])

  const changes: MergedEntry[] = []
  const unversioned: MergedEntry[] = []

  for (const relPath of relPaths) {
    const stagedEntry = staged.get(relPath)
    const unstagedEntry = unstaged.get(relPath)
    const primary = unstagedEntry ?? stagedEntry!

    // A path staged as new (added/renamed) whose working-tree copy was then
    // deleted - `git add`-ed, then `rm`-ed without unstaging - is shown as
    // deleted: the file being gone from disk is the more urgent fact, and
    // "added" would read as if it's a healthy new file. Ordinary partial
    // staging (staged add + further unstaged edits) still shows as "added".
    const state: GitFileState =
      unstagedEntry?.state === 'deleted'
        ? 'deleted'
        : stagedEntry?.state === 'added' || stagedEntry?.state === 'renamed'
          ? stagedEntry.state
          : (unstagedEntry?.state ?? stagedEntry!.state)

    // Summing staged + unstaged line counts approximates "total change" for
    // the ordinary partial-staging case, but that breaks down for the
    // deleted-after-staging case above: the staged number counts lines added
    // to the index, the unstaged number counts the working tree's own (now
    // reverted-to-nothing) diff against the index - two different
    // baselines, not two chunks of one diff. There, just report the deletion.
    const isDisplayedAsDeleted = state === 'deleted' && stagedEntry?.state !== 'deleted'
    const added = isDisplayedAsDeleted ? 0 : (stagedEntry?.added ?? 0) + (unstagedEntry?.added ?? 0)
    const removed = isDisplayedAsDeleted
      ? (unstagedEntry?.removed ?? 0)
      : (stagedEntry?.removed ?? 0) + (unstagedEntry?.removed ?? 0)
    const hasStats = isDisplayedAsDeleted
      ? unstagedEntry?.removed !== undefined
      : stagedEntry?.added !== undefined || unstagedEntry?.added !== undefined

    const merged: MergedEntry = {
      relPath,
      path: primary.path,
      state,
      checked: !!stagedEntry,
      added: hasStats ? added : undefined,
      removed: hasStats ? removed : undefined,
      discardEntry: unstagedEntry ?? stagedEntry!
    }

    if (state === 'untracked') unversioned.push(merged)
    else changes.push(merged)
  }

  changes.sort((a, b) => a.relPath.localeCompare(b.relPath))
  unversioned.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return { changes, unversioned }
}

function splitPath(relPath: string): { name: string; dir: string } {
  const idx = relPath.lastIndexOf('/')
  return idx === -1
    ? { name: relPath, dir: '' }
    : { name: relPath.slice(idx + 1), dir: relPath.slice(0, idx) }
}

interface GroupCheckboxProps {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
}

const GroupCheckbox: React.FC<GroupCheckboxProps> = ({ checked, indeterminate, onChange }) => {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="shrink-0 cursor-pointer"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

interface FileRowProps {
  entry: MergedEntry
  showCheckbox: boolean
  onToggle: () => void
  onClick: () => void
  onDiscard: () => void
  discardTitle: string
}

const FileRow: React.FC<FileRowProps> = ({
  entry,
  showCheckbox,
  onToggle,
  onClick,
  onDiscard,
  discardTitle
}) => {
  const { name, dir } = splitPath(entry.relPath)
  const style = STATUS_STYLE[entry.state]
  return (
    <div
      className="group flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-fleet-active cursor-pointer text-xs"
      title={dir ? `${dir}/${name}` : name}
      onClick={onClick}
    >
      {showCheckbox && (
        <input
          type="checkbox"
          className="shrink-0 cursor-pointer"
          checked={entry.checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <span className={clsx('w-3 shrink-0 text-center font-mono', style.className)}>
        {style.letter}
      </span>
      {/* Directory is deliberately left out of the row - with both name and
          dir sharing the row's width, neither stayed readable in a narrow
          sidebar. The full relPath is still available via the title tooltip
          above. */}
      <span
        className={clsx(
          'flex-1 min-w-0 truncate',
          style.className,
          entry.state === 'deleted' && 'line-through'
        )}
      >
        {name}
      </span>
      {(!!entry.added || !!entry.removed) && (
        <span className="text-[10px] font-mono shrink-0 flex items-center gap-1 group-hover:hidden">
          {!!entry.added && <span className="text-green-500">+{entry.added}</span>}
          {!!entry.removed && <span className="text-red-500">-{entry.removed}</span>}
        </span>
      )}
      <button
        className="hidden group-hover:block p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white shrink-0"
        title={discardTitle}
        onClick={(e) => {
          e.stopPropagation()
          onDiscard()
        }}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  )
}

function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSeconds)
  if (diff < 60) return 'now'
  const minutes = Math.floor(diff / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

const LOG_PAGE_SIZE = 50

interface HistoryListProps {
  repo: GitRepoStatus
  onLog: (root: string, limit: number, skip: number) => Promise<GitCommit[]>
}

// Plain linear `git log` of HEAD - deliberately not a log viewer (no graph,
// no filters, no per-commit diff). Click copies the full hash.
const HistoryList: React.FC<HistoryListProps> = ({ repo, onLog }) => {
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  // `repo` is a fresh object on every status push (commit, pull, checkout,
  // watcher events alike), so any change that could move HEAD lands here.
  // Refetching the first page on each push is cheap; the previous list stays
  // on screen until the new one arrives, so there's no flicker. Pagination
  // depth intentionally resets - stale deep pages are worse than a rewind.
  useEffect(() => {
    let cancelled = false
    onLog(repo.root, LOG_PAGE_SIZE, 0).then((page) => {
      if (cancelled) return
      setCommits(page)
      setHasMore(page.length === LOG_PAGE_SIZE)
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  const loadMore = async (): Promise<void> => {
    if (!commits || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await onLog(repo.root, LOG_PAGE_SIZE, commits.length)
      setCommits([...commits, ...page])
      setHasMore(page.length === LOG_PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }

  const copyHash = (commit: GitCommit): void => {
    navigator.clipboard.writeText(commit.hash)
    setCopiedHash(commit.hash)
    setTimeout(() => setCopiedHash((prev) => (prev === commit.hash ? null : prev)), 1500)
  }

  if (commits === null) return null

  if (commits.length === 0) {
    return <div className="text-xs text-gray-500 italic px-1.5">No commits yet.</div>
  }

  return (
    <div>
      {commits.map((commit, index) => (
        <div
          key={commit.hash}
          className="px-1.5 py-1 rounded hover:bg-fleet-active cursor-pointer text-xs"
          title={`${commit.hash}\n${commit.author}\n${new Date(commit.date * 1000).toLocaleString()}${commit.refs ? `\n${commit.refs}` : ''}\n\nClick to copy hash`}
          onClick={() => copyHash(commit)}
        >
          <div className="flex items-center gap-1.5">
            <span className="flex-1 min-w-0 truncate text-fleet-text">{commit.subject}</span>
            <span
              className={clsx(
                'text-[10px] font-mono shrink-0',
                // The first `ahead` commits of the log are exactly the ones
                // the upstream doesn't have yet.
                index < repo.ahead ? 'text-green-500' : 'text-gray-500'
              )}
            >
              {copiedHash === commit.hash ? 'copied' : commit.shortHash}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="truncate">{commit.author}</span>
            <span className="shrink-0 ml-auto">{relativeTime(commit.date)}</span>
          </div>
        </div>
      ))}
      {hasMore && (
        <button
          className="w-full mt-1 py-1 text-[10px] text-gray-400 hover:text-gray-200 hover:bg-fleet-active rounded disabled:opacity-40"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}

// JetBrains-style commit tool window: one "Changes" list with checkboxes
// (checked = will be committed), an "Unversioned Files" group, a commit box
// pinned to the bottom, and ahead/behind on the branch row. Staging is an
// implementation detail here - checking a row stages it, unchecking unstages
// it, and Commit re-adds every checked path first so edits made after staging
// are swept in too.
export const GitPanel: React.FC<GitPanelProps> = ({
  repos,
  monacoTheme,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  onCommitAndPush,
  onPush,
  onPull,
  onDiff,
  onLastCommitMessage,
  onLog,
  onBranches,
  onCheckout
}) => {
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [amendByRoot, setAmendByRoot] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [diffTarget, setDiffTarget] = useState<{
    relPath: string
    original: string
    modified: string
  } | null>(null)
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null)
  const [view, setView] = useState<'commit' | 'history'>('commit')

  const openDiff = async (root: string, relPath: string): Promise<void> => {
    const { original, modified } = await onDiff(root, relPath)
    setDiffTarget({ relPath, original, modified })
  }

  // Falls back to the first repo if nothing's selected yet, or the
  // previously selected root disappeared (workspace closed).
  const activeRoot =
    selectedRoot && repos.some((r) => r.root === selectedRoot) ? selectedRoot : repos[0]?.root
  const repo = repos.find((r) => r.root === activeRoot) ?? null

  // Hooks must run unconditionally on every render, so this stays above the
  // "no repository" early return below - it just no-ops when repo is null.
  const { changes, unversioned } = useMemo(
    () => (repo ? mergeEntries(repo) : { changes: [], unversioned: [] }),
    [repo]
  )

  if (!repo) {
    return <div className="text-center mt-10 text-gray-500 text-sm p-4">No git repository.</div>
  }

  const message = messages[repo.root] || ''
  const amend = !!amendByRoot[repo.root]

  const checkedRelPaths = [...changes, ...unversioned]
    .filter((e) => e.checked)
    .map((e) => e.relPath)

  const allChangesChecked = changes.length > 0 && changes.every((e) => e.checked)
  const someChangesChecked = changes.some((e) => e.checked)

  const toggleEntry = (entry: MergedEntry): void => {
    if (entry.checked) onUnstage(repo.root, [entry.relPath])
    else onStage(repo.root, [entry.relPath])
  }

  const toggleChangesGroup = (): void => {
    if (allChangesChecked)
      onUnstage(
        repo.root,
        changes.map((e) => e.relPath)
      )
    else
      onStage(
        repo.root,
        changes.filter((e) => !e.checked).map((e) => e.relPath)
      )
  }

  const setMessage = (value: string): void =>
    setMessages((prev) => ({ ...prev, [repo.root]: value }))

  const toggleAmend = async (): Promise<void> => {
    const next = !amend
    setAmendByRoot((prev) => ({ ...prev, [repo.root]: next }))
    if (next && !message.trim()) {
      const prevMessage = await onLastCommitMessage(repo.root)
      if (prevMessage) setMessage(prevMessage)
    }
  }

  const canCommit = !busy && !!message.trim() && (checkedRelPaths.length > 0 || amend)

  const runCommit = async (andPush: boolean): Promise<void> => {
    if (!canCommit) return
    setBusy(true)
    try {
      const action = andPush ? onCommitAndPush : onCommit
      const ok = await action(repo.root, message.trim(), checkedRelPaths, amend)
      if (ok) {
        setMessage('')
        setAmendByRoot((prev) => ({ ...prev, [repo.root]: false }))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      runCommit(false)
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 text-sm">
      {repos.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-fleet-border pb-2 mb-2 shrink-0">
          {repos.map((r) => (
            <button
              key={r.root}
              title={r.root}
              className={clsx(
                'px-2 py-1 rounded text-xs truncate max-w-[110px]',
                r.root === activeRoot
                  ? 'bg-fleet-active text-fleet-textHover'
                  : 'text-gray-400 hover:bg-fleet-active hover:text-gray-200'
              )}
              onClick={() => setSelectedRoot(r.root)}
            >
              {r.root.split('/').pop()}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0 mb-2">
        <BranchSelector
          key={repo.root}
          root={repo.root}
          branch={repo.branch}
          onBranches={onBranches}
          onCheckout={onCheckout}
          triggerClassName="-mx-1"
        />
        {!!repo.ahead && <span className="text-[10px] text-gray-500">↑{repo.ahead}</span>}
        {!!repo.behind && <span className="text-[10px] text-gray-500">↓{repo.behind}</span>}
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

      <div className="flex gap-0.5 bg-fleet-bg rounded-md p-0.5 text-xs mb-2 shrink-0">
        {(['commit', 'history'] as const).map((v) => (
          <button
            key={v}
            className={clsx(
              'flex-1 py-1 rounded transition-colors capitalize',
              view === v
                ? 'bg-fleet-active text-fleet-textHover'
                : 'text-gray-400 hover:text-gray-200'
            )}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {view === 'history' ? (
          <HistoryList key={repo.root} repo={repo} onLog={onLog} />
        ) : (
          <>
            {changes.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1.5 px-1.5 mb-1">
                  <GroupCheckbox
                    checked={allChangesChecked}
                    indeterminate={!allChangesChecked && someChangesChecked}
                    onChange={toggleChangesGroup}
                  />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    Changes ({changes.length})
                  </span>
                </div>
                {changes.map((entry) => (
                  <FileRow
                    key={entry.relPath}
                    entry={entry}
                    showCheckbox
                    onToggle={() => toggleEntry(entry)}
                    onClick={() => openDiff(repo.root, entry.relPath)}
                    onDiscard={() => onDiscard(repo.root, entry.discardEntry)}
                    discardTitle="Discard changes"
                  />
                ))}
              </div>
            )}

            {unversioned.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-1.5">
                  Unversioned Files ({unversioned.length})
                </div>
                {unversioned.map((entry) => (
                  <FileRow
                    key={entry.relPath}
                    entry={entry}
                    showCheckbox
                    onToggle={() => toggleEntry(entry)}
                    onClick={() => openDiff(repo.root, entry.relPath)}
                    onDiscard={() => onDiscard(repo.root, entry.discardEntry)}
                    discardTitle="Delete"
                  />
                ))}
              </div>
            )}

            {changes.length === 0 && unversioned.length === 0 && (
              <div className="text-xs text-gray-500 italic px-1.5">No changes.</div>
            )}
          </>
        )}
      </div>

      {view === 'commit' && (
        <div className="shrink-0 border-t border-fleet-border pt-2 mt-2 flex flex-col gap-1.5">
          <textarea
            className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-xs text-fleet-text outline-none focus:border-blue-500 resize-none"
            rows={3}
            placeholder="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleMessageKeyDown}
          />
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={amend} onChange={toggleAmend} />
            Amend
          </label>
          <div className="flex items-center gap-1.5">
            <button
              className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
              disabled={!canCommit}
              onClick={() => runCommit(false)}
            >
              Commit
            </button>
            <button
              className="px-3 py-1.5 text-xs rounded border border-fleet-border hover:bg-fleet-active disabled:opacity-40 disabled:cursor-not-allowed text-fleet-text"
              disabled={!canCommit}
              onClick={() => runCommit(true)}
            >
              Commit & Push
            </button>
          </div>
        </div>
      )}

      {diffTarget && (
        <Modal onClose={() => setDiffTarget(null)} width="w-[90vw]" height="h-[80vh]">
          <div className="text-xs text-gray-400 mb-2 truncate shrink-0">{diffTarget.relPath}</div>
          <div className="flex-1 min-h-0">
            <DiffEditor
              height="100%"
              language={getLanguage(diffTarget.relPath)}
              theme={monacoTheme}
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
