import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Ignore } from 'ignore'
import { loadWorkspaces, getWorkspaceTrees, isIgnored, loadGitignore } from './workspaces'
import { getAllRepoStatuses } from './git'
import { loadSettings } from './settings'

// File watching: react to changes made outside the app (other editors, git,
// other windows of this app) without reacting to our own writes.
//
// - recordSelfWrite() is called right after we write a file ourselves, and
//   remembers what we wrote alongside the timestamp.
// - When the watcher reports a 'change' for that same path shortly after,
//   we treat it as self-triggered and stay quiet (the renderer already has
//   that content, since it's the one that wrote it).
// - If the event arrives after the grace window - plausible with recursive
//   fs.watch/FSEvents, which can batch or delay notifications well past a
//   fixed cutoff - we fall back to comparing on-disk content against what we
//   wrote. A match means it's still our own (late) write, not a real
//   external change, so a slow filesystem can't produce a false positive.
// - A structural change ('rename': create/delete/move) always triggers a
//   debounced tree rebuild, since other files may be affected.
const activeWatchers = new Map<string, fs.FSWatcher>()
// Cached per root and rebuilt whenever setupWatchers() re-scans the
// workspace list (add/remove/rename/delete of a root) - not on every event,
// since re-reading and re-parsing .gitignore on every single fs.watch
// callback would defeat the point of filtering noise out early.
const rootIgnores = new Map<string, Ignore>()
const recentSelfWrites = new Map<string, { time: number; content: string }>()
const selfWriteCleanupTimers = new Map<string, NodeJS.Timeout>()
const structureDebounceTimers = new Map<string, NodeJS.Timeout>()
const SELF_WRITE_GRACE_MS = 1500
// Upper bound on how long a self-write record is kept, to catch a `change`
// event that fs.watch/FSEvents delivers late (batched past the grace window
// above) - see the long comment at the top of this file. Also bounds
// recentSelfWrites' memory: without this, an entry that never gets a
// matching disk event again (e.g. an editor whose next external change never
// comes) would otherwise sit in the map - full file content included -
// forever.
const SELF_WRITE_MAX_AGE_MS = 10_000
const STRUCTURE_DEBOUNCE_MS = 300
const GIT_STATUS_DEBOUNCE_MS = 500

let gitStatusDebounceTimer: NodeJS.Timeout | null = null

// Any file change (ours or external) can change `git status` output - even a
// self-write, since it can move a file from modified back to unmodified. Kept
// as its own debounce (rather than piggybacking on the structural-change one
// above) since it must also fire for plain content edits, not just renames.
function scheduleGitStatusRefresh(): void {
  if (!loadSettings().gitEnabled) return
  if (gitStatusDebounceTimer) clearTimeout(gitStatusDebounceTimer)
  gitStatusDebounceTimer = setTimeout(async () => {
    gitStatusDebounceTimer = null
    const statuses = await getAllRepoStatuses(loadWorkspaces())
    broadcast('git-status-changed', statuses)
  }, GIT_STATUS_DEBOUNCE_MS)
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

export function recordSelfWrite(filePath: string, content: string): void {
  recentSelfWrites.set(filePath, { time: Date.now(), content })
  clearTimeout(selfWriteCleanupTimers.get(filePath))
  selfWriteCleanupTimers.set(
    filePath,
    setTimeout(() => {
      selfWriteCleanupTimers.delete(filePath)
      recentSelfWrites.delete(filePath)
    }, SELF_WRITE_MAX_AGE_MS)
  )
}

function forgetSelfWrite(filePath: string): void {
  clearTimeout(selfWriteCleanupTimers.get(filePath))
  selfWriteCleanupTimers.delete(filePath)
  recentSelfWrites.delete(filePath)
}

// True if any path segment (not just the final component) is one of the
// hardcoded ignore names, or matches the workspace's .gitignore. Checking
// only the basename let noise from *inside* an ignored directory through -
// e.g. `filename` for a file changing inside node_modules during an install
// is `node_modules/some-pkg/index.js`, whose basename is just `index.js` -
// which used to slip past the filter and trigger a git-status refresh and a
// full workspace tree rebuild on every single one of the thousands of events
// an `npm install` produces.
function isFullyIgnored(rootPath: string, filename: string): boolean {
  const segments = filename.split(path.sep)
  if (segments.some((seg) => seg === '.git' || seg === '.DS_Store' || isIgnored(seg))) return true

  const ig = rootIgnores.get(rootPath)
  if (!ig) return false
  // The `ignore` package only understands POSIX-style relative paths.
  const relPosix = segments.join('/')
  return ig.ignores(relPosix)
}

function handleFsWatchEvent(rootPath: string, eventType: string, filename: string | null): void {
  if (!filename) return
  if (isFullyIgnored(rootPath, filename)) return

  scheduleGitStatusRefresh()

  const fullPath = path.join(rootPath, filename)

  if (eventType === 'change') {
    const selfWrite = recentSelfWrites.get(fullPath)
    if (selfWrite) {
      if (Date.now() - selfWrite.time < SELF_WRITE_GRACE_MS) return
      try {
        if (fs.readFileSync(fullPath, 'utf-8') === selfWrite.content) {
          forgetSelfWrite(fullPath)
          return
        }
      } catch {
        // Unreadable (deleted/permissions/binary decode) - fall through and
        // let the rename-watcher or a later change event sort it out.
      }
      forgetSelfWrite(fullPath)
    }
    broadcast('file-changed-externally', fullPath)
    return
  }

  // 'rename' covers create/delete/move of an entry - the tree shape may differ.
  clearTimeout(structureDebounceTimers.get(rootPath))
  structureDebounceTimers.set(
    rootPath,
    setTimeout(() => {
      structureDebounceTimers.delete(rootPath)
      broadcast('workspaces-changed', getWorkspaceTrees())
    }, STRUCTURE_DEBOUNCE_MS)
  )
}

export function setupWatchers(): void {
  for (const watcher of activeWatchers.values()) watcher.close()
  activeWatchers.clear()
  rootIgnores.clear()

  for (const rootPath of loadWorkspaces()) {
    if (!fs.existsSync(rootPath)) continue
    rootIgnores.set(rootPath, loadGitignore(rootPath))
    try {
      const watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) =>
        handleFsWatchEvent(rootPath, eventType, filename)
      )
      activeWatchers.set(rootPath, watcher)
    } catch (e) {
      // Recursive fs.watch isn't supported on every platform/filesystem;
      // degrade gracefully by simply not watching that root.
      console.error(`Failed to watch workspace "${rootPath}":`, e)
    }
  }
}

export function closeAllWatchers(): void {
  activeWatchers.forEach((w) => w.close())
  activeWatchers.clear()
}
