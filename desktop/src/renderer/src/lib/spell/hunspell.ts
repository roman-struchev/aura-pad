// A Hunspell reader: enough of the format to tell a word from a typo, and
// nothing more.
//
// Hunspell dictionaries are two files. The .dic is a list of stems, each with
// the flags of the affix rules it accepts (`walk/DGS`). The .aff declares
// those rules: `SFX D 0 ed .` means "with flag D, add 'ed'". So "walked" is
// not in any list - it is a stem plus a rule, which is exactly why a Russian
// dictionary fits in 3 MB instead of 300.
//
// Checking therefore runs the rules *backwards*: strip an ending the .aff
// knows about, and see whether what's left is a stem that allows that rule.
// Compounding (German's, mostly) is deliberately not implemented - see
// src/shared/spellcheck.ts for why the catalog is English and Russian.
//
// Nothing here executes anything from the dictionary files; the affix
// conditions are the only part turned into a regular expression, and they are
// character classes by definition of the format.

export interface Dictionary {
  check: (word: string) => boolean
  suggest: (word: string) => string[]
  stems: number
}

interface AffixRule {
  // What the rule removes from the stem, and what it puts there instead.
  strip: string
  add: string
  // The stem must match this (end of stem for a suffix, start for a prefix).
  condition: RegExp | null
  // Flags carried by the affix itself: a suffix may permit further affixes.
  flags: string[]
}

interface AffixGroup {
  flag: string
  // "Y" in the header: this affix may be combined with one from the other side.
  cross: boolean
  rules: AffixRule[]
}

interface Aff {
  prefixes: AffixGroup[]
  suffixes: AffixGroup[]
  // Rules indexed by the last (suffix) or first (prefix) character they add,
  // so checking a word touches a handful of rules instead of all of them.
  suffixByChar: Map<string, { group: AffixGroup; rule: AffixRule }[]>
  prefixByChar: Map<string, { group: AffixGroup; rule: AffixRule }[]>
  emptySuffix: { group: AffixGroup; rule: AffixRule }[]
  emptyPrefix: { group: AffixGroup; rule: AffixRule }[]
  iconv: [string, string][]
  try: string
  needAffix: string | null
  onlyInCompound: string | null
  forbidden: string | null
  flagMode: 'single' | 'long' | 'num'
}

const EMPTY_AFF: Omit<Aff, 'flagMode'> = {
  prefixes: [],
  suffixes: [],
  suffixByChar: new Map(),
  prefixByChar: new Map(),
  emptySuffix: [],
  emptyPrefix: [],
  iconv: [],
  try: '',
  needAffix: null,
  onlyInCompound: null,
  forbidden: null
}

function parseFlags(raw: string, mode: Aff['flagMode']): string[] {
  if (!raw) return []
  if (mode === 'num') return raw.split(',').map((f) => f.trim())
  if (mode === 'long') return raw.match(/../g) ?? []
  // Default and UTF-8: one flag per character (code point, so a flag outside
  // the BMP isn't split in half).
  return [...raw]
}

// `0` means "nothing" in this format, both for what a rule strips and for
// what it adds.
function affixPart(value: string): string {
  return value === '0' ? '' : value
}

function conditionRegex(condition: string, kind: 'PFX' | 'SFX'): RegExp | null {
  if (!condition || condition === '.') return null
  try {
    return new RegExp(kind === 'SFX' ? `${condition}$` : `^${condition}`, 'u')
  } catch {
    // A condition we can't compile means "always" rather than "never": a rule
    // that silently stops matching turns correct words into typos.
    return null
  }
}

