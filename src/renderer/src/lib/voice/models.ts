import type { VoiceModel } from '../../../../shared/settings'

// Per-file ONNX precision choices, keyed by which execution backend ends up
// running the model. WebGPU follows whisper-web's proven combo (fp32 encoder
// for GPU compatibility + q4 decoder); turbo's fp32 encoder is only published
// in external-data format, which onnxruntime-web can't fetch as one file, so
// it uses the fp16 encoder instead. The wasm fallback uses the fully
// quantized (q8) builds - anything bigger is too slow without a GPU anyway.
type DtypeConfig = Record<string, import('@huggingface/transformers').DataType>

export interface VoiceModelInfo {
  id: VoiceModel
  repo: string
  label: string
  // Shown in the download-consent dialog; the WebGPU variant's total, since
  // that's what virtually every machine ends up downloading.
  approxDownload: string
  quality: string
  dtype: { webgpu: DtypeConfig; wasm: DtypeConfig }
}

export const VOICE_MODEL_CATALOG: Record<VoiceModel, VoiceModelInfo> = {
  tiny: {
    id: 'tiny',
    repo: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny',
    approxDownload: '~120 MB',
    quality: 'Fastest, rough accuracy',
    dtype: {
      webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }
    }
  },
  base: {
    id: 'base',
    repo: 'onnx-community/whisper-base',
    label: 'Whisper Base',
    approxDownload: '~210 MB',
    quality: 'Good balance for dictation',
    dtype: {
      webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }
    }
  },
  small: {
    id: 'small',
    repo: 'onnx-community/whisper-small',
    label: 'Whisper Small',
    approxDownload: '~590 MB',
    quality: 'Noticeably more accurate',
    dtype: {
      webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }
    }
  },
  turbo: {
    id: 'turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    approxDownload: '~1.6 GB',
    quality: 'Best accuracy, needs a decent GPU',
    dtype: {
      webgpu: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }
    }
  }
}

// Which models have been fully downloaded on this machine (the actual bytes
// live in the browser Cache API, keyed by Hugging Face URL - this is just the
// "download finished successfully" marker that gates the consent dialog).
const DOWNLOADED_KEY = 'aurapad-voice-models-downloaded'

export function isModelDownloaded(id: VoiceModel): boolean {
  try {
    return (JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]') as string[]).includes(id)
  } catch {
    return false
  }
}

export function markModelDownloaded(id: VoiceModel): void {
  const list = (() => {
    try {
      return JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })()
  if (!list.includes(id)) localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...list, id]))
}

// Frees the disk space: drops every cached file of the model's repo from the
// transformers.js browser cache (entries are keyed by their Hugging Face
// URL), plus the "downloaded" marker - the consent dialog will ask again.
export async function deleteModelDownload(id: VoiceModel): Promise<void> {
  const repo = VOICE_MODEL_CATALOG[id].repo
  try {
    const cache = await caches.open('transformers-cache')
    for (const request of await cache.keys()) {
      if (request.url.includes(repo)) await cache.delete(request)
    }
  } catch {
    // Cache API unavailable - still remove the marker below.
  }
  try {
    const list = JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]') as string[]
    localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(list.filter((m) => m !== id)))
  } catch {
    localStorage.removeItem(DOWNLOADED_KEY)
  }
}
