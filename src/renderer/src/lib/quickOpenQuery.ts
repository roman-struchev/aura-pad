// Quick Open's query grammar. Two suffixes on top of the plain filename
// search, both borrowed from IDEA's Go to File:
//
//   :42          jump to line 42 of the file that is already open
//   #render      jump to a symbol in it (see lib/symbols.ts)
//   App.tsx:42   open that file at that line
//   App.tsx#run  open that file at that symbol
//
// Kept out of the component so the parsing rules are readable on their own -
// they are the whole reason a plain `includes` filter isn't enough any more.

export type QuickOpenLocator =
  // `line` is null for a bare ":" with nothing typed after it yet.
  { kind: 'line'; line: number | null } | { kind: 'symbol'; text: string }

export interface ParsedQuickOpen {
  // The filename part; empty means "the file that is already open".
  file: string
  locator: QuickOpenLocator | null
}

export function parseQuickOpen(query: string): ParsedQuickOpen {
  const hash = query.indexOf('#')
  if (hash !== -1) {
    return { file: query.slice(0, hash), locator: { kind: 'symbol', text: query.slice(hash + 1) } }
  }
  const colon = query.lastIndexOf(':')
  if (colon !== -1) {
    const rest = query.slice(colon + 1)
    // Only digits count, so a file whose name happens to contain a colon
    // still searches as a filename.
    if (/^\d*$/.test(rest)) {
      return {
        file: query.slice(0, colon),
        locator: { kind: 'line', line: rest === '' ? null : Number(rest) }
      }
    }
  }
  return { file: query, locator: null }
}
