// Subsequence matching with a score, shared by the command palette and Quick
// Open's symbol mode. Deliberately tiny: no library, no index building - the
// lists it ranks are tens of entries long (commands, one file's symbols), so
// a straight scan per keystroke costs nothing and there is no cache to go
// stale as the active file is edited.

export interface FuzzyMatch {
  score: number
  // Positions in the haystack that the query matched, for highlighting.
  indices: number[]
}

const isBoundary = (ch: string): boolean => ch === '' || /[^A-Za-z0-9]/.test(ch)

// Every query character must appear in order; where a character could match
// in several places the first one wins, which is what makes the scan linear.
// Score rewards what a reader recognises as "the obvious match": runs of
// consecutive characters, hits at the start of a word, and a short haystack.
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (query === '') return { score: 0, indices: [] }
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()

  const indices: number[] = []
  let score = 0
  let from = 0
  let previousIndex = -2
  for (const ch of needle) {
    const at = haystack.indexOf(ch, from)
    if (at === -1) return null
    if (at === previousIndex + 1) score += 8
    if (isBoundary(at === 0 ? '' : haystack[at - 1])) score += 6
    // Later matches are worth slightly less, so "set" prefers "Settings"
    // over "Reset Zoom".
    score += Math.max(0, 4 - at / 8)
    indices.push(at)
    previousIndex = at
    from = at + 1
  }
  // A contiguous substring hit is what the user most often means.
  if (haystack.includes(needle)) score += 12
  score -= haystack.length / 40
  return { score, indices }
}

// Rank a list, dropping what doesn't match at all. Ties keep the order the
// caller supplied, so a hand-ordered command list stays hand-ordered. Each
// hit carries its matched positions, so a caller can highlight them.
export interface Ranked<T> {
  item: T
  indices: number[]
}

export function fuzzyRank<T>(items: T[], query: string, textOf: (item: T) => string): Ranked<T>[] {
  const q = query.trim()
  if (q === '') return items.map((item) => ({ item, indices: [] }))
  const hits: { item: T; indices: number[]; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const match = fuzzyMatch(textOf(item), q)
    if (match) hits.push({ item, indices: match.indices, score: match.score, index })
  })
  hits.sort((a, b) => b.score - a.score || a.index - b.index)
  return hits.map(({ item, indices }) => ({ item, indices }))
}
