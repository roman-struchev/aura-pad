import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { GitFileEntry, GitFileState, GitRepoStatus } from '../shared/gitStatus'

export function isGitRepo(root: string): boolean {
  return fs.existsSync(path.join(root, '.git'))
}

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

// Push/pull results (and errors, e.g. auth failures) live in stderr as often
// as stdout, and a non-fast-forward pull is a normal outcome the caller wants
// to see the message for - so capture both streams instead of rejecting.
function runGitCombined(
  root: string,
  args: string[]
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      resolve({ success: !error, output })
    })
  })
}

function stateFromCode(code: string): GitFileState {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

function parseBranch(headerLine: string): string {
  const content = headerLine.replace(/^##\s*/, '')
  const noCommitsMatch = content.match(/^No commits yet on (\S+)/)
  if (noCommitsMatch) return noCommitsMatch[1]
  if (content.startsWith('HEAD (no branch)')) return 'detached'
  return content.split('...')[0].split(' ')[0]
}

interface LineStats {
  added: number
  removed: number
}

// `git diff --numstat -z`: each record is `<added>\t<removed>\t<path>`, NUL
// terminated. Binary files report `-` for both counts instead of numbers -
// skipped entirely rather than showing a misleading 0/0. Renames report an
// empty inline path followed by two extra NUL-terminated tokens (old path,
// then new path) instead of one - the new path is what callers key by.
async function getNumstat(root: string, extraArgs: string[]): Promise<Map<string, LineStats>> {
  const map = new Map<string, LineStats>()
  try {
    const stdout = await runGit(root, ['diff', ...extraArgs, '--numstat', '-z'])
    const tokens = stdout.split('\0')
    if (tokens[tokens.length - 1] === '') tokens.pop()

    let i = 0
    while (i < tokens.length) {
      const record = tokens[i]
      i++
      const match = record.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
      if (!match) continue
      const [, addedStr, removedStr, inlinePath] = match

      let relPath = inlinePath
      if (relPath === '') {
        i++ // old path, unused
        relPath = tokens[i] ?? ''
        i++
      }

      if (!relPath || addedStr === '-' || removedStr === '-') continue
      map.set(relPath, { added: parseInt(addedStr, 10), removed: parseInt(removedStr, 10) })
    }
  } catch (e) {}
  return map
}

const MAX_UNTRACKED_STAT_BYTES = 1024 * 1024

// Untracked files aren't part of any diff, so there's no numstat for them -
// approximate with "every line is added" the way most editors' git
// decorations do. Skipped for binary-looking or oversized files.
function countUntrackedLines(absPath: string): number | null {
  try {
    if (fs.statSync(absPath).size > MAX_UNTRACKED_STAT_BYTES) return null
    const buffer = fs.readFileSync(absPath)
    if (buffer.subarray(0, 8000).includes(0)) return null
    if (buffer.length === 0) return 0
    const text = buffer.toString('utf-8')
    const lines = text.split('\n')
    return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  } catch (e) {
    return null
  }
}

export async function getRepoStatus(root: string): Promise<GitRepoStatus | null> {
  if (!isGitRepo(root)) return null
  try {
    // `-z` disables git's default quoting of paths with spaces or non-ASCII
    // bytes (which otherwise come back as e.g. `"my file.md"` or octal-escaped
    // garbage for Unicode names - literal text that isn't a usable path) and
    // NUL-terminates each field instead, so it can be split back out exactly.
    const stdout = await runGit(root, ['status', '--porcelain=v1', '-z', '-b'])
    const tokens = stdout.split('\0').filter((t) => t.length > 0)

    let branch = ''
    let i = 0
    if (tokens[0]?.startsWith('##')) {
      branch = parseBranch(tokens[0])
      i = 1
    }

    const staged: GitFileEntry[] = []
    const unstaged: GitFileEntry[] = []

    while (i < tokens.length) {
      const record = tokens[i]
      i++
      const x = record[0]
      const y = record[1]
      const relPath = record.slice(3)
      const absPath = path.join(root, relPath)

      // Renames/copies carry the original path as a second NUL-terminated
      // token right after this one - not needed here, just skip past it.
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++

      if (x === '?' && y === '?') {
        unstaged.push({ path: absPath, relPath, state: 'untracked' })
        continue
      }
      if (x !== ' ' && x !== '?') {
        staged.push({ path: absPath, relPath, state: stateFromCode(x) })
      }
      if (y !== ' ' && y !== '?') {
        unstaged.push({ path: absPath, relPath, state: stateFromCode(y) })
      }
    }

    const [unstagedStats, stagedStats] = await Promise.all([
      getNumstat(root, []),
      getNumstat(root, ['--cached'])
    ])

    for (const entry of staged) {
      const stats = stagedStats.get(entry.relPath)
      if (stats) Object.assign(entry, stats)
    }
    for (const entry of unstaged) {
      if (entry.state === 'untracked') {
        const added = countUntrackedLines(entry.path)
        if (added !== null) Object.assign(entry, { added, removed: 0 })
      } else {
        const stats = unstagedStats.get(entry.relPath)
        if (stats) Object.assign(entry, stats)
      }
    }

    return { root, branch, staged, unstaged }
  } catch (e) {
    return null
  }
}

export async function getAllRepoStatuses(roots: string[]): Promise<GitRepoStatus[]> {
  const results = await Promise.all(roots.map((r) => getRepoStatus(r)))
  return results.filter((r): r is GitRepoStatus => r !== null)
}

export async function getDiff(
  root: string,
  relPath: string
): Promise<{ original: string; modified: string }> {
  let original = ''
  try {
    original = await runGit(root, ['show', `HEAD:${relPath}`])
  } catch (e) {}

  let modified = ''
  try {
    modified = fs.readFileSync(path.join(root, relPath), 'utf-8')
  } catch (e) {}

  return { original, modified }
}

export async function stagePath(
  root: string,
  relPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await runGit(root, ['add', '--', relPath])
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function unstagePath(
  root: string,
  relPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await runGit(root, ['reset', '--', relPath])
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Resets both the index and working tree for one path back to HEAD, discarding
// staged and unstaged changes alike. Only meaningful for tracked files - the
// caller handles untracked ones (there's nothing to check out) by deleting instead.
export async function discardPath(
  root: string,
  relPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await runGit(root, ['checkout', 'HEAD', '--', relPath])
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function commit(
  root: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await runGit(root, ['commit', '-m', message])
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function push(root: string): Promise<{ success: boolean; output: string }> {
  return runGitCombined(root, ['push'])
}

export function pull(root: string): Promise<{ success: boolean; output: string }> {
  return runGitCombined(root, ['pull'])
}