function parseAff(text: string): Aff {
  const aff: Aff = { ...EMPTY_AFF, flagMode: 'single' }
  const lines = text.split('\n')

  // The flag mode has to be known before any flag is read, and FLAG may sit
  // below the first affix block in a hand-edited file.
  for (const line of lines) {
    const match = /^FLAG\s+(\S+)/.exec(line)
    if (!match) continue
    if (match[1] === 'long') aff.flagMode = 'long'
    else if (match[1] === 'num') aff.flagMode = 'num'
    break
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('#')) continue
    const parts = line.trim().split(/\s+/)
    const [keyword] = parts

    if (keyword === 'TRY') aff.try = parts[1] ?? ''
    else if (keyword === 'NEEDAFFIX' || keyword === 'PSEUDOROOT') aff.needAffix = parts[1] ?? null
    else if (keyword === 'ONLYINCOMPOUND') aff.onlyInCompound = parts[1] ?? null
    else if (keyword === 'FORBIDDENWORD') aff.forbidden = parts[1] ?? null
    else if (keyword === 'ICONV' && parts.length === 3) aff.iconv.push([parts[1], parts[2]])
    else if (keyword === 'PFX' || keyword === 'SFX') {
      // Header line: `SFX <flag> <cross> <count>`; the rules follow it.
      if (parts.length < 4) continue
      const count = Number(parts[3])
      if (!Number.isFinite(count)) continue
      const group: AffixGroup = { flag: parts[1], cross: parts[2] === 'Y', rules: [] }
      for (let r = 0; r < count && i + 1 < lines.length; r++) {
        const ruleParts = lines[++i].trim().split(/\s+/)
        if (ruleParts[0] !== keyword || ruleParts[1] !== group.flag) {
          // A miscounted header - step back so the line is read as itself.
          i--
          break
        }
        const strip = affixPart(ruleParts[2] ?? '0')
        // The added part may carry its own flags: `ed/X`.
        const [addRaw, addFlags] = (ruleParts[3] ?? '0').split('/')
        group.rules.push({
          strip,
          add: affixPart(addRaw),
          condition: conditionRegex(ruleParts[4] ?? '.', keyword),
          flags: parseFlags(addFlags ?? '', aff.flagMode)
        })
      }
      if (keyword === 'PFX') aff.prefixes.push(group)
      else aff.suffixes.push(group)
    }
  }

  const index = (
    groups: AffixGroup[],
    byChar: Map<string, { group: AffixGroup; rule: AffixRule }[]>,
    empty: { group: AffixGroup; rule: AffixRule }[],
    charOf: (add: string) => string
  ): void => {
    for (const group of groups) {
      for (const rule of group.rules) {
        if (rule.add === '') {
          empty.push({ group, rule })
          continue
        }
        const key = charOf(rule.add)
        const list = byChar.get(key)
        if (list) list.push({ group, rule })
        else byChar.set(key, [{ group, rule }])
      }
    }
  }
  index(aff.suffixes, aff.suffixByChar, aff.emptySuffix, (add) => add[add.length - 1])
  index(aff.prefixes, aff.prefixByChar, aff.emptyPrefix, (add) => add[0])

  return aff
}

function parseDic(text: string, flagMode: Aff['flagMode']): Map<string, string[]> {
  const stems = new Map<string, string[]>()
  const lines = text.split('\n')
  // The first line is the entry count, which nothing here needs.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('\t')) continue
    // Morphological fields (`po:noun`) follow the word, separated by
    // whitespace; only the first field is the word itself.
    const entry = line.split(/\s+/)[0]
    if (!entry) continue
    // A backslash escapes a slash inside the word; the unescaped one splits
    // the word from its flags.
    let word = entry
    let flags: string[] = []
    for (let c = 0; c < entry.length; c++) {
      if (entry[c] === '\\') {
        c++
        continue
      }
      if (entry[c] === '/') {
        word = entry.slice(0, c)
        flags = parseFlags(entry.slice(c + 1), flagMode)
        break
      }
    }
    word = word.replace(/\\/g, '')
    if (word === '') continue
    const existing = stems.get(word)
    if (existing) existing.push(...flags)
    else stems.set(word, flags)
  }
  return stems
}

const isUpper = (word: string): boolean => word === word.toUpperCase()
const title = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

