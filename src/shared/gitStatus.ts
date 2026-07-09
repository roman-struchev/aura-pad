export type GitFileState = 'staged' | 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileEntry {
  path: string
  relPath: string
  state: GitFileState
}

export interface GitRepoStatus {
  root: string
  branch: string
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
}
