import { app, net } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  isSpellLanguage,
  type SpellDictionaryFiles,
  type SpellLanguage
} from '../shared/spellcheck'
import type { OpResult } from '../shared/ipc'

// Getting the spelling dictionaries onto the machine, once.
//
// Pinned to a commit rather than to a branch: this is the same reasoning as
// docs/BUGS.md §3 about the update script - "whatever that URL serves today"
// is not something the user agreed to. A dictionary is only data, but it is
// data the editor then trusts about every word someone writes.
//
// Downloaded here rather than in the renderer because the page's CSP has no
// business gaining a connect-src for GitHub, and because the files belong in
// userData next to the other things the app keeps.

const REPO_COMMIT = '8cfea406b505e4d7df52d5a19bce525df98c54ab'
const BASE_URL = `https://raw.githubusercontent.com/wooorm/dictionaries/${REPO_COMMIT}/dictionaries`

// Enough for the biggest dictionary in the catalog (ru, ~3.5 MB) with room
// to spare, and small enough that a redirect to something else can't fill
// the disk.
const MAX_FILE_BYTES = 16 * 1024 * 1024

// The license travels with the dictionary: these are other people's word
// lists under their own terms, and shipping the words without the license
// they came with would be wrong.
const FILES = ['index.aff', 'index.dic', 'license'] as const

function dictionaryDir(lang: SpellLanguage): string {
  return path.join(app.getPath('userData'), 'dictionaries', lang)
}

export function isDictionaryInstalled(lang: SpellLanguage): boolean {
  const dir = dictionaryDir(lang)
  return fs.existsSync(path.join(dir, 'index.aff')) && fs.existsSync(path.join(dir, 'index.dic'))
}

export function listInstalledDictionaries(): SpellLanguage[] {
  return (['en', 'ru'] as SpellLanguage[]).filter(isDictionaryInstalled)
}

async function fetchText(url: string): Promise<string> {
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('That dictionary is unexpectedly large.')
  return buffer.toString('utf-8')
}

export async function downloadDictionary(lang: string): Promise<OpResult> {
  if (!isSpellLanguage(lang)) return { success: false, error: 'Unknown dictionary.' }
  try {
    // Fetched in full before anything is written, so a failed download leaves
    // no half-installed dictionary that would then be loaded as if it were
    // whole.
    const contents = await Promise.all(
      FILES.map((file) => fetchText(`${BASE_URL}/${lang}/${file}`))
    )
    const dir = dictionaryDir(lang)
    fs.mkdirSync(dir, { recursive: true })
    FILES.forEach((file, index) => fs.writeFileSync(path.join(dir, file), contents[index], 'utf-8'))
    return { success: true }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'The dictionary could not be downloaded.'
    }
  }
}

export function removeDictionary(lang: string): OpResult {
  if (!isSpellLanguage(lang)) return { success: false, error: 'Unknown dictionary.' }
  try {
    fs.rmSync(dictionaryDir(lang), { recursive: true, force: true })
    return { success: true }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'The dictionary could not be removed.'
    }
  }
}

// Handed to the renderer's worker, which builds its index from them. A few
// megabytes of text crossing IPC once per session is cheaper than teaching
// the worker to read files.
export function readDictionary(lang: string): SpellDictionaryFiles {
  if (!isSpellLanguage(lang)) return { success: false, error: 'Unknown dictionary.' }
  const dir = dictionaryDir(lang)
  try {
    return {
      success: true,
      aff: fs.readFileSync(path.join(dir, 'index.aff'), 'utf-8'),
      dic: fs.readFileSync(path.join(dir, 'index.dic'), 'utf-8')
    }
  } catch {
    return { success: false, error: 'That dictionary is not installed.' }
  }
}
