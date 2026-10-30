import { app } from 'electron'
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
export function touchRecentExternalFile(filePath: string): RecentExternalFile[] {
  const entries = loadRecentExternalFiles().filter((e) => e.path !== filePath)
  entries.unshift({ path: filePath, openedAt: Date.now() })
  saveRecentExternalFiles(entries)
  return entries
}

export function removeRecentExternalFile(filePath: string): RecentExternalFile[] {
  const entries = loadRecentExternalFiles().filter((e) => e.path !== filePath)
  saveRecentExternalFiles(entries)
  return entries
}
