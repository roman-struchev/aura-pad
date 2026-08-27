import { readFileContent, writeFileContent } from './workspaces'
import { encodeFileContent } from './encoding'
import { pathDenial } from './pathAccess'
import { recordSnapshot } from './localHistory'
import { buildSearchRegex, replacementFor } from '../shared/searchQuery'
import type { ReplaceRequest, ReplaceResult } from '../shared/searchQuery'

// Replace-across-files, and the one step back out of it.
//
// Deliberately not routed through save-file: the files being rewritten are on
// disk, not in a tab, so there is no self-write to record. Skipping
// recordSelfWrite is what makes the watcher report each rewritten file as an
// outside change, which is how an open (clean) tab picks the replacement up
// instead of sitting on stale content and writing it back on the next
// autosave. Tabs with unsaved edits never get here - the renderer excludes
// them from the selection.

// One operation's worth of "before" content, so a replacement that went wrong
// can be taken back in one gesture, for the whole batch at once. Held in
// memory only - the version that survives a restart is the per-file snapshot
// this also writes into local history (src/main/localHistory.ts).
const REPLACE_UNDO_LIMIT_BYTES = 32 * 1024 * 1024
let undoSnapshot: Map<string, string> | null = null

function emptyResult(error?: string): ReplaceResult {
  return { success: !error, error, filesChanged: 0, replacements: 0, canUndo: false }
}

export function replaceInFiles(request: ReplaceRequest): ReplaceResult {
  const { paths, query, replacement, options } = request
  if (paths.length === 0) return emptyResult('Nothing selected to replace in.')

  const denial = pathDenial(...paths)
  if (denial) return emptyResult(denial)

  const matcher = buildSearchRegex(query, options)
  if (!matcher) return emptyResult('That search pattern is not valid.')
  const replaceWith = replacementFor(replacement, options)

  const snapshot = new Map<string, string>()
  let snapshotBytes = 0
  const failures: string[] = []
  let filesChanged = 0
  let replacements = 0

  for (const filePath of paths) {
    const read = readFileContent(filePath)
    if (!read.success || read.content === undefined) {
      failures.push(`${filePath}: ${read.error ?? 'could not be read'}`)
      continue
    }

    matcher.lastIndex = 0
    const hits = read.content.match(matcher)?.length ?? 0
    if (hits === 0) continue

    matcher.lastIndex = 0
    const updated = read.content.replace(matcher, replaceWith)
    if (updated === read.content) continue

    // Into local history as well as the in-memory snapshot below: a bulk
    // rewrite is exactly the change someone discovers was wrong tomorrow,
    // after the undo step is gone with the process.
    recordSnapshot(filePath, read.content, 'Replace in files', true)

    // Encoded through the same path a save takes, so a cp1251 or UTF-16 file
    // comes back in its own encoding rather than being quietly transcoded.
    const written = writeFileContent(filePath, encodeFileContent(filePath, updated))
    if (!written.success) {
      failures.push(`${filePath}: ${written.error ?? 'could not be written'}`)
      continue
    }

    snapshotBytes += Buffer.byteLength(read.content)
    if (snapshotBytes <= REPLACE_UNDO_LIMIT_BYTES) snapshot.set(filePath, read.content)
    filesChanged++
    replacements += hits
  }

  // All or nothing would mean holding every file in memory and rolling back on
  // the first failure; instead each file stands alone and the failures are
  // reported, with the successful ones still undoable.
  const canUndo = snapshot.size > 0 && snapshotBytes <= REPLACE_UNDO_LIMIT_BYTES
  undoSnapshot = canUndo ? snapshot : null

  return {
    success: failures.length === 0,
    error: failures.length > 0 ? failures.join('\n') : undefined,
    filesChanged,
    replacements,
    canUndo
  }
}

export function undoReplaceInFiles(): ReplaceResult {
  if (!undoSnapshot) return emptyResult('There is nothing to undo.')

  const failures: string[] = []
  let filesChanged = 0
  for (const [filePath, original] of undoSnapshot) {
    const denial = pathDenial(filePath)
    if (denial) {
      failures.push(`${filePath}: ${denial}`)
      continue
    }
    const written = writeFileContent(filePath, encodeFileContent(filePath, original))
    if (written.success) filesChanged++
    else failures.push(`${filePath}: ${written.error ?? 'could not be written'}`)
  }

  // One step only: after taking it, there is nothing further back to go.
  undoSnapshot = null
  return {
    success: failures.length === 0,
    error: failures.length > 0 ? failures.join('\n') : undefined,
    filesChanged,
    replacements: 0,
    canUndo: false
  }
}
