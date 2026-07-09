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
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
}
