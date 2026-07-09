export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  isRoot?: boolean
}
