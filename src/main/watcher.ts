import { BrowserWindow } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Ignore } from 'ignore'
import { loadWorkspaces, getWorkspaceTrees, isIgnored, loadGitignore } from './workspaces'
import { getAllRepoStatuses } from './git'
import { loadSettings } from './settings'
import type { EventContracts } from '../shared/ipc'

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

interface SelfWrite {
  // Hash of the exact bytes we last wrote to this path.
  hash: string
  // What the file measured immediately after that write. An event whose stat
  // still matches these can't be carrying different content, which is what
  // lets the check below answer without reading the file at all - see
  // matchesLastSelfWrite.
  size: number
  mtimeMs: number
}

// What we ourselves last wrote to each path. Unlike recentSelfWrites this
// never times out (a hash plus two numbers is cheap to keep, unlike the full
// content the old implementation stored) - it's the ground truth for "is this
// event a real external change or just our own write echoing back", no matter
// how late the event arrives. Insertion-ordered with a size cap so a very
// long session can't grow it unboundedly.
const lastSelfWrites = new Map<string, SelfWrite>()
const LAST_HASH_LIMIT = 1000
const selfWriteCleanupTimers = new Map<string, NodeJS.Timeout>()
const structureDebounceTimers = new Map<string, NodeJS.Timeout>()
const SELF_WRITE_GRACE_MS = 1500
// recentSelfWrites only powers the read-free fast path within the grace
// window; entries can be dropped shortly after.
const SELF_WRITE_MAX_AGE_MS = 10_000
const STRUCTURE_DEBOUNCE_MS = 300
const GIT_STATUS_DEBOUNCE_MS = 500

const contentHash = (content: string | Buffer): string =>
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
  if (!loadSettings().extensions.git.enabled) return
  if (gitStatusDebounceTimer) clearTimeout(gitStatusDebounceTimer)
  gitStatusDebounceTimer = setTimeout(async () => {
    gitStatusDebounceTimer = null
    const statuses = await getAllRepoStatuses(loadWorkspaces())
    broadcast('git-status-changed', statuses)
  }, GIT_STATUS_DEBOUNCE_MS)
}

export function broadcast<C extends keyof EventContracts>(
  channel: C,
  ...args: EventContracts[C]
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

// `content` is the exact bytes written to disk (already encoded for the
// file's detected encoding) - hashing a JS string here would only match
// UTF-8 files.
export function recordSelfWrite(filePath: string, content: string | Buffer): void {
  const key = selfWriteKey(filePath)
  recentSelfWrites.set(key, { time: Date.now() })
  // Stat'd here rather than derived from `content`: the size on disk can
  // differ from the buffer's length in principle, and the mtime is only
  // knowable from the file itself. A write whose file vanished before this
  // runs simply gets no stat shortcut (-1 never matches a real stat), and
  // falls back to hashing.
  let size = -1
  let mtimeMs = -1
  try {
    const stat = fs.statSync(key)
    size = stat.size
    mtimeMs = stat.mtimeMs
  } catch {
    // Deleted/unreadable already - hash-only entry.
  }
  // Delete-then-set keeps the map insertion-ordered by most recent save, so
  // the size cap below evicts the longest-untouched path first.
  lastSelfWrites.delete(key)
  lastSelfWrites.set(key, { hash: contentHash(content), size, mtimeMs })
  if (lastSelfWrites.size > LAST_HASH_LIMIT) {
    lastSelfWrites.delete(lastSelfWrites.keys().next().value!)
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
  //
  // Ordered cheapest-first, because this runs on the main process's event
  // loop for every event that gets past the ignore filter:
  //
  //   1. no record for this path            -> nothing to compare against
  //   2. size and mtime still as we left it -> content can't have changed
  //   3. only then read and hash the file
  //
  // Step 2 is what keeps the common cases free: the events our own (auto)save
  // generates, and the metadata-only touches a sync daemon emits afterwards,
  // both leave size+mtime exactly as the write did. Without it, every such
  // event re-read the whole file - up to the 10 MB open limit - synchronously,
  // stalling IPC and the UI along with it. The stat pair is the same "has this
  // file changed" proxy make/rsync/git's stat cache use; a writer that changes
  // content while restoring both the original size *and* mtime would slip
  // through, which is not something normal tooling does.
  const matchesLastSelfWrite = (): boolean => {
    const last = lastSelfWrites.get(key)
    if (last === undefined) return false
    try {
      const stat = fs.statSync(fullPath)
      if (stat.size === last.size && stat.mtimeMs === last.mtimeMs) return true
      // Raw bytes, not a utf-8 decode: the recorded hash is of the encoded
      // bytes we wrote, whatever the file's encoding.
      return contentHash(fs.readFileSync(fullPath)) === last.hash
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
    // A real external change makes our last-write record stale - drop it, so a
    // later revert back to that exact content isn't mistaken for our own.
    lastSelfWrites.delete(key)
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
    setTimeout(async () => {
      structureDebounceTimers.delete(rootPath)
      broadcast('workspaces-changed', await getWorkspaceTrees())
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
