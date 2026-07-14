export interface SearchResult {
  file: string
  path: string
  line: number
  // 1-based column of the first match in the (untrimmed) line, plus the
  // match's length - lets the editor select exactly what was searched for.
  col: number
  matchLen: number
  content: string
}
