import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { readConfigFile, writeConfigFile } from './configFile'
import type { RecentExternalFile } from '../shared/recentExternalFile'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const recentFilesConfigPath = path.join(app.getPath('userData'), 'recentExternalFiles.json')

function saveRecentExternalFiles(entries: RecentExternalFile[]): void {
  writeConfigFile(recentFilesConfigPath, entries)
}

// Entries older than the retention window are dropped on every read, so
// the list self-cleans without needing a background timer.
export function loadRecentExternalFiles(): RecentExternalFile[] {
  const entries = readConfigFile<RecentExternalFile[]>(recentFilesConfigPath, () => [])
  const cutoff = Date.now() - RETENTION_MS
  return entries.filter((e) => e.openedAt >= cutoff)
}

// Called every time an outside-workspace file is opened, including
// re-opening one already in the list - moves it to the front with a fresh
// timestamp rather than duplicating it.
// Touching a folder entry this way (a file under it was opened) keeps it a
// folder entry.
export function touchRecentExternalFile(filePath: string): RecentExternalFile[] {
  const all = loadRecentExternalFiles()
  const previous = all.find((e) => e.path === filePath)
  const entries = all.filter((e) => e.path !== filePath)
  entries.unshift(
    previous?.type === 'directory'
      ? { path: filePath, openedAt: Date.now(), type: 'directory' }
      : { path: filePath, openedAt: Date.now() }
  )
  saveRecentExternalFiles(entries)
  return entries
}

export function touchRecentExternalFolder(folderPath: string): RecentExternalFile[] {
  const entries = loadRecentExternalFiles().filter((e) => e.path !== folderPath)
  entries.unshift({ path: folderPath, openedAt: Date.now(), type: 'directory' })
  saveRecentExternalFiles(entries)
  return entries
}

// The listed folders that are still there - what the sidebar shows as trees
// and the watcher follows. A folder deleted meanwhile is skipped, not
// dropped: its entry ages out on its own schedule.
export function loadOutsideFolders(): string[] {
  return loadRecentExternalFiles()
    .filter((e) => e.type === 'directory')
    .map((e) => e.path)
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })
}

export function removeRecentExternalFile(filePath: string): RecentExternalFile[] {
  const entries = loadRecentExternalFiles().filter((e) => e.path !== filePath)
  saveRecentExternalFiles(entries)
  return entries
}