export function buildDictionary(affText: string, dicText: string): Dictionary {
  const aff = parseAff(affText)
  const stems = parseDic(dicText, aff.flagMode)

  const flagsOf = (word: string): string[] | undefined => stems.get(word)

  const forbidden = (flags: string[]): boolean =>
    aff.forbidden !== null && flags.includes(aff.forbidden)

  // A stem that stands on its own: not forbidden, and not one of the entries
  // the dictionary marks as needing an affix before it counts as a word.
  const isStandaloneStem = (word: string): boolean => {
    const flags = flagsOf(word)
    if (!flags || forbidden(flags)) return false
    if (aff.needAffix !== null && flags.includes(aff.needAffix)) return false
    if (aff.onlyInCompound !== null && flags.includes(aff.onlyInCompound)) return false
    return true
  }

  // Does `stem` exist and allow this affix flag?
  const stemAllows = (stem: string, flag: string, extra?: string[]): boolean => {
    const flags = flagsOf(stem)
    if (!flags || forbidden(flags)) return false
    if (flags.includes(flag)) return true
    // A suffix can carry the flag that permits the prefix (the "two-fold
    // affix" case), which is why the caller may pass extra flags.
    return !!extra?.includes(flag)
  }

  const suffixCandidates = (word: string): { group: AffixGroup; rule: AffixRule }[] => [
    ...(aff.suffixByChar.get(word[word.length - 1]) ?? []),
    ...aff.emptySuffix
  ]
  const prefixCandidates = (word: string): { group: AffixGroup; rule: AffixRule }[] => [
    ...(aff.prefixByChar.get(word[0]) ?? []),
    ...aff.emptyPrefix
  ]

  // Undo one prefix, then look the remainder up as a stem (optionally also
  // allowing a suffix flag that the suffix rule carried).
  const checkPrefixed = (word: string, extraFlags?: string[]): boolean => {
    for (const { group, rule } of prefixCandidates(word)) {
      if (!word.startsWith(rule.add)) continue
      const stem = rule.strip + word.slice(rule.add.length)
      if (stem === '' || stem === word) continue
      if (rule.condition && !rule.condition.test(stem)) continue
      if (stemAllows(stem, group.flag, extraFlags)) return true
    }
    return false
  }

  const checkAffixed = (word: string): boolean => {
    if (checkPrefixed(word)) return true

    for (const { group, rule } of suffixCandidates(word)) {
      if (rule.add !== '' && !word.endsWith(rule.add)) continue
      const stem = word.slice(0, word.length - rule.add.length) + rule.strip
      if (stem === '') continue
      if (rule.condition && !rule.condition.test(stem)) continue
      if (stemAllows(stem, group.flag)) return true
      // Prefix and suffix together, if this rule allows being combined.
      if (group.cross && checkPrefixed(stem, [group.flag, ...rule.flags])) return true
    }
    return false
  }

  const known = (word: string): boolean => isStandaloneStem(word) || checkAffixed(word)

  // Case handling, the way Hunspell does it: a lowercase stem also covers the
  // capitalized and all-caps spellings of the same word, but not the other
  // way round - "london" is still wrong when the dictionary says "London".
  const knownWithCase = (word: string): boolean => {
    if (known(word)) return true
    if (isUpper(word) && word !== word.toLowerCase()) {
      return known(title(word)) || known(word.toLowerCase())
    }
    const lower = word.toLowerCase()
    if (word !== lower && word === title(word)) return known(lower)
    return false
  }

  const applyIconv = (word: string): string => {
    let out = word
    for (const [from, to] of aff.iconv) out = out.split(from).join(to)
    return out
  }

  const check = (word: string): boolean => knownWithCase(applyIconv(word))

  // Edit-distance-one candidates, filtered through the checker. Cheap, and it
  // covers what typing mistakes actually are: a missed key, a doubled one, a
  // neighbour, two swapped. Anything cleverer wants a frequency list, which
  // these dictionaries don't carry.
  const suggest = (word: string): string[] => {
    const input = applyIconv(word)
    const lower = input.toLowerCase()
    const alphabet = [...new Set([...aff.try.toLowerCase()])].filter((c) => /\p{L}/u.test(c))
    const seen = new Set<string>()
    const out: string[] = []
    const offer = (candidate: string): void => {
      if (candidate === input || candidate === '' || seen.has(candidate)) return
      seen.add(candidate)
      if (out.length < 8 && check(candidate)) out.push(candidate)
    }

    // A word that is only spelled with the wrong case.
    offer(title(lower))
    offer(lower)

    for (let i = 0; i < lower.length; i++) {
      offer(lower.slice(0, i) + lower.slice(i + 1))
      if (i + 1 < lower.length) {
        offer(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2))
      }
      for (const letter of alphabet) {
        offer(lower.slice(0, i) + letter + lower.slice(i))
        offer(lower.slice(0, i) + letter + lower.slice(i + 1))
      }
      // Two words run together.
      if (i > 0 && check(lower.slice(0, i)) && check(lower.slice(i))) {
        offer(`${lower.slice(0, i)} ${lower.slice(i)}`)
      }
    }
    for (const letter of alphabet) offer(lower + letter)

    // Match the input's capitalization, so correcting a sentence's first word
    // doesn't lowercase it.
    if (input !== lower && input === title(input)) return out.map(title)
    return out
  }

  return { check, suggest, stems: stems.size }
}
