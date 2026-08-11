import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import ignore, { type Ignore } from 'ignore'
import { readConfigFile, writeConfigFile } from './configFile'
import { decodeFileBuffer, remapEncodingPaths } from './encoding'
import type { FileNode } from '../shared/fileNode'
import type { SearchResult } from '../shared/searchResult'

const workspacesConfigPath = path.join(app.getPath('userData'), 'workspaces.json')

export function loadWorkspaces(): string[] {
  // Copied so callers that build a new list (push/filter) can't mutate the
  // cached array behind readConfigFile's back.
  return [...readConfigFile<string[]>(workspacesConfigPath, () => [])]
}

export function saveWorkspaces(paths: string[]): void {
  writeConfigFile(workspacesConfigPath, paths)
}

// Ignore hidden files/folders (starting with .) and common system/build folders
export function isIgnored(name: string): boolean {
  return (
    name.startsWith('.') ||
    [
      'node_modules',
      'dist',
      'out',
      'build',
      'target',
      'venv',
      '.venv',
      '__pycache__',
      'package-lock.json',
      'yarn.lock'
    ].includes(name)
  )
}

// Load .gitignore rules (if any) at the root of a workspace, on top of the
// hardcoded isIgnored() rules above.
export function loadGitignore(rootPath: string): Ignore {
  const ig = ignore()
  try {
    const gitignorePath = path.join(rootPath, '.gitignore')
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, 'utf-8'))
    }
  } catch (e) {
    console.warn('Failed to read .gitignore:', e)
  }
  return ig
}

// Walks with fs.promises (like searchInWorkspaces below) so each
// readdir/stat yields to the event loop - the fully synchronous version
// froze every other IPC call (saves, terminal I/O, git status) for the
// duration of a large workspace's walk, and it runs on every structural
// fs event.
// The `ignore` package speaks POSIX-relative paths only, and a directory-only
// pattern ("build/", "coverage/" - the most common kind of .gitignore entry)
// matches only when the path it is tested against ends in a slash. Testing a
// directory by its bare name therefore silently ignored the rule and left the
// folder in the tree (empty, since its *contents* did match). The separator
// swap matters on Windows, where path.relative yields "a\b" and nothing below
// the top level would match at all.
function ignoresEntry(ig: Ignore, relPath: string, isDirectoryLike: boolean): boolean {
  const posix = relPath.split(path.sep).join('/')
  return ig.ignores(posix) || (isDirectoryLike && ig.ignores(`${posix}/`))
}

async function buildFileTree(
  dirPath: string,
  rootPath: string,
  ig: Ignore,
  isRoot = false,
  // Real (symlink-resolved) paths of this directory and every ancestor. A
  // symlink pointing back at one of them (e.g. `link -> .` or `link -> ..`)
  // would otherwise recurse forever, hanging the tree build - and, via the
  // fs.watch trigger, pinning the CPU on every structural change.
  ancestors: ReadonlySet<string> = new Set()
): Promise<FileNode> {
  const name = path.basename(dirPath)
  const item: FileNode = { name, path: dirPath, type: 'directory', children: [], isRoot }

  try {
    // withFileTypes: one readdir instead of a stat per entry.
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const file = entry.name
      if (file === '.git' || file === '.DS_Store' || isIgnored(file)) continue

      const fullPath = path.join(dirPath, file)
      const relPath = path.relative(rootPath, fullPath)
      // A symlink counts as directory-like here: resolving what it points at
      // costs a stat, and offering both forms to the matcher is cheaper.
      if (relPath && ignoresEntry(ig, relPath, entry.isDirectory() || entry.isSymbolicLink()))
        continue

      try {
        // Symlinks still need a real stat to know what they point at.
        const isDirectory = entry.isSymbolicLink()
          ? (await fs.promises.stat(fullPath)).isDirectory()
          : entry.isDirectory()
        if (isDirectory) {
          // Resolve the real target so a symlink cycle is detected regardless
          // of the path used to reach it.
          let real: string
          try {
            real = await fs.promises.realpath(fullPath)
          } catch {
            real = fullPath
          }
          if (ancestors.has(real)) continue
          item.children!.push(
            await buildFileTree(fullPath, rootPath, ig, false, new Set(ancestors).add(real))
          )
        } else {
          item.children!.push({ name: file, path: fullPath, type: 'file' })
        }
      } catch (e) {}
    }
    item.children!.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === 'directory' ? -1 : 1
    })
  } catch (e) {
    console.warn(`Failed to read directory "${dirPath}":`, e)
  }

  return item
}

