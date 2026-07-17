// Sentence-level chunking shared by read-aloud (synthesis units) and
// translation (model calls). Unlike read-aloud's original chunker this keeps
// the separator that followed each chunk, so translation can reassemble the
// output with the source's line structure intact.

export interface TextChunk {
  text: string
  // What followed this chunk in the source: ' ' between sentences on one
  // line, the exact newline run at a line break, '' at the very end.
  sep: string
}

// Split on line breaks, then into sentences within each line, then merge
// space-separated neighbors into chunks of a comfortable size while the
// sameGroup gate allows it (read-aloud passes "same language"). Merging
// never crosses a line break, so a heading or list item is never glued to
// the text after it and separators stay faithful.
export function chunkSentences(
  text: string,
  maxChars: number,
  sameGroup: (a: string, b: string) => boolean = () => true
): TextChunk[] {
  const parts = text.split(/(\n+)/)
  const items: TextChunk[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const sentences = parts[i]
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const lineSep = parts[i + 1] ?? ''
    sentences.forEach((sentence, index) => {
      items.push({ text: sentence, sep: index === sentences.length - 1 ? lineSep : ' ' })
    })
  }
  const chunks: TextChunk[] = []
  for (const item of items) {
    const last = chunks[chunks.length - 1]
    if (
      last &&
      last.sep === ' ' &&
      last.text.length + item.text.length < maxChars &&
      sameGroup(last.text, item.text)
    ) {
      last.text = `${last.text} ${item.text}`
      last.sep = item.sep
    } else {
      chunks.push({ ...item })
    }
  }
  return chunks
}
