import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { loadWorkspaces, getWorkspaceTrees, isIgnored } from './workspaces'
import { getAllRepoStatuses } from './git'
import { loadSettings } from './settings'

// File watching: react to changes made outside the app (other editors, git,
// other windows of this app) without reacting to our own writes.
//
// - recordSelfWrite() is called right after we write a file ourselves.
// - When the watcher reports a 'change' for that same path shortly after,
//   we treat it as self-triggered and stay quiet (the renderer already has
//   that content, since it's the one that wrote it).
// - A structural change ('rename': create/delete/move) always triggers a
//   debounced tree rebuild, since other files may be affected.
const activeWatchers = new Map<string, fs.FSWatcher>()
const recentSelfWrites = new Map<string, number>()
const structureDebounceTimers = new Map<string, NodeJS.Timeout>()
const SELF_WRITE_GRACE_MS = 1500
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

export function recordSelfWrite(filePath: string): void {
  recentSelfWrites.set(filePath, Date.now())
}

function handleFsWatchEvent(rootPath: string, eventType: string, filename: string | null): void {
  if (!filename) return
  const base = path.basename(filename)
  if (base === '.git' || base === '.DS_Store' || isIgnored(base)) return

  scheduleGitStatusRefresh()

  const fullPath = path.join(rootPath, filename)

  if (eventType === 'change') {
    const lastSelfWrite = recentSelfWrites.get(fullPath)
    if (lastSelfWrite && Date.now() - lastSelfWrite < SELF_WRITE_GRACE_MS) return
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

  for (const rootPath of loadWorkspaces()) {
    if (!fs.existsSync(rootPath)) continue
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
