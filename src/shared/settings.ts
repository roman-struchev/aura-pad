export type UiMode = 'micro' | 'compact' | 'normal' | 'large'
export type SidebarPosition = 'left' | 'right'
// 'dark'/'light' are the app's original two looks; 'system' follows the OS
// between those two. 'monokai'/'solarized' are full app-wide themes (chrome
// CSS variables in main.css *and* the Monaco editor color scheme) - not tied
// to the OS, they look the same regardless of it.
export type ThemeMode = 'dark' | 'light' | 'system' | 'monokai' | 'solarized'
// What `theme` above actually resolves to once 'system' is settled one way
// or the other - this is what CSS `[data-theme]` and the Monaco theme picker
// key off of.
export type ResolvedTheme = 'dark' | 'light' | 'monokai' | 'solarized'

// Whisper model used for voice dictation. Only a key here - download sizes,
// Hugging Face repo names and ONNX dtype choices live in the renderer's
// voice model catalog (lib/voice/models.ts); nothing in main needs them.
export type VoiceModel = 'tiny' | 'base' | 'small' | 'turbo'

// Dictation language. 'auto' runs the app's own detection pass first
// (transformers.js has no built-in auto-detect - an unset language silently
// falls back to English - but Whisper itself predicts the language as its
// first decoded token, which is what the worker reads out). The rest are the
// full lowercase names Whisper's tokenizer accepts, for pinning a language
// explicitly.
export type VoiceLanguage =
  | 'auto'
  | 'english'
  | 'russian'
  | 'ukrainian'
  | 'german'
  | 'french'
  | 'spanish'
  | 'italian'
  | 'portuguese'
  | 'polish'
  | 'turkish'
  | 'chinese'
  | 'japanese'
  | 'korean'

// Translation language pair: which way a given selection gets translated is
// auto-detected from its language, the pair defines the two candidates.
// Like VoiceModel, only the keys and display labels live here - Hugging Face
// repos, download sizes and dtype choices are in the renderer's catalog
// (lib/translate/models.ts); nothing in main needs them.
export type TranslatePair = 'en-ru' | 'en-de' | 'en-fr' | 'en-es'
export const TRANSLATE_PAIRS: TranslatePair[] = ['en-ru', 'en-de', 'en-fr', 'en-es']
export const TRANSLATE_PAIR_LABELS: Record<TranslatePair, string> = {
  'en-ru': 'English ↔ Russian',
  'en-de': 'English ↔ German',
  'en-fr': 'English ↔ French',
  'en-es': 'English ↔ Spanish'
}
// The translation engine: NLLB-200 is one multilingual model covering every
// pair (better quality, bigger and slower); Opus-MT is a small fast model
// per direction, downloaded per pair. 'google-web' is the online alternative:
// no download, best quality, but the selected text is sent to Google (the
// unofficial keyless web endpoint, proxied through the main process).
export type TranslateModel = 'nllb-600m' | 'opus-mt' | 'google-web'
// Dialog display order: the online engine first, then the local models.
export const TRANSLATE_MODELS: TranslateModel[] = ['google-web', 'nllb-600m', 'opus-mt']
export const TRANSLATE_MODEL_LABELS: Record<TranslateModel, string> = {
  'nllb-600m': 'NLLB-200 (600M)',
  'opus-mt': 'Opus-MT',
  'google-web': 'Google Translate (online)'
}

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large']
export const SIDEBAR_POSITIONS: SidebarPosition[] = ['left', 'right']
export const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system', 'monokai', 'solarized']
export const VOICE_MODELS: VoiceModel[] = ['tiny', 'base', 'small', 'turbo']
// Read-aloud voices, one per language: either a Piper neural voice (the
// mapping to full Piper ids lives in useReadAloud's catalog) or 'system' -
// the OS's built-in synthesis, which needs no download. To add a language:
// add a field here, an entry in READ_LANGS and READ_VOICE_KEYS, and a
// matching catalog + display label in the renderer (useReadAloud.ts's
// VOICE_CATALOG, ReadAloudModal.tsx's LANG_TITLES).
export interface ReadVoiceKeysByLang {
  ru: 'ruslan' | 'irina' | 'dmitri' | 'denis' | 'system'
  en: 'ryan' | 'hfc_female' | 'hfc_male' | 'lessac' | 'system'
}
export type ReadLang = keyof ReadVoiceKeysByLang
export type ReadVoices = { [L in ReadLang]: ReadVoiceKeysByLang[L] }
export const READ_LANGS: ReadLang[] = ['en', 'ru']
export const READ_VOICE_KEYS: { [L in ReadLang]: ReadVoiceKeysByLang[L][] } = {
  ru: ['ruslan', 'irina', 'dmitri', 'denis', 'system'],
  en: ['ryan', 'hfc_female', 'hfc_male', 'lessac', 'system']
}

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  'auto',
  'english',
  'russian',
  'ukrainian',
  'german',
  'french',
  'spanish',
  'italian',
  'portuguese',
  'polish',
  'turkish',
  'chinese',
  'japanese',
  'korean'
]

export interface AppSettings {
  theme: ThemeMode
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: UiMode
  gitEnabled: boolean
  diagnosticsEnabled: boolean
  sidebarPosition: SidebarPosition
  sidebarWidth: number
  lineNumbersEnabled: boolean
  voiceModel: VoiceModel
  voiceLanguage: VoiceLanguage
  readVoices: ReadVoices
  translatePair: TranslatePair
  translateModel: TranslateModel
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  tabsEnabled: true,
  autosaveEnabled: true,
  uiMode: 'compact',
  gitEnabled: true,
  diagnosticsEnabled: true,
  sidebarPosition: 'left',
  sidebarWidth: 256,
  lineNumbersEnabled: true,
  voiceModel: 'base',
  voiceLanguage: 'auto',
  readVoices: { ru: 'ruslan', en: 'ryan' },
  translatePair: 'en-ru',
  translateModel: 'nllb-600m'
}
