import os from 'os'
import fs from 'fs'
import path from 'path'
import type { PathListingResult, PathMatchEntry } from '../shared/pathMatch'

// Powers Quick Open's "path mode" (typing ~/... or /...) - lists real
// filesystem entries whose name starts with whatever's typed after the last
// slash, so a file outside every workspace can be found and opened without
// adding its folder as a workspace.
export function listPathMatches(rawInputArg: string): PathListingResult {
  // Normalize bare "~" to "~/" first (list the home dir itself, not filter
  // its parent by username) - then read the trailing slash off the RAW
  // input before tilde expansion. path.join() silently drops a trailing
  // slash, so checking it after expansion mistook "list this folder" for
  // "filter its parent by this folder's name", surfacing the folder itself
  // as the sole match and jumping straight into it instead of listing it.
  const rawInput = rawInputArg === '~' ? '~/' : rawInputArg
  const endsWithSlash = rawInput.endsWith('/')

  let input = rawInput
  if (input.startsWith('~/')) input = path.join(os.homedir(), input.slice(2))

  const dir = endsWithSlash ? input || '/' : path.dirname(input)
  const prefix = endsWithSlash ? '' : path.basename(input)

  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch (e) {
    return { dir, entries: [] }
  }

  const lowerPrefix = prefix.toLowerCase()
  const entries: PathMatchEntry[] = names
    .filter((name) => name.toLowerCase().startsWith(lowerPrefix))
    .map((name) => {
      const fullPath = path.join(dir, name)
      let type: 'file' | 'directory' = 'file'
      try {
        type = fs.statSync(fullPath).isDirectory() ? 'directory' : 'file'
      } catch (e) {}
      return { name, path: fullPath, type }
    })
    .sort((a, b) =>
      a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
    )

  return { dir, entries }
}
