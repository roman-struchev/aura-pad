import {
  env,
  pipeline,
  Tensor,
  type AutomaticSpeechRecognitionPipeline
} from '@huggingface/transformers'
import { VOICE_MODEL_CATALOG } from './models'
import { asyncifyWasmPaths } from '../ortAssets'
import type { VoiceModel } from '../../../../shared/settings'

// Runs Whisper (via transformers.js/onnxruntime) off the UI thread. Model
// weights are fetched from Hugging Face on first use - only ever triggered
// after the user confirms the download in the consent dialog - and cached by
// transformers.js in the browser Cache API, so later sessions load fully
// offline. Audio never leaves the machine; only model files are downloaded.

// Point onnxruntime at the app's bundled wasm runtime (offline + CSP) - see
// ../ortAssets.ts for the resolution scheme.
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = asyncifyWasmPaths()
}

export type WorkerRequest =
  | { type: 'load'; model: VoiceModel }
  | { type: 'transcribe'; audio: Float32Array; language: string | null }

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; model: VoiceModel }
  | { type: 'result'; text: string }
  | { type: 'error'; context: 'load' | 'transcribe'; message: string }

const post = (msg: WorkerResponse): void => self.postMessage(msg)

let current: { model: VoiceModel; pipe: AutomaticSpeechRecognitionPipeline } | null = null

// WebGPU when the machine actually has an adapter (not just the API), else
// the wasm CPU fallback. Detected once - the answer can't change mid-session.
let devicePromise: Promise<'webgpu' | 'wasm'> | null = null
const detectDevice = (): Promise<'webgpu' | 'wasm'> => {
  devicePromise ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
      return (await gpu?.requestAdapter()) ? 'webgpu' : 'wasm'
    } catch {
      return 'wasm'
    }
  })()
  return devicePromise
}

async function load(model: VoiceModel): Promise<void> {
  if (current?.model === model) {
    post({ type: 'ready', model })
    return
  }
  const device = await detectDevice()
  if (current) {
    await current.pipe.dispose()
    current = null
  }
  const info = VOICE_MODEL_CATALOG[model]
  const pipe = await pipeline('automatic-speech-recognition', info.repo, {
    device,
    dtype: info.dtype[device],
    progress_callback: (p) => {
      // Per-file events; the hook aggregates loaded/total across files into
      // one percentage. Other statuses (initiate/done/ready) carry no bytes.
      if (p.status === 'progress') {
        const { file, loaded, total } = p as { file: string; loaded: number; total: number }
        post({ type: 'progress', file, loaded, total })
      }
    }
  })
  // One inference on a second of silence, so WebGPU shader compilation (a
  // couple of seconds on first run) happens here, not on the user's first
  // real utterance. Any language works for warmup; being explicit avoids
  // transformers.js's "defaulting to English" warning.
  await pipe(new Float32Array(16000), { language: 'english' })
  current = { model, pipe }
  post({ type: 'ready', model })
}

// Whisper natively predicts the spoken language as the first token it
// decodes, but transformers.js's pipeline doesn't expose that (an unset
// language silently falls back to English). So for the 'auto' setting, do
// what whisper.cpp does: run the encoder plus a single decoder step from the
// start-of-transcript token and pick the highest-scoring language token.
async function detectLanguage(
  pipe: AutomaticSpeechRecognitionPipeline,
  audio: Float32Array
): Promise<string | null> {
  try {
    // Typed as the generic PreTrainedModel/Processor; the Whisper-specific
    // bits (lang_to_id, input_features) aren't on the public types.
    const model = pipe.model as unknown as {
      (inputs: object): Promise<{ logits: Tensor }>
      generation_config?: { decoder_start_token_id?: number; lang_to_id?: Record<string, number> }
    }
    const langToId = model.generation_config?.lang_to_id
    const startToken = model.generation_config?.decoder_start_token_id
    if (!langToId || startToken == null) return null
    const { input_features } = (await pipe.processor(audio)) as { input_features: Tensor }
    const { logits } = await model({
      input_features,
      decoder_input_ids: new Tensor('int64', new BigInt64Array([BigInt(startToken)]), [1, 1])
    })
    const scores = logits.data as Float32Array
    let best: string | null = null
    let bestScore = -Infinity
    for (const [token, id] of Object.entries(langToId)) {
      if (scores[id] > bestScore) {
        bestScore = scores[id]
        best = token
      }
    }
    // '<|ru|>' -> 'ru'
    return best ? best.slice(2, -2) : null
  } catch (e) {
    console.warn('Language detection failed, falling back to English:', e)
    return null
  }
}

async function transcribe(audio: Float32Array, language: string | null): Promise<void> {
  if (!current) throw new Error('No model loaded')
  const resolved = language ?? (await detectLanguage(current.pipe, audio))
  const output = await current.pipe(audio, {
    language: resolved ?? 'english',
    task: 'transcribe',
    // Long dictation gets windowed into 30s chunks (Whisper's native input
    // length) with overlap, instead of being truncated.
    chunk_length_s: 30
  })
  const text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim()
  post({ type: 'result', text })
}

// Requests are queued so a transcribe can't race a model (re)load.
let queue: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  queue = queue.then(async () => {
    try {
      if (msg.type === 'load') await load(msg.model)
      else await transcribe(msg.audio, msg.language)
    } catch (err) {
      post({
        type: 'error',
        context: msg.type === 'load' ? 'load' : 'transcribe',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  })
}
