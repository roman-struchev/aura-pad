import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import ignore, { type Ignore } from 'ignore'
import type { FileNode } from '../shared/fileNode'
import type { SearchResult } from '../shared/searchResult'

const workspacesConfigPath = path.join(app.getPath('userData'), 'workspaces.json')

export function loadWorkspaces(): string[] {
  try {
    if (fs.existsSync(workspacesConfigPath)) {
      return JSON.parse(fs.readFileSync(workspacesConfigPath, 'utf-8'))
    }
  } catch (e) {}
  return []
}

export function saveWorkspaces(paths: string[]): void {
  try {
    fs.writeFileSync(workspacesConfigPath, JSON.stringify(paths))
  } catch (e) {}
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
function loadGitignore(rootPath: string): Ignore {
  const ig = ignore()
  try {
    const gitignorePath = path.join(rootPath, '.gitignore')
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, 'utf-8'))
    }
  } catch (e) {}
  return ig
}

function buildFileTree(dirPath: string, rootPath: string, ig: Ignore, isRoot = false): FileNode {
  const name = path.basename(dirPath)
  const item: FileNode = { name, path: dirPath, type: 'directory', children: [], isRoot }

  try {
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      if (file === '.git' || file === '.DS_Store' || isIgnored(file)) continue

      const fullPath = path.join(dirPath, file)
      const relPath = path.relative(rootPath, fullPath)
      if (relPath && ig.ignores(relPath)) continue

      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          item.children!.push(buildFileTree(fullPath, rootPath, ig))
        } else {
          item.children!.push({ name: file, path: fullPath, type: 'file' })
        }
      } catch (e) {}
    }
    item.children!.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === 'directory' ? -1 : 1
    })
  } catch (e) {}

  return item
}

export function getWorkspaceTrees(): FileNode[] {
  const paths = loadWorkspaces()
  const trees: FileNode[] = []
  for (const p of paths) {
    if (fs.existsSync(p)) {
      trees.push(buildFileTree(p, p, loadGitignore(p), true))
    }
  }
  return trees
}

export async function searchInWorkspaces(query: string): Promise<SearchResult[]> {
  const workspacePaths = loadWorkspaces()
  const results: SearchResult[] = []
  if (!query || query.length < 2) return results

  const queryLower = query.toLowerCase()

  for (const rootPath of workspacePaths) {
    if (!fs.existsSync(rootPath)) continue

    const ig = loadGitignore(rootPath)
    const searchRecursive = (currentPath: string) => {
      try {
        const files = fs.readdirSync(currentPath)
        for (const file of files) {
          if (isIgnored(file)) continue

          const fullPath = path.join(currentPath, file)
          const relPath = path.relative(rootPath, fullPath)
          if (relPath && ig.ignores(relPath)) continue

          const stat = fs.statSync(fullPath)

          if (stat.isDirectory()) {
            searchRecursive(fullPath)
          } else {
            // Only search in text-like files
            if (/\.(py|json|md|txt|ts|tsx|js|jsx|css|html|yml|yaml|xml)$/i.test(file)) {
              const content = fs.readFileSync(fullPath, 'utf-8')
              if (content.toLowerCase().includes(queryLower)) {
                const lines = content.split('\n')
                lines.forEach((line, index) => {
                  if (line.toLowerCase().includes(queryLower)) {
                    results.push({
                      file: file,
                      path: fullPath,
                      line: index + 1,
                      content: line.trim()
                    })
                  }
                })
              }
            }
          }
          if (results.length > 500) return // Cap results
        }
      } catch (e) {}
    }
    searchRecursive(rootPath)
  }
  return results
}

interface PathOpResult {
  success: boolean
  newPath?: string
  trees?: FileNode[]
  error?: string
}

export function readFileContent(filePath: string): {
  success: boolean
  content?: string
  error?: string
} {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return { success: true, content }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function writeFileContent(
  filePath: string,
  content: string
): { success: boolean; error?: string } {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function renamePath(oldPath: string, newName: string): PathOpResult {
  try {
    const newPath = path.join(path.dirname(oldPath), newName)
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with this name already exists' }
    }
    fs.renameSync(oldPath, newPath)

    // Keep workspace roots in sync if a root folder was renamed
    const workspacePaths = loadWorkspaces()
    const idx = workspacePaths.indexOf(oldPath)
    if (idx !== -1) {
      workspacePaths[idx] = newPath
      saveWorkspaces(workspacePaths)
    }

    return { success: true, newPath, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function createPath(
  parentPath: string,
  name: string,
  type: 'file' | 'directory'
): PathOpResult {
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
    return { success: true, newPath, trees: getWorkspaceTrees() }
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

export function copyPath(sourcePath: string, requestedTargetDirPath: string): PathOpResult {
  try {
    // Pasting onto the exact folder that was copied means "duplicate it",
    // so copy alongside it (into its parent) instead of into itself.
    const targetDirPath =
      requestedTargetDirPath === sourcePath ? path.dirname(sourcePath) : requestedTargetDirPath

    const rel = path.relative(sourcePath, targetDirPath)
    if (fs.statSync(sourcePath).isDirectory() && (rel === '' || !rel.startsWith('..'))) {
      return { success: false, error: 'Cannot copy a folder into itself or its subfolder' }
    }

    const destName = getAvailableDestName(targetDirPath, path.basename(sourcePath))
    const newPath = path.join(targetDirPath, destName)
    fs.cpSync(sourcePath, newPath, { recursive: true })

    return { success: true, newPath, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function deletePath(
  targetPath: string
): Promise<{ success: boolean; trees?: FileNode[]; error?: string }> {
  try {
    await shell.trashItem(targetPath)

    const workspacePaths = loadWorkspaces()
    if (workspacePaths.includes(targetPath)) {
      saveWorkspaces(workspacePaths.filter((p) => p !== targetPath))
    }

    return { success: true, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function movePath(sourcePath: string, targetDirPath: string): PathOpResult {
  try {
    const sourceParent = path.dirname(sourcePath)
    if (sourcePath === targetDirPath || sourceParent === targetDirPath) {
      return { success: true, newPath: sourcePath, trees: getWorkspaceTrees() }
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

    // Keep workspace roots in sync if a root folder was moved
    const workspacePaths = loadWorkspaces()
    const idx = workspacePaths.indexOf(sourcePath)
    if (idx !== -1) {
      workspacePaths[idx] = newPath
      saveWorkspaces(workspacePaths)
    }

    return { success: true, newPath, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
