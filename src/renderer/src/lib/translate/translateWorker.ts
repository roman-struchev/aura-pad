import { env, pipeline, TextStreamer, type TranslationPipeline } from '@huggingface/transformers'
import { NLLB_LANG_TOKENS, NLLB_REPO, TRANSLATE_CATALOG } from './models'
import type { LangCode } from '../langDetect'
import type { TranslateModel, TranslatePair } from '../../../../shared/settings'

// Runs translation (via transformers.js/onnxruntime) off the UI thread.
// Model weights are fetched from Hugging Face on first use - only ever
// triggered after the user confirms the download in the consent dialog - and
// cached by transformers.js in the browser Cache API, so later sessions load
// fully offline. Text never leaves the machine; only model files are
// downloaded.
//
// Two model families: NLLB-200 (one multilingual model, told the direction
// via FLORES src_lang/tgt_lang tokens) and Opus-MT (one small Marian model
// per direction). Both run wasm/q8 only: measured on Apple Silicon, WebGPU
// with the q8 weights is ~2x *slower* than wasm (int8 dequant doesn't pay
// off on the jsep backend), and the q4f16 build generates empty output.

// transformers.js defaults onnxruntime to pulling its wasm runtime from a
// CDN at load time; point it at the copies the ort-assets plugin (see
// electron.vite.config.ts) ships with the app instead, so translation works
// offline and within the app's CSP. Same asyncify build and same
// variable-held relative path trick as the Whisper worker - see the comment
// there for why.
const ortDistDir = '../ort-dist/'
const ortBase = import.meta.env.DEV
  ? `${self.location.origin}/ort-dist/`
  : new URL(ortDistDir, import.meta.url).href
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`
  }
}

export type TranslateWorkerRequest =
  | { type: 'load'; model: TranslateModel; pair: TranslatePair }
  | {
      type: 'translate'
      id: number
      model: TranslateModel
      pair: TranslatePair
      from: LangCode
      to: LangCode
      chunks: string[]
    }
  | { type: 'cancel' }

export type TranslateWorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; model: TranslateModel; pair: TranslatePair }
  // Streamed text of the chunk currently being translated, in order.
  | { type: 'delta'; id: number; text: string }
  // The current chunk finished - the hook appends its stored separator.
  | { type: 'chunk-done'; id: number }
  // The authoritative per-chunk outputs; they replace the streamed text,
  // which can carry tokenizer whitespace artifacts.
  | { type: 'done'; id: number; finals: string[] }
  | { type: 'error'; context: 'load' | 'translate'; message: string }

const post = (msg: TranslateWorkerResponse): void => self.postMessage(msg)

// What's loaded: NLLB is one pipe for every direction; Opus-MT is a pipe per
// direction of one pair. `key` identifies the unit (mirrors models.ts).
type Loaded =
  | { key: string; kind: 'nllb'; pipe: TranslationPipeline }
  | { key: string; kind: 'opus'; ab: TranslationPipeline; ba: TranslationPipeline }
let current: Loaded | null = null

const unitKey = (model: TranslateModel, pair: TranslatePair): string =>
  model === 'nllb-600m' ? 'nllb-600m' : `opus-mt:${pair}`

// Bumped by 'cancel' (handled outside the queue, so it takes effect
// immediately): requests captured under an older generation stop between
// chunks and drop their output. A mid-chunk inference can't be aborted -
// chunks are one sentence each, so at most a moment of extra work.
let generation = 0

const makePipe = (repo: string): Promise<TranslationPipeline> =>
  pipeline('translation', repo, {
    device: 'wasm',
    dtype: 'q8',
    // The ort 1.26.0-dev build that transformers.js 4.2 pins crashes wasm
    // session creation on these models' quantized merged decoders at the
    // 'extended'/'all' optimization levels (TransposeDQWeightsForMatMulNBits
    // "Missing required scale", fixed in ort 1.27); 'basic' skips the broken
    // pass. Costs a little inference speed, tolerable for these models.
    session_options: { graphOptimizationLevel: 'basic' },
    progress_callback: (p) => {
      // Per-file events; the hook aggregates loaded/total across files (and
      // across repos) into one percentage. The repo prefixes the key because
      // Opus-MT's two directions ship identically-named files. Other
      // statuses (initiate/done/ready) carry no bytes.
      if (p.status === 'progress') {
        const { file, loaded, total } = p as { file: string; loaded: number; total: number }
        post({ type: 'progress', file: `${repo}/${file}`, loaded, total })
      }
    }
  } as Parameters<typeof pipeline>[2]) as Promise<TranslationPipeline>

async function load(model: TranslateModel, pair: TranslatePair): Promise<void> {
  const key = unitKey(model, pair)
  if (current?.key === key) {
    post({ type: 'ready', model, pair })
    return
  }
  if (current) {
    if (current.kind === 'nllb') await current.pipe.dispose()
    else {
      await current.ab.dispose()
      await current.ba.dispose()
    }
    current = null
  }
  if (model === 'nllb-600m') {
    const pipe = await makePipe(NLLB_REPO)
    // One tiny inference per session so wasm warmup happens here, not on the
    // user's first real selection.
    await pipe('Ok.', {
      src_lang: NLLB_LANG_TOKENS.en,
      tgt_lang: NLLB_LANG_TOKENS.ru
    } as Parameters<TranslationPipeline>[1])
    current = { key, kind: 'nllb', pipe }
  } else {
    const info = TRANSLATE_CATALOG[pair]
    const ab = await makePipe(info.opusRepoAB)
    const ba = await makePipe(info.opusRepoBA)
    await ab('Ok.')
    await ba('Ok.')
    current = { key, kind: 'opus', ab, ba }
  }
  post({ type: 'ready', model, pair })
}

async function translate(
  msg: Extract<TranslateWorkerRequest, { type: 'translate' }>,
  gen: number
): Promise<void> {
  if (!current || current.key !== unitKey(msg.model, msg.pair))
    throw new Error('Translation model not loaded')
  const pipe =
    current.kind === 'nllb'
      ? current.pipe
      : msg.from === TRANSLATE_CATALOG[msg.pair].a
        ? current.ab
        : current.ba
  const langOptions =
    current.kind === 'nllb'
      ? { src_lang: NLLB_LANG_TOKENS[msg.from], tgt_lang: NLLB_LANG_TOKENS[msg.to] }
      : {}
  const finals: string[] = []
  for (const chunk of msg.chunks) {
    if (gen !== generation) return
    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      decode_kwargs: { skip_special_tokens: true },
      callback_function: (text: string) => {
        if (gen === generation) post({ type: 'delta', id: msg.id, text })
      }
    })
    const output = await pipe(chunk, {
      ...langOptions,
      streamer
    } as Parameters<TranslationPipeline>[1])
    const first = Array.isArray(output) ? output[0] : output
    finals.push((('translation_text' in first && first.translation_text) || '').trim())
    if (gen !== generation) return
    post({ type: 'chunk-done', id: msg.id })
  }
  post({ type: 'done', id: msg.id, finals })
}

// Requests are queued so a translate can't race a model (re)load.
let queue: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<TranslateWorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    generation += 1
    return
  }
  const gen = generation
  queue = queue.then(async () => {
    try {
      if (msg.type === 'load') await load(msg.model, msg.pair)
      else await translate(msg, gen)
    } catch (err) {
      post({
        type: 'error',
        context: msg.type === 'load' ? 'load' : 'translate',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  })
}
