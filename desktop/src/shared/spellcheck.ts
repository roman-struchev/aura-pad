// Offline spell checking: which dictionaries exist, and where they come from.
//
// Hunspell dictionaries (an .aff rule file plus a .dic word list) from
// wooorm/dictionaries, pinned to one commit so what gets downloaded is exactly
// what was reviewed. They are data, not code: nothing from them is executed -
// see src/renderer/src/lib/spell/hunspell.ts for the checker that reads them.
//
// English and Russian only, deliberately. The checker implements affixes but
// not compounding, which German and the Nordic languages lean on heavily; a
// dictionary that would flag half of a normal sentence is worse than no
// dictionary. These two are also the languages the app's other text features
// (dictation, read-aloud, translation) already speak.

export type SpellLanguage = 'en' | 'ru'

export interface SpellDictionaryInfo {
  id: SpellLanguage
  label: string
  // Rounded download size, shown before the user agrees to it.
  sizeMb: number
}

export const SPELL_DICTIONARIES: SpellDictionaryInfo[] = [
  { id: 'en', label: 'English', sizeMb: 0.6 },
  { id: 'ru', label: 'Русский', sizeMb: 3.5 }
]

export function isSpellLanguage(value: string): value is SpellLanguage {
  return SPELL_DICTIONARIES.some((d) => d.id === value)
}

// The two files a dictionary is made of, as text.
export interface SpellDictionaryFiles {
  success: boolean
  aff?: string
  dic?: string
  error?: string
}
