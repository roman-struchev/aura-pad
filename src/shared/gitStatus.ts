export type GitFileState = 'staged' | 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileEntry {
  path: string
  relPath: string
  state: GitFileState
  // Omitted entirely for binary files or anything else a line count doesn't
  // meaningfully apply to, rather than showing a misleading 0/0.
  added?: number
  removed?: number
}

export interface GitRepoStatus {
  root: string
  branch: string
  ahead: number
  behind: number
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  // Unix seconds
  date: number
  subject: string
  // Decorations from `git log --pretty=%D`, e.g. "HEAD -> main, origin/main".
  // Empty for undecorated commits.
  refs: string
}