export async function getWorkspaceTrees(): Promise<FileNode[]> {
  const paths = loadWorkspaces()
  const trees: FileNode[] = []
  for (const p of paths) {
    if (fs.existsSync(p)) {
      let rootReal: string
      try {
        rootReal = await fs.promises.realpath(p)
      } catch {
        rootReal = p
      }
      trees.push(await buildFileTree(p, p, loadGitignore(p), true, new Set([rootReal])))
    }
  }
  return trees
}

const SEARCHABLE_EXTENSION_RE = /\.(py|json|md|txt|ts|tsx|js|jsx|css|html|yml|yaml|xml)$/i
const MAX_TOTAL_SEARCH_RESULTS = 500
// Bounds how much a single file (e.g. a huge generated/minified one that
// slipped past the extension filter) can contribute, so it can't alone
// dominate the result cap above at the expense of every other match.
const MAX_RESULTS_PER_FILE = 50
// Skip absurdly large text-like files rather than reading them fully into
// memory - a search result from a multi-megabyte log isn't very actionable
// anyway.
const MAX_SEARCHABLE_FILE_BYTES = 2 * 1024 * 1024

// Signals "stop, the global cap was hit" up through the recursive walk -
// lighter than threading a mutable "stop" flag through every call and check.
class SearchCapReached extends Error {}
class SearchSuperseded extends Error {}

// Each keystroke in the search UI (after its debounce) starts a fresh
// full-workspace scan while the renderer just discards the previous call's
// promise - without this counter the abandoned scans would keep walking the
// disk to completion, stacking up and starving every other IPC call.
let searchGeneration = 0

export async function searchInWorkspaces(query: string): Promise<SearchResult[]> {
  const generation = ++searchGeneration
  const workspacePaths = loadWorkspaces()
  const results: SearchResult[] = []
  if (!query || query.length < 2) return results

  const queryLower = query.toLowerCase()

  // Walks with fs.promises (not the *Sync variants the rest of this module
  // uses) so each readdir/stat/readFile call yields to the event loop -
  // otherwise a large workspace would freeze every other IPC call (saves,
  // git status, terminal I/O) for as long as the whole recursive scan takes.
  async function searchDir(
    rootPath: string,
    ig: Ignore,
    currentPath: string,
    // Real paths of the ancestor chain - see buildFileTree; stat() follows
    // symlinks, so without this a cyclic link recurses forever on every
    // keystroke.
    ancestors: ReadonlySet<string>
  ): Promise<void> {
    let files: string[]
    try {
      files = await fs.promises.readdir(currentPath)
    } catch (e) {
      return
    }

    for (const file of files) {
      if (generation !== searchGeneration) throw new SearchSuperseded()
      if (isIgnored(file)) continue

      const fullPath = path.join(currentPath, file)
      const relPath = path.relative(rootPath, fullPath)
      if (relPath && ig.ignores(relPath)) continue

      let stat: fs.Stats
      try {
        stat = await fs.promises.stat(fullPath)
      } catch (e) {
        continue
      }

      if (stat.isDirectory()) {
        let real: string
        try {
          real = await fs.promises.realpath(fullPath)
        } catch {
          real = fullPath
        }
        if (ancestors.has(real)) continue
        await searchDir(rootPath, ig, fullPath, new Set(ancestors).add(real))
      } else if (SEARCHABLE_EXTENSION_RE.test(file) && stat.size <= MAX_SEARCHABLE_FILE_BYTES) {
        let content: string
        try {
          content = await fs.promises.readFile(fullPath, 'utf-8')
        } catch (e) {
          continue
        }
        if (!content.toLowerCase().includes(queryLower)) continue

        const lines = content.split('\n')
        let matchesInFile = 0
        for (let index = 0; index < lines.length; index++) {
          const colIdx = lines[index].toLowerCase().indexOf(queryLower)
          if (colIdx === -1) continue
          results.push({
            file,
            path: fullPath,
            line: index + 1,
            col: colIdx + 1,
            matchLen: queryLower.length,
            content: lines[index].trim()
          })
          matchesInFile++
          if (results.length >= MAX_TOTAL_SEARCH_RESULTS) throw new SearchCapReached()
          if (matchesInFile >= MAX_RESULTS_PER_FILE) break
        }
      }

      if (results.length >= MAX_TOTAL_SEARCH_RESULTS) throw new SearchCapReached()
    }
  }

  for (const rootPath of workspacePaths) {
    if (!fs.existsSync(rootPath)) continue
    let rootReal: string
    try {
      rootReal = await fs.promises.realpath(rootPath)
    } catch {
      rootReal = rootPath
    }
    try {
      await searchDir(rootPath, loadGitignore(rootPath), rootPath, new Set([rootReal]))
    } catch (e) {
      if (e instanceof SearchSuperseded) return []
      if (e instanceof SearchCapReached) break
    }
  }

  return results
}

