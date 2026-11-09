export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  isRoot?: boolean
  // A root listed under "Recently Opened (Outside)" rather than a workspace:
  // browsable and editable, but not a project (no search, git, removal).
  isOutside?: boolean
}
