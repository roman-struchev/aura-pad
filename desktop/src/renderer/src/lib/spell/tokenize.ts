// Which parts of a document are prose, and which words in it are worth
// checking.
//
// A spell checker that underlines `useState`, `README.md` and every URL is
// one people turn off within a minute, so the text is masked before it is
// tokenized: fenced and inline code, link targets, URLs, emails and paths
// drop out, and what's left is the sentences someone actually wrote.
//
// Masking replaces the skipped ranges with spaces rather than removing them,
// so every offset the checker reports still points at the right place in the
// original document.

export interface SpellToken {
  word: string
  offset: number
}

// Runs of text that are not prose, in the order they must be masked.
const MASKS: RegExp[] = [
  // Fenced code blocks, including an unterminated one at the end of a file.
  /```[\s\S]*?(?:```|$)/g,
  /~~~[\s\S]*?(?:~~~|$)/g,
  // Indented code blocks (four spaces at the start of a line).
  /^(?: {4}|\t).*$/gm,
  // Inline code.
  /`[^`\n]*`/g,
  // Markdown link and image targets: the label stays, the URL goes.
  /\]\([^)\s]*/g,
  // Reference-style link definitions and bare URLs.
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi,
  /\b(?:www\.)\S*/gi,
  // Emails.
  /\S+@\S+\.\S+/g,
  // Anything that looks like a path or a file name.
  /\S*\/\S*/g,
  /\b[\w-]+\.(?:[a-z]{1,5})\b/gi,
  // HTML/JSX tags and entities.
  /<\/?[a-zA-Z][^>\n]*>/g,
  /&[a-z]+;/gi
]

export function maskNonProse(text: string): string {
  let masked = text
  for (const pattern of MASKS) {
    masked = masked.replace(pattern, (match) => ' '.repeat(match.length))
  }
  return masked
}

// A word is letters, plus the marks and apostrophes that live inside them
// ("don't", "по-моему" is two words - the hyphen splits, which is what the
// dictionaries expect).
const WORD = /[\p{L}\p{M}][\p{L}\p{M}'’]*/gu

export function tokenize(text: string): SpellToken[] {
  const masked = maskNonProse(text)
  const tokens: SpellToken[] = []
  for (const match of masked.matchAll(WORD)) {
    const word = match[0].replace(/['’]+$/, '')
    // Single letters are never typos worth reporting, and a word glued to a
    // digit (`utf8`, `h2`) is an identifier, not prose.
    if (word.length < 2) continue
    const offset = match.index ?? 0
    const before = masked[offset - 1]
    const after = masked[offset + match[0].length]
    if (before === '_' || after === '_' || /\d/.test(after ?? '') || /\d/.test(before ?? '')) {
      continue
    }
    // camelCase and PascalCase runs are code that escaped the masks.
    if (/\p{Ll}\p{Lu}/u.test(word)) continue
    tokens.push({ word, offset })
  }
  return tokens
}
