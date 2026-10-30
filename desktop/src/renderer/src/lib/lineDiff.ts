// Line-level diff between a file's committed text and the live buffer, for the
// editor's change markers (the coloured bars beside the line numbers).
//
// Myers' O(ND) algorithm over the part that differs once the common head and
// tail are trimmed off - for a typical edit that middle is a few lines, so
// this runs on every keystroke without anyone noticing. A buffer rewritten
// past MAX_EDITS (a reformat, a paste over everything) falls back to one
// "modified" hunk across the changed middle rather than spending seconds on
// an exact answer nobody needs from a gutter bar.

export type HunkKind = 'added' | 'modified' | 'deleted'

export interface DiffHunk {
  kind: HunkKind
  // 1-based line range in the *current* text, inclusive. For a deletion both
  // are the line the removed block sat above (0 when it was at the very top,
  // shown on line 1).
  startLine: number
  endLine: number
  // What the committed text had here - shown when the hunk is expanded, and
  // what Revert puts back. Empty for a pure addition.
  oldLines: string[]
}

const MAX_EDITS = 1000

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

// Edit script as a list of [aIndex, bIndex] pairs of matched lines (both
// 0-based, ascending), or null when the distance exceeds MAX_EDITS.
function matchLines(a: string[], b: string[]): Array<[number, number]> | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
    if (found) break
  }
  if (!found) return null

  // Walk the saved frontiers back from (n, m) to collect the diagonals.
  const pairs: Array<[number, number]> = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1
    const prevX = vd[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      pairs.push([x, y])
    }
    if (d > 0) {
      x = prevX
      y = prevY
    }
  }
  return pairs.reverse()
}

export function diffLines(oldLines: string[], newLines: string[]): DiffHunk[] {
  let head = 0
  const minLen = Math.min(oldLines.length, newLines.length)
  while (head < minLen && oldLines[head] === newLines[head]) head++
  let tail = 0
  while (
    tail < minLen - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  )
    tail++

  const a = oldLines.slice(head, oldLines.length - tail)
  const b = newLines.slice(head, newLines.length - tail)
  if (a.length === 0 && b.length === 0) return []

  const pairs = matchLines(a, b) ?? []
  // Sentinel so the gap after the last matched pair is flushed too.
  pairs.push([a.length, b.length])

  const hunks: DiffHunk[] = []
  let ai = 0
  let bi = 0
  for (const [pa, pb] of pairs) {
    if (pa > ai || pb > bi) {
      const removed = oldLines.slice(head + ai, head + pa)
      const addedCount = pb - bi
      // Current-text line numbers, 1-based.
      const start = head + bi + 1
      if (addedCount === 0) {
        hunks.push({ kind: 'deleted', startLine: start - 1, endLine: start - 1, oldLines: removed })
      } else {
        hunks.push({
          kind: removed.length === 0 ? 'added' : 'modified',
          startLine: start,
          endLine: start + addedCount - 1,
          oldLines: removed
        })
      }
    }
    ai = pa + 1
    bi = pb + 1
  }
  return hunks
}
