// Quick reindent for HTML/XML, the same spirit as the JSON format button:
// a fast, predictable cleanup rather than a full markup-aware formatter.
// Collapses all whitespace between tags, then reindents one tag per line.
export function prettyPrintMarkup(input: string): string {
  const collapsed = input.replace(/>\s*</g, '><').trim()
  const lines = collapsed.replace(/></g, '>\n<').split('\n')

  const INDENT = '  '
  let depth = 0
  const out: string[] = []

  for (const line of lines) {
    const isClosingTag = /^<\//.test(line)
    const isSpecialTag = /^<!--|^<\?|^<!DOCTYPE/i.test(line)
    const isSelfContained = /^<[^>]+\/>$/.test(line) || /^<([a-zA-Z][\w-]*)[^>]*>.*<\/\1>$/.test(line)
    const isOpeningTag = /^<[^/!?]/.test(line) && !isSelfContained

    if (isClosingTag) depth = Math.max(depth - 1, 0)
    out.push(INDENT.repeat(depth) + line)
    if (isOpeningTag && !isSpecialTag) depth++
  }

  return out.join('\n')
}
