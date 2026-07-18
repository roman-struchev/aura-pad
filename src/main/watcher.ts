import { BrowserWindow } from 'electron'
import crypto from 'crypto'
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
// - Any later event only counts as external if the file's content actually
//   differs from what we last wrote (compared by hash). Sync daemons - iCloud's
//   bird especially - rewrite metadata/xattrs *minutes* after a save, and
//   fs.watch surfaces those as plain 'change' events; a time window alone,
//   however generous, kept producing "edited outside the app" banners over
//   files nobody touched.
// - A structural change ('rename': create/delete/move) always triggers a
//   debounced tree rebuild, since other files may be affected.
const activeWatchers = new Map<string, fs.FSWatcher>()
// Cached per root and rebuilt whenever setupWatchers() re-scans the
// workspace list (add/remove/rename/delete of a root) - not on every event,
// since re-reading and re-parsing .gitignore on every single fs.watch
// callback would defeat the point of filtering noise out early.
const rootIgnores = new Map<string, Ignore>()
const recentSelfWrites = new Map<string, { time: number }>()
// Hash of the last content we ourselves wrote to each path. Unlike
// recentSelfWrites this never times out (a hash is cheap to keep, unlike the
// full content the old implementation stored) - it's the ground truth for
// "is this event a real external change or just our own write echoing back",
// no matter how late the event arrives. Insertion-ordered with a size cap so
// a very long session can't grow it unboundedly.
const lastSelfWriteHashes = new Map<string, string>()
const LAST_HASH_LIMIT = 1000
const selfWriteCleanupTimers = new Map<string, NodeJS.Timeout>()
const structureDebounceTimers = new Map<string, NodeJS.Timeout>()
const SELF_WRITE_GRACE_MS = 1500
// recentSelfWrites only powers the read-free fast path within the grace
// window; entries can be dropped shortly after.
const SELF_WRITE_MAX_AGE_MS = 10_000
const STRUCTURE_DEBOUNCE_MS = 300
const GIT_STATUS_DEBOUNCE_MS = 500

const contentHash = (content: string): string =>
  crypto.createHash('sha256').update(content).digest('hex')

// Both sides of the suppression check must agree on one key form. Saves come
// in with the renderer's tab path - possibly through a symlink, possibly in a
// different Unicode normalization than what FSEvents reports (macOS mixes
// NFC/NFD freely, iCloud folders especially) - while events come in as
// rootPath + event filename. Resolve symlinks and pin one normalization.
function selfWriteKey(p: string): string {
  let key = p
  try {
    key = fs.realpathSync(p)
  } catch {
    // New or already-deleted file - key by the given path.
  }
  return key.normalize('NFC')
}

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
  const key = selfWriteKey(filePath)
  recentSelfWrites.set(key, { time: Date.now() })
  // Delete-then-set keeps the map insertion-ordered by most recent save, so
  // the size cap below evicts the longest-untouched path first.
  lastSelfWriteHashes.delete(key)
  lastSelfWriteHashes.set(key, contentHash(content))
  if (lastSelfWriteHashes.size > LAST_HASH_LIMIT) {
    lastSelfWriteHashes.delete(lastSelfWriteHashes.keys().next().value!)
  }
  clearTimeout(selfWriteCleanupTimers.get(key))
  selfWriteCleanupTimers.set(
    key,
    setTimeout(() => {
      selfWriteCleanupTimers.delete(key)
      recentSelfWrites.delete(key)
    }, SELF_WRITE_MAX_AGE_MS)
  )
}

function forgetSelfWrite(key: string): void {
  clearTimeout(selfWriteCleanupTimers.get(key))
  selfWriteCleanupTimers.delete(key)
  recentSelfWrites.delete(key)
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
  const key = selfWriteKey(fullPath)

  // True when the file's current content is still exactly what we last wrote
  // to it - i.e. the event is our own write echoing back, or a metadata-only
  // touch (iCloud xattrs, mtime bumps), not a real external edit.
  const matchesLastSelfWrite = (): boolean => {
    const lastHash = lastSelfWriteHashes.get(key)
    if (lastHash === undefined) return false
    try {
      return contentHash(fs.readFileSync(fullPath, 'utf-8')) === lastHash
    } catch {
      // Unreadable (deleted/moved/permissions) - treat as a real change and
      // let the handlers below sort it out.
      return false
    }
  }

  if (eventType === 'change') {
    const recent = recentSelfWrites.get(key)
    if (recent && Date.now() - recent.time < SELF_WRITE_GRACE_MS) return
    if (matchesLastSelfWrite()) {
      forgetSelfWrite(key)
      return
    }
    forgetSelfWrite(key)
    // A real external change makes our last-write hash stale - drop it, so a
    // later revert back to that exact content isn't mistaken for our own.
    lastSelfWriteHashes.delete(key)
    broadcast('file-changed-externally', fullPath)
    return
  }

  // 'rename' covers create/delete/move of an entry - the tree shape may
  // differ. Except when it's our own save: writeFileContent atomically
  // replaces the target via temp-file + rename, which surfaces here as a
  // 'rename' on the saved path, and rebuilding the whole tree on every
  // (auto)save would be pure noise. Same suppression as the 'change' branch;
  // the record is deliberately not forgotten here, since a 'change' event
  // for the same write may still follow.
  const recent = recentSelfWrites.get(key)
  if (recent && Date.now() - recent.time < SELF_WRITE_GRACE_MS) return
  if (matchesLastSelfWrite()) return
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
