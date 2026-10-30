import { TtsSession } from '@mintplex-labs/piper-tts-web'
import { ortWasmBase } from '../ortAssets'

// Neural read-aloud voices (Piper/VITS) running locally via onnxruntime's
// wasm backend, phonemized by espeak-ng compiled to wasm. Voice models
// (~60-80MB each) are fetched from Hugging Face on first use - only after
// the user confirms in the renderer - and cached in OPFS by the library, so
// later sessions work offline. Runs in a worker: synthesis is CPU-bound and
// would freeze the UI on the main thread.

export type TtsWorkerRequest =
  { type: 'synthesize'; id: number; text: string; voiceId: string } | { type: 'cancel' }

export type TtsWorkerResponse =
  | { type: 'audio'; id: number; voiceId: string; wav: ArrayBuffer }
  | { type: 'progress'; url: string; loaded: number; total: number }
  | { type: 'error'; id: number; message: string }

// Typed against the worker-global postMessage(message, transfer) overload -
// this file compiles under the DOM lib, whose window.postMessage signature
// differs.
const post = (msg: TtsWorkerResponse, transfer: Transferable[] = []): void =>
  (self.postMessage as (message: unknown, transfer?: Transferable[]) => void)(msg, transfer)

// ort wasm base comes from the shared resolver (../ortAssets.ts). The
// piper-specific wasm/data live alongside in piper-dist/ and use the same
// scheme: a variable-held relative path (so vite's build-time new URL()
// analysis leaves it alone), resolved against self.location - the worker's
// own URL in assets/ - rather than import.meta.url, for the same stability
// reason spelled out in ortAssets.ts.
const piperDistDir = '../piper-dist/'
const ortBase = ortWasmBase()
const piperBase = import.meta.env.DEV
  ? `${self.location.origin}/piper-dist/`
  : new URL(piperDistDir, self.location.href).href

const WASM_PATHS = {
  onnxWasm: ortBase,
  piperWasm: `${piperBase}piper_phonemize.wasm`,
  piperData: `${piperBase}piper_phonemize.data`
}

// One live session per voice. TtsSession's constructor is a singleton (it
// returns the previous instance without reloading the model, even for a
// different voiceId), so the static _instance is reset before creating a
// session for another voice - each language keeps its own working session.
const sessions = new Map<string, TtsSession>()

async function getSession(voiceId: string): Promise<TtsSession> {
  let session = sessions.get(voiceId)
  if (!session) {
    ;(TtsSession as unknown as { _instance: TtsSession | null })._instance = null
    session = await TtsSession.create({
      voiceId: voiceId as never,
      wasmPaths: WASM_PATHS,
      progress: (p) => post({ type: 'progress', url: p.url, loaded: p.loaded, total: p.total })
    })
    sessions.set(voiceId, session)
  }
  return session
}

// Explicit FIFO with a pump (not a promise chain) so 'cancel' can drop
// not-yet-synthesized chunks when the user stops reading mid-document.
const queue: Extract<TtsWorkerRequest, { type: 'synthesize' }>[] = []
let pumping = false

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      const session = await getSession(job.voiceId)
      const wav = await (await session.predict(job.text)).arrayBuffer()
      post({ type: 'audio', id: job.id, voiceId: job.voiceId, wav }, [wav])
    } catch (err) {
      post({
        type: 'error',
        id: job.id,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }
  pumping = false
}

self.onmessage = (e: MessageEvent<TtsWorkerRequest>) => {
  if (e.data.type === 'cancel') {
    queue.length = 0
    return
  }
  queue.push(e.data)
  pump()
}
