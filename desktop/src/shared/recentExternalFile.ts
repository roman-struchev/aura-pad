export type RecentExternalFile = {
  path: string
  openedAt: number
  // Missing on entries written before folders could be listed: a file.
  // A folder entry (Quick Open, Cmd+Enter on a folder outside every
  // workspace) shows as an expandable tree in the sidebar.
  type?: 'file' | 'directory'
}
