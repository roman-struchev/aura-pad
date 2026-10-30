export type PathMatchEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
}

export type PathListingResult = {
  dir: string
  entries: PathMatchEntry[]
}
