import type { TranslateModel, TranslatePair } from '../../../../shared/settings'
import { TRANSLATE_MODEL_LABELS, TRANSLATE_PAIR_LABELS } from '../../../../shared/settings'
import type { LangCode } from '../langDetect'

// Two translation model families:
//  - NLLB-200-distilled-600M: one multilingual model for every pair, clearly
//    better output, ~850 MB (q8, CPU) / ~1.2 GB (q4f16, WebGPU), slower.
//  - Opus-MT (Marian): one small model per direction (~105 MB each, so a
//    pair is two downloads), fast even on CPU, rougher output.
// Sizes are real quantized encoder+decoder totals from huggingface.co.

export interface TranslatePairInfo {
  id: TranslatePair
  // Canonical sides of the pair; 'ab' translates a->b. Which direction a
  // given selection takes is decided by language detection, falling back
  // to a->b when the text matches neither side.
  a: LangCode
  b: LangCode
  label: string
  // Opus-MT repos for this pair (NLLB needs none - it's one model).
  opusRepoAB: string
  opusRepoBA: string
}

export const TRANSLATE_CATALOG: Record<TranslatePair, TranslatePairInfo> = {
  'en-ru': {
    id: 'en-ru',
    a: 'en',
    b: 'ru',
    label: TRANSLATE_PAIR_LABELS['en-ru'],
    opusRepoAB: 'Xenova/opus-mt-en-ru',
    opusRepoBA: 'Xenova/opus-mt-ru-en'
  },
  'en-de': {
    id: 'en-de',
    a: 'en',
    b: 'de',
    label: TRANSLATE_PAIR_LABELS['en-de'],
    opusRepoAB: 'Xenova/opus-mt-en-de',
    opusRepoBA: 'Xenova/opus-mt-de-en'
  },
  'en-fr': {
    id: 'en-fr',
    a: 'en',
    b: 'fr',
    label: TRANSLATE_PAIR_LABELS['en-fr'],
    opusRepoAB: 'Xenova/opus-mt-en-fr',
    opusRepoBA: 'Xenova/opus-mt-fr-en'
  },
  'en-es': {
    id: 'en-es',
    a: 'en',
    b: 'es',
    label: TRANSLATE_PAIR_LABELS['en-es'],
    opusRepoAB: 'Xenova/opus-mt-en-es',
    opusRepoBA: 'Xenova/opus-mt-es-en'
  }
}

export const NLLB_REPO = 'Xenova/nllb-200-distilled-600M'

// FLORES-200 language tokens NLLB expects as src_lang/tgt_lang.
export const NLLB_LANG_TOKENS: Record<LangCode, string> = {
  en: 'eng_Latn',
  ru: 'rus_Cyrl',
  de: 'deu_Latn',
  fr: 'fra_Latn',
  es: 'spa_Latn'
}

export interface TranslateModelInfo {
  id: TranslateModel
  label: string
  quality: string
  // (model, pair) -> what the consent dialog shows as the download size.
  approxDownload: (pair: TranslatePair) => string
}

export const TRANSLATE_MODEL_CATALOG: Record<TranslateModel, TranslateModelInfo> = {
  'nllb-600m': {
    id: 'nllb-600m',
    label: TRANSLATE_MODEL_LABELS['nllb-600m'],
    quality: 'Best quality, one download covers all pairs',
    approxDownload: () => '~850 MB'
  },
  'opus-mt': {
    id: 'opus-mt',
    label: TRANSLATE_MODEL_LABELS['opus-mt'],
    quality: 'Fast and light, rougher output, per-pair download',
    approxDownload: () => '~210 MB per pair'
  }
}

// The unit of downloading/deleting: NLLB is one unit for all pairs, Opus-MT
// is one unit per pair. The '-q8' suffix retires markers set by the brief
// q4f16/WebGPU build - those weights are different files, so trusting the
// old marker would silently re-download ~850 MB with no progress dialog.
export const downloadKey = (model: TranslateModel, pair: TranslatePair): string =>
  model === 'nllb-600m' ? 'nllb-600m-q8' : `opus-mt:${pair}`

const repos = (model: TranslateModel, pair: TranslatePair): string[] => {
  if (model === 'nllb-600m') return [NLLB_REPO]
  const info = TRANSLATE_CATALOG[pair]
  return [info.opusRepoAB, info.opusRepoBA]
}

// Which units have been fully downloaded on this machine (the actual bytes
// live in the browser Cache API, keyed by Hugging Face URL - this is just the
// "download finished successfully" marker that gates the consent dialog).
const DOWNLOADED_KEY = 'aurapad-translate-models-downloaded'

export function isDownloaded(model: TranslateModel, pair: TranslatePair): boolean {
  try {
    return (JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]') as string[]).includes(
      downloadKey(model, pair)
    )
  } catch {
    return false
  }
}

export function markDownloaded(model: TranslateModel, pair: TranslatePair): void {
  const list = (() => {
    try {
      return JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })()
  const key = downloadKey(model, pair)
  if (!list.includes(key)) localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...list, key]))
  // The short-lived WebGPU build downloaded q4f16 weights (~1.2 GB) that
  // nothing loads anymore; drop them silently once the q8 download is in.
  if (model === 'nllb-600m') {
    caches
      .open('transformers-cache')
      .then(async (cache) => {
        for (const request of await cache.keys()) {
          if (request.url.includes(NLLB_REPO) && request.url.includes('q4f16'))
            await cache.delete(request)
        }
      })
      .catch(() => {})
  }
}

// Frees the disk space: drops every cached file of the unit's repo(s) from
// the transformers.js browser cache (entries are keyed by their Hugging Face
// URL), plus the "downloaded" marker - the consent dialog will ask again.
export async function deleteDownload(model: TranslateModel, pair: TranslatePair): Promise<void> {
  const unitRepos = repos(model, pair)
  try {
    const cache = await caches.open('transformers-cache')
    for (const request of await cache.keys()) {
      if (unitRepos.some((repo) => request.url.includes(repo))) await cache.delete(request)
    }
  } catch {
    // Cache API unavailable - still remove the marker below.
  }
  try {
    const key = downloadKey(model, pair)
    const list = JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]') as string[]
    localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(list.filter((k) => k !== key)))
  } catch {
    localStorage.removeItem(DOWNLOADED_KEY)
  }
}
