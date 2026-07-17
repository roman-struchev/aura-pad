// The app's own lightweight language identification - counting characters
// and frequent words, no models. Used by read-aloud to pick a voice per
// chunk and by translation to decide which direction of the selected pair
// a piece of text should go.

export type LangCode = 'en' | 'ru' | 'de' | 'fr' | 'es'

const countMatches = (text: string, re: RegExp): number => (text.match(re) ?? []).length

// Read-aloud's original heuristic, kept bit-for-bit: Cyrillic majority means
// Russian, everything else (ties and no letters included) reads as English.
export const detectReadLang = (text: string): 'ru' | 'en' => {
  const cyrillic = countMatches(text, /[а-яё]/gi)
  const latin = countMatches(text, /[a-z]/gi)
  return cyrillic > latin ? 'ru' : 'en'
}

// ASCII-only stopwords (\b doesn't work around non-ASCII letters in JS
// regexes); each Latin language's accented letters are counted separately
// and weigh more, since a single "ß" or "¿" says more than one "die".
const STOPWORDS: Record<Exclude<LangCode, 'ru'>, string[]> = {
  en: ['the', 'and', 'is', 'of', 'to', 'in', 'that', 'it', 'for', 'with', 'are', 'was', 'you'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'auf', 'ich', 'sie'],
  fr: ['le', 'la', 'les', 'et', 'est', 'une', 'des', 'que', 'pour', 'dans', 'qui', 'pas', 'vous'],
  es: ['el', 'los', 'las', 'es', 'una', 'que', 'por', 'para', 'con', 'no', 'se', 'su', 'usted']
}
const DIACRITICS: Partial<Record<LangCode, RegExp>> = {
  de: /[äöüß]/gi,
  fr: /[àâçéèêëîïôùûœ]/gi,
  es: /[ñáéíóú¿¡]/gi
}

const latinScore = (text: string, lower: string, lang: Exclude<LangCode, 'ru'>): number => {
  let score = 0
  for (const word of STOPWORDS[lang]) {
    score += countMatches(lower, new RegExp(`\\b${word}\\b`, 'g'))
  }
  const diacritics = DIACRITICS[lang]
  if (diacritics) score += countMatches(text, diacritics) * 2
  return score
}

// Which of the two candidate languages the text is written in, or null when
// it can't tell (no letters, a tie, or text matching neither) - the caller
// falls back to its default direction then.
export function detectLanguage(text: string, candidates: [LangCode, LangCode]): LangCode | null {
  const [a, b] = candidates
  // A Cyrillic language against a Latin one: scripts decide.
  if (a === 'ru' || b === 'ru') {
    const cyrillic = countMatches(text, /[а-яё]/gi)
    const latin = countMatches(text, /[a-z]/gi)
    if (cyrillic === latin) return null
    const other = a === 'ru' ? b : a
    return cyrillic > latin ? 'ru' : other
  }
  // Both Latin: frequent-word (plus accented-letter) scoring.
  const lower = text.toLowerCase()
  const scoreA = latinScore(text, lower, a)
  const scoreB = latinScore(text, lower, b)
  if (scoreA === scoreB) return null
  return scoreA > scoreB ? a : b
}
