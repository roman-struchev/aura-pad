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

// One search's answer. The list is capped (500 matches, 50 per file), so it
// can be shorter than what a Replace All would actually touch:
// `matchCounts` is every match in each listed file, and `truncated` says the
// list stopped early - either a file had more matches than it shows, or the
// walk stopped at the cap and files further on were not searched at all.
export interface SearchResponse {
  results: SearchResult[]
  matchCounts: Record<string, number>
  truncated: boolean
}
