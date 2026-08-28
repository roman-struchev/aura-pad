import fs from 'fs'
import path from 'path'
import { readFileContent, writeFileContent } from './workspaces'
import { encodeFileContent } from './encoding'
import { recordSnapshot } from './localHistory'
import { setupWatchers } from './watcher'
import type { OpResult } from '../shared/ipc'

// "Save as .http": the request someone filled in on the HTTP Client form,
// appended to a file that lives in their repository next to the code. That is
// the whole point of the format being plain text - a one-off experiment
// becomes something the next person can run.
//
// Appends rather than overwrites: these files are lists of requests separated
// by `###`, and the natural gesture is adding one more.

const ALLOWED_EXTENSIONS = new Set(['.http', '.rest'])

export function appendHttpRequest(filePath: string, block: string): OpResult {
  // Narrower than the path allowlist on purpose: this handler takes free text
  // from the renderer, so it may only ever write it into a request file.
  if (!ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { success: false, error: 'Requests can only be saved into a .http or .rest file.' }
  }

  const exists = fs.existsSync(filePath)
  // "api/orders.http" in a folder that has no api/ yet: the point of naming
  // the file here is not having to go and make its folder first. Only ever
  // below a path the renderer is already allowed to write to - the caller
  // checks that (pathDenial in ipcHandlers.ts) before this runs.
  if (!exists) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'That folder could not be created.'
      }
    }
  }
  let existing = ''
  if (exists) {
    const read = readFileContent(filePath)
    if (!read.success || read.content === undefined) {
      return { success: false, error: read.error ?? 'That file could not be read.' }
    }
    existing = read.content
    recordSnapshot(filePath, existing, 'Save')
  }

  const separator =
    existing === '' || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  const updated = `${existing}${separator}${block.endsWith('\n') ? block : `${block}\n`}`

  // Deliberately no recordSelfWrite: if the file is open in a (clean) tab,
  // the watcher's external-change event is what makes that tab show the
  // request that was just appended instead of the text from before it.
  const written = writeFileContent(filePath, encodeFileContent(filePath, updated))
  if (!written.success) return { success: false, error: written.error }
  // A file that didn't exist a moment ago has to reach the tree.
  if (!exists) setupWatchers()
  return { success: true }
}