interface PathOpResult {
  success: boolean
  newPath?: string
  trees?: FileNode[]
  error?: string
}

// The batch counterpart (copy/delete of a whole selection): `error` collects
// the per-entry failures, and `trees` is present either way so a partially
// applied batch still refreshes the sidebar.
interface PathsOpResult {
  success: boolean
  newPaths?: string[]
  trees?: FileNode[]
  error?: string
}

// A new/renamed entry's name must stay within its parent directory - reject
// anything containing a path separator (or "." / "..") so it can't be used
// to create/move a file outside the folder the user actually picked.
function isValidEntryName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

const MAX_READABLE_FILE_BYTES = 10 * 1024 * 1024

export function readFileContent(filePath: string): {
  success: boolean
  content?: string
  error?: string
} {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_READABLE_FILE_BYTES) {
      const limitMb = MAX_READABLE_FILE_BYTES / (1024 * 1024)
      const sizeMb = (stat.size / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `File is too large to open (${sizeMb} MB, limit is ${limitMb} MB).`
      }
    }
    // Decoded (not assumed UTF-8): legacy cp1251/latin1/UTF-16 files used to
    // come back as replacement characters, which the next autosave then wrote
    // over the original file. decodeFileBuffer also owns the binary check.
    const decoded = decodeFileBuffer(filePath, fs.readFileSync(filePath))
    if (decoded.error !== undefined) return { success: false, error: decoded.error }
    return { success: true, content: decoded.content }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Writes to a temp file in the same directory and renames it over the target
