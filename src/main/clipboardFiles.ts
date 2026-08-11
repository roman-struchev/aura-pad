import { clipboard } from 'electron'
import fs from 'fs'
import path from 'path'
import type { OpResult } from '../shared/ipc'

// File copy/paste between the tree and the OS file manager. Electron's
// clipboard API only speaks text/image/html directly, so file lists go
// through the platform's raw pasteboard formats:
//
//   macOS   NSFilenamesPboardType - an XML plist array of absolute paths.
//           Deprecated in AppKit but still what Finder reads and writes.
//   Linux   x-special/gnome-copied-files - "copy\n<file-url>\n<file-url>".
//   Windows no reliable raw format through Electron (CF_HDROP needs the
//           predefined format id, which writeBuffer can't address), so it
//           falls back to plain text - which the reader below understands,
//           keeping in-app copy/paste working even there.
//
// Every write* call replaces the whole clipboard, so exactly one format is
// written per copy; the reader tries all of them plus the text fallback.

const MAC_FILE_LIST = 'NSFilenamesPboardType'
const MAC_FILE_URL = 'public.file-url'
const GNOME_FILE_LIST = 'x-special/gnome-copied-files'
const URI_LIST = 'text/uri-list'
const WINDOWS_FILE_NAME = 'FileNameW'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function toFileUrl(filePath: string): string {
  // encodeURI leaves '#' and '?' alone, and both are legal in file names.
  return `file://${encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

function fromFileUrl(value: string): string | null {
  if (!value.startsWith('file://')) return null
  try {
    return decodeURIComponent(value.slice('file://'.length).replace(/\+/g, '%2B'))
  } catch {
    return null
  }
}

// Only absolute paths that still exist are handed back - the clipboard easily
// outlives the files it points at, and the plain-text fallback below would
// otherwise treat any copied prose as a file list. Absolute matters on its
// own: a relative string ("src/main/index.ts", copied out of a README) would
// be resolved by existsSync against the *main process's* working directory,
// so pasting it would drop some unrelated file into the user's workspace.
function existingPaths(paths: (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!p || seen.has(p) || !path.isAbsolute(p)) continue
    seen.add(p)
    try {
      if (fs.existsSync(p)) out.push(p)
    } catch {
      // Unreadable path - just skip it.
    }
  }
  return out
}

function readBufferSafe(format: string): Buffer | null {
  try {
    const buf = clipboard.readBuffer(format)
    return buf && buf.length > 0 ? buf : null
  } catch {
    return null
  }
}

export function writeFilesToClipboard(paths: string[]): OpResult {
  if (paths.length === 0) return { success: false, error: 'Nothing to copy' }
  try {
    if (process.platform === 'darwin') {
      const items = paths.map((p) => `<string>${escapeXml(p)}</string>`).join('')
      const plist =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        `<plist version="1.0"><array>${items}</array></plist>`
      clipboard.writeBuffer(MAC_FILE_LIST, Buffer.from(plist, 'utf8'))
      return { success: true }
    }
    if (process.platform === 'linux') {
      const payload = ['copy', ...paths.map(toFileUrl)].join('\n')
      clipboard.writeBuffer(GNOME_FILE_LIST, Buffer.from(payload, 'utf8'))
      return { success: true }
    }
    clipboard.writeText(paths.join('\r\n'))
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function readFilesFromClipboard(): string[] {
  // macOS: the plist file list, then the single-file URL flavor.
  const macList = readBufferSafe(MAC_FILE_LIST)
  if (macList) {
    const matches = [...macList.toString('utf8').matchAll(/<string>([\s\S]*?)<\/string>/g)]
    const paths = existingPaths(matches.map((m) => unescapeXml(m[1])))
    if (paths.length > 0) return paths
  }
  const macUrl = readBufferSafe(MAC_FILE_URL)
  if (macUrl) {
    const paths = existingPaths([fromFileUrl(macUrl.toString('utf8').trim())])
    if (paths.length > 0) return paths
  }

  // Linux: GNOME's list carries an operation verb on the first line.
  for (const format of [GNOME_FILE_LIST, URI_LIST]) {
    const buf = readBufferSafe(format)
    if (!buf) continue
    const lines = buf
      .toString('utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l !== 'copy' && l !== 'cut')
    const paths = existingPaths(lines.map((l) => fromFileUrl(l) ?? l))
    if (paths.length > 0) return paths
  }

  // Windows: Explorer's legacy single-file format is UTF-16 and null-padded.
  const winName = readBufferSafe(WINDOWS_FILE_NAME)
  if (winName) {
    const paths = existingPaths([winName.toString('utf16le').replace(/\0.*$/, '')])
    if (paths.length > 0) return paths
  }

  // Last resort, and the Windows write path's counterpart: plain text that
  // happens to be a list of real paths (also covers Finder's "Copy as
  // Pathname" and paths pasted from a terminal).
  const text = clipboard.readText()
  if (!text) return []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
  // A whole copied paragraph must not be mistaken for a path list.
  if (lines.length === 0 || lines.length > 100) return []
  return existingPaths(lines.map((l) => fromFileUrl(l) ?? l))
}
