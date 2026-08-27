import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { LocalHistoryEntry, LocalHistoryLabel } from '../shared/localHistory'

// Local history: what the file looked like before AuraPad wrote over it.
//
// The editor saves by itself (~1.2 s after the last keystroke), so the only
// thing standing between "I broke it" and losing the previous state is
// Monaco's undo stack - which dies with the tab and does not survive a
// reload. An editor that takes writing on itself has to take the way back on
// itself too, so every write main makes on the user's behalf first stores the
// bytes it is about to replace.
//
// Snapshots live in userData, never next to the user's file: a hidden sibling
// directory would show up in their repository, their tree and their diffs.
//
//   userData/localHistory/<hash of the real path>/
//     meta.json   { path, entries: [{ id, at, bytes, hash, label }] }
//     <id>        the stored text, UTF-8
//
// Stored decoded (a string, not the file's own bytes): restoring goes back
// through the editor and the ordinary save path, which re-encodes to whatever
// the file's encoding is, so a cp1251 file comes back cp1251.

const SNAPSHOT_ROOT = path.join(app.getPath('userData'), 'localHistory')

// Retention. Three limits rather than one because they fail differently: age
// keeps the list meaningful, count keeps it readable, bytes keep a big file
// edited all day from filling the disk.
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const MAX_ENTRIES_PER_FILE = 50
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024
// A single snapshot bigger than this is skipped: history for a multi-megabyte
// file would cost more disk than it is worth, and those files are rarely the
// ones being hand-edited.
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

// Autosave fires seconds apart, and fifty snapshots of the same paragraph
// being typed are worth less than one from before it was started. Within this
// window the existing snapshot stands: the interesting state is the one from
// before this editing session, not from three keystrokes ago.
const COALESCE_MS = 2 * 60 * 1000

interface StoredEntry extends LocalHistoryEntry {
  // sha1 of the content, so re-saving an unchanged file (or saving twice with
  // the same text) doesn't stack identical snapshots.
  hash: string
}

interface StoredMeta {
  path: string
  entries: StoredEntry[]
}

function folderFor(filePath: string): string {
  const real = (() => {
    try {
      return fs.realpathSync(filePath)
    } catch {
      return path.resolve(filePath)
    }
  })()
  return path.join(SNAPSHOT_ROOT, crypto.createHash('sha1').update(real).digest('hex').slice(0, 16))
}

// Read straight from disk (no config cache): these files are small, touched
// once per snapshot, and a stale cache here would drop history entries.
function readMeta(dir: string): StoredMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as StoredMeta
    if (!meta || typeof meta.path !== 'string' || !Array.isArray(meta.entries)) return null
    return meta
  } catch {
    return null
  }
}

function writeMeta(dir: string, meta: StoredMeta): void {
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta))
}

// Newest first - the order the list is read in, and the order the retention
// rules are applied in.
function sorted(entries: StoredEntry[]): StoredEntry[] {
  return [...entries].sort((a, b) => b.at - a.at)
}

function applyRetention(dir: string, entries: StoredEntry[]): StoredEntry[] {
  const cutoff = Date.now() - RETENTION_MS
  const kept: StoredEntry[] = []
  let bytes = 0
  for (const entry of sorted(entries)) {
    bytes += entry.bytes
    const fits =
      entry.at >= cutoff && kept.length < MAX_ENTRIES_PER_FILE && bytes <= MAX_BYTES_PER_FILE
    if (fits) kept.push(entry)
    else fs.rmSync(path.join(dir, entry.id), { force: true })
  }
  return kept
}

// Whether a save is worth reading the old content for. Called before that read
// so the common case - autosave, seconds after the last one - costs nothing.
export function shouldSnapshot(filePath: string): boolean {
  const meta = readMeta(folderFor(filePath))
  if (!meta || meta.entries.length === 0) return true
  const newest = sorted(meta.entries)[0]
  return Date.now() - newest.at >= COALESCE_MS
}

// Stores `content` as the state the file is leaving behind. `force` is for
// writes that are worth a snapshot regardless of how recent the last one is -
// a project-wide replace touching a file nobody has open.
export function recordSnapshot(
  filePath: string,
  content: string,
  label: LocalHistoryLabel,
  force = false
): void {
  try {
    const bytes = Buffer.byteLength(content)
    if (bytes > MAX_SNAPSHOT_BYTES) return
    if (!force && !shouldSnapshot(filePath)) return

    const dir = folderFor(filePath)
    fs.mkdirSync(dir, { recursive: true })
    const meta = readMeta(dir) ?? { path: filePath, entries: [] }
    const hash = crypto.createHash('sha1').update(content).digest('hex')
    // Nothing changed since the last snapshot: the file is already represented.
    if (sorted(meta.entries)[0]?.hash === hash) return

    const at = Date.now()
    const id = `${at}-${hash.slice(0, 8)}`
    fs.writeFileSync(path.join(dir, id), content, 'utf-8')
    meta.path = filePath
    meta.entries = applyRetention(dir, [{ id, at, bytes, hash, label }, ...meta.entries])
    writeMeta(dir, meta)
  } catch (e) {
    // History is a safety net, not a feature the save depends on: a full disk
    // or a permission problem must not stop the file itself being written.
    console.warn('Failed to record local history:', e)
  }
}

export function listSnapshots(filePath: string): LocalHistoryEntry[] {
  const dir = folderFor(filePath)
  const meta = readMeta(dir)
  if (!meta) return []
  return sorted(meta.entries).map(({ id, at, bytes, label }) => ({ id, at, bytes, label }))
}

export function readSnapshot(
  filePath: string,
  id: string
): { success: boolean; content?: string; error?: string } {
  const dir = folderFor(filePath)
  const meta = readMeta(dir)
  // Only ids this file's own history knows: the id reaches main from the
  // renderer, and joining an arbitrary string onto the folder would be a path
  // of its own.
  if (!meta?.entries.some((entry) => entry.id === id)) {
    return { success: false, error: 'That version is no longer in the local history.' }
  }
  try {
    return { success: true, content: fs.readFileSync(path.join(dir, id), 'utf-8') }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Could not read that version.'
    }
  }
}

// Startup sweep: applies the age limit to every file's history, including
// files that are never saved again (renamed, deleted, or simply left alone),
// whose folders would otherwise sit in userData forever.
export function pruneLocalHistory(): void {
  try {
    if (!fs.existsSync(SNAPSHOT_ROOT)) return
    for (const name of fs.readdirSync(SNAPSHOT_ROOT)) {
      const dir = path.join(SNAPSHOT_ROOT, name)
      const meta = readMeta(dir)
      if (!meta) {
        fs.rmSync(dir, { recursive: true, force: true })
        continue
      }
      const kept = applyRetention(dir, meta.entries)
      if (kept.length === 0) fs.rmSync(dir, { recursive: true, force: true })
      else if (kept.length !== meta.entries.length) writeMeta(dir, { ...meta, entries: kept })
    }
  } catch (e) {
    console.warn('Failed to prune local history:', e)
  }
}