// (atomic within one filesystem), so a crash or power loss mid-write can't
// leave the user's file truncated: it holds either the old or the new content,
// never a partial one. The dot-prefixed temp name keeps it out of the file
// tree and the watcher, both of which skip dotfiles via isIgnored().
//
// Takes the already-encoded bytes (see encodeFileContent), not a string: the
// caller also needs those exact bytes for recordSelfWrite(), and encoding
// twice could diverge.
export function writeFileContent(
  filePath: string,
  content: Buffer
): { success: boolean; error?: string } {
  try {
    // Follow a symlink to its real target - renaming over the link itself
    // would silently replace the link with a regular file. Also keep the
    // existing file's permissions (e.g. an executable script's +x bit),
    // which the fresh temp file wouldn't have.
    let targetPath = filePath
    let mode: number | undefined
    try {
      targetPath = fs.realpathSync(filePath)
      mode = fs.statSync(targetPath).mode
    } catch {
      // New file: keep the given path and default permissions.
    }
    const tmpPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${process.pid}.tmp`
    )
    fs.writeFileSync(tmpPath, content, { mode })
    try {
      fs.renameSync(tmpPath, targetPath)
    } catch (e) {
      fs.rmSync(tmpPath, { force: true })
      throw e
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function renamePath(oldPath: string, newName: string): Promise<PathOpResult> {
  if (!isValidEntryName(newName)) {
    return { success: false, error: 'Invalid name.' }
  }
  try {
    const newPath = path.join(path.dirname(oldPath), newName)
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with this name already exists' }
    }
    fs.renameSync(oldPath, newPath)
    remapEncodingPaths(oldPath, newPath)

    // Keep workspace roots in sync if a root folder was renamed
    const workspacePaths = loadWorkspaces()
    const idx = workspacePaths.indexOf(oldPath)
    if (idx !== -1) {
      workspacePaths[idx] = newPath
      saveWorkspaces(workspacePaths)
    }

    return { success: true, newPath, trees: await getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function createPath(
  parentPath: string,
  name: string,
  type: 'file' | 'directory'
): Promise<PathOpResult> {
  if (!isValidEntryName(name)) {
    return { success: false, error: 'Invalid name.' }
  }
  try {
    const newPath = path.join(parentPath, name)
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with this name already exists' }
    }
    if (type === 'directory') {
      fs.mkdirSync(newPath)
    } else {
      fs.writeFileSync(newPath, '')
    }
    return { success: true, newPath, trees: await getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Finds a free destination name, Finder/Explorer-style: "name copy.ext", "name copy 2.ext", ...
function getAvailableDestName(destDir: string, originalName: string): string {
  const ext = path.extname(originalName)
  const stem = ext ? originalName.slice(0, -ext.length) : originalName

  let candidate = originalName
  if (fs.existsSync(path.join(destDir, candidate))) {
    candidate = `${stem} copy${ext}`
    let n = 2
    while (fs.existsSync(path.join(destDir, candidate))) {
      candidate = `${stem} copy ${n}${ext}`
      n++
    }
  }
  return candidate
}

function copyOne(sourcePath: string, requestedTargetDirPath: string): string {
  // Pasting onto the exact folder that was copied means "duplicate it",
  // so copy alongside it (into its parent) instead of into itself.
  const targetDirPath =
    requestedTargetDirPath === sourcePath ? path.dirname(sourcePath) : requestedTargetDirPath

  const rel = path.relative(sourcePath, targetDirPath)
  if (fs.statSync(sourcePath).isDirectory() && (rel === '' || !rel.startsWith('..'))) {
    throw new Error(`Cannot copy "${path.basename(sourcePath)}" into itself or its subfolder`)
  }

  const destName = getAvailableDestName(targetDirPath, path.basename(sourcePath))
  const newPath = path.join(targetDirPath, destName)
  fs.cpSync(sourcePath, newPath, { recursive: true })
  return newPath
}

// Batch by design: the sources come from a multi-selection or an OS-clipboard
// file list, and one failing entry (a vanished path, a permission error) must
// not abandon the rest - every source is attempted, the errors are collected,
// and the trees are rebuilt once at the end.
export async function copyPaths(
  sourcePaths: string[],
  targetDirPath: string
): Promise<PathsOpResult> {
  const newPaths: string[] = []
  const errors: string[] = []
  for (const sourcePath of sourcePaths) {
    try {
      newPaths.push(copyOne(sourcePath, targetDirPath))
    } catch (e: any) {
      errors.push(e.message)
    }
  }
  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join('\n') : undefined,
    newPaths,
    trees: await getWorkspaceTrees()
  }
}

export async function deletePaths(targetPaths: string[]): Promise<PathsOpResult> {
  const errors: string[] = []
  for (const targetPath of targetPaths) {
    try {
      await shell.trashItem(targetPath)
    } catch (e: any) {
      errors.push(e.message)
      continue
    }
    const workspacePaths = loadWorkspaces()
    if (workspacePaths.includes(targetPath)) {
      saveWorkspaces(workspacePaths.filter((p) => p !== targetPath))
    }
  }
  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join('\n') : undefined,
    trees: await getWorkspaceTrees()
  }
}

export async function movePath(sourcePath: string, targetDirPath: string): Promise<PathOpResult> {
  try {
    const sourceParent = path.dirname(sourcePath)
    if (sourcePath === targetDirPath || sourceParent === targetDirPath) {
      return { success: true, newPath: sourcePath, trees: await getWorkspaceTrees() }
    }

    // Prevent moving a folder into itself or one of its own descendants
    const rel = path.relative(sourcePath, targetDirPath)
    if (rel === '' || !rel.startsWith('..')) {
      return { success: false, error: 'Cannot move a folder into itself or its subfolder' }
    }

    const newPath = path.join(targetDirPath, path.basename(sourcePath))
    if (fs.existsSync(newPath)) {
      return {
        success: false,
        error: 'A file or folder with this name already exists in the destination'
      }
    }
    fs.renameSync(sourcePath, newPath)
    remapEncodingPaths(sourcePath, newPath)

    // Keep workspace roots in sync if a root folder was moved
    const workspacePaths = loadWorkspaces()
    const idx = workspacePaths.indexOf(sourcePath)
    if (idx !== -1) {
      workspacePaths[idx] = newPath
      saveWorkspaces(workspacePaths)
    }

    return { success: true, newPath, trees: await getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
