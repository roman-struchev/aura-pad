import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import TtsWorker from '../lib/tts/piperWorker?worker'
import type { TtsWorkerResponse } from '../lib/tts/piperWorker'
import { download as piperDownload, remove as piperRemove } from '@mintplex-labs/piper-tts-web'
import { useModelWorker } from './useModelWorker'
import { alertDialog } from '../lib/dialogs'
import { detectReadLang as detectLang } from '../lib/langDetect'
import { chunkSentences } from '../lib/sentenceChunks'
import { type ReadLang, type ReadVoiceKeysByLang, type ReadVoices } from '../../../shared/settings'
export type { ReadLang } from '../../../shared/settings'

// Read-aloud with local neural voices (Piper) synthesized in a worker and
// played back chunk by chunk - the next sentence is being synthesized while
// the current one plays. Each language's voice is a setting; 'system' (the
// OS's built-in synthesis, no download) is one of the choices and mixes
// freely with neural chunks in the same document. Neural voices download
// once from Hugging Face, after the consent dialog.

const RATE_KEY = 'aurapad-read-aloud-rate'
const DOWNLOADED_VOICES_KEY = 'aurapad-tts-voices-downloaded'
export const READ_ALOUD_RATES = [1, 1.5, 2]
// Chunks are sentence groups capped at this size: language switching happens
// on chunk boundaries, and the first chunk's synthesis time is the latency
// before the user hears anything.
const MAX_CHUNK_CHARS = 220

// Settings keys -> Piper voices (all from rhasspy/piper-voices), with what
// the download-consent dialog shows. 'system' is deliberately absent - it's
// not a download.
export interface ReadVoiceInfo {
  id: string
  label: string
  approxDownload: string
}
export const VOICE_CATALOG: {
  [L in ReadLang]: Record<Exclude<ReadVoiceKeysByLang[L], 'system'>, ReadVoiceInfo>
} = {
  ru: {
    ruslan: { id: 'ru_RU-ruslan-medium', label: 'Ruslan (recommended)', approxDownload: '~78 MB' },
    irina: { id: 'ru_RU-irina-medium', label: 'Irina', approxDownload: '~78 MB' },
    dmitri: { id: 'ru_RU-dmitri-medium', label: 'Dmitri', approxDownload: '~76 MB' },
    denis: { id: 'ru_RU-denis-medium', label: 'Denis', approxDownload: '~76 MB' }
  },
  en: {
    ryan: {
      id: 'en_US-ryan-high',
      label: 'Ryan (recommended, high quality)',
      approxDownload: '~115 MB'
    },
    hfc_female: { id: 'en_US-hfc_female-medium', label: 'Female (HFC)', approxDownload: '~63 MB' },
    hfc_male: { id: 'en_US-hfc_male-medium', label: 'Male (HFC)', approxDownload: '~63 MB' },
    lessac: { id: 'en_US-lessac-medium', label: 'Lessac', approxDownload: '~63 MB' }
  }
}
const voiceInfo = (lang: ReadLang, key: string): ReadVoiceInfo | null =>
  key === 'system' ? null : (VOICE_CATALOG[lang] as Record<string, ReadVoiceInfo>)[key]

// Markdown read as prose: rendered to HTML with the same marked call the
// preview uses, code blocks dropped (listening to one being spelled out is
// useless), then flattened to plain text - no "asterisk asterisk" artifacts.
const markdownToPlainText = (md: string): string => {
  const html = marked.parse(md, { async: false }) as string
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('pre').forEach((el) => el.remove())
  return doc.body.textContent ?? ''
}

// Sentences merge into chunks while they speak the same language (language
// switching happens on chunk boundaries); the shared chunker also breaks
// chunks at line breaks - natural pause points.
const chunkText = (text: string): string[] =>
  chunkSentences(text, MAX_CHUNK_CHARS, (a, b) => detectLang(a) === detectLang(b)).map(
    (c) => c.text
  )

export const downloadedVoices = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DOWNLOADED_VOICES_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

const markVoiceDownloaded = (voiceId: string): void => {
  const list = downloadedVoices()
  if (!list.includes(voiceId))
    localStorage.setItem(DOWNLOADED_VOICES_KEY, JSON.stringify([...list, voiceId]))
}

const unmarkVoiceDownloaded = (voiceId: string): void => {
  localStorage.setItem(
    DOWNLOADED_VOICES_KEY,
    JSON.stringify(downloadedVoices().filter((v) => v !== voiceId))
  )
}

// --- System (OS) voices, one of the selectable options per language ---

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null
const ensureSystemVoices = (): Promise<SpeechSynthesisVoice[]> => {
  voicesPromise ??= new Promise((resolve) => {
    const loaded = speechSynthesis.getVoices()
    if (loaded.length > 0) return resolve(loaded)
    speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), {
      once: true
    })
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500)
  })
  return voicesPromise
}

const pickSystemVoice = (
  voices: SpeechSynthesisVoice[],
  lang: ReadLang
): SpeechSynthesisVoice | null => {
  const candidates = voices.filter((v) => v.lang.toLowerCase().startsWith(lang))
  if (candidates.length === 0) return null
  const score = (v: SpeechSynthesisVoice): number =>
    /premium/i.test(v.name) ? 3 : /enhanced/i.test(v.name) ? 2 : v.default ? 1 : 0
  return [...candidates].sort((a, b) => score(b) - score(a))[0]
}

// What sits in the playback buffer for one chunk: a synthesized wav, or a
// marker to speak it with the system voice when its turn comes.
type PlayableChunk = { kind: 'wav'; url: string } | { kind: 'system'; text: string }

export function useReadAloud(voices: ReadVoices) {
  const [speaking, setSpeaking] = useState(false)
  const [rate, setRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(RATE_KEY))
    return READ_ALOUD_RATES.includes(saved) ? saved : 1
  })
  // Percentage while voice models download, null otherwise.
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  // Consent dialog state, mirroring dictation's modal: which languages the
  // pending text needs ('consent' = choosing, 'downloading' = progress bar).
  const [modalPhase, setModalPhase] = useState<'consent' | 'downloading' | null>(null)
  const [consentLangs, setConsentLangs] = useState<ReadLang[]>([])

  const rateRef = useRef(rate)
  const speakingRef = useRef(false)
  const pendingChunksRef = useRef<string[]>([])

  const voicesRef = useRef(voices)
  useEffect(() => {
    voicesRef.current = voices
  })
  const voiceFor = (lang: ReadLang): ReadVoiceInfo | 'system' =>
    voiceInfo(lang, voicesRef.current[lang]) ?? 'system'

  // Playback pipeline: chunks are keyed by sequential ids; synthesized wavs
  // arrive from the worker, system chunks are placed directly, and playNext
  // consumes them strictly in order.
  const nextIdRef = useRef(0)
  const pendingIdsRef = useRef<Set<number>>(new Set())
  const bufferRef = useRef<Map<number, PlayableChunk>>(new Map())
  const playIndexRef = useRef(0)
  const playingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const systemVoicesRef = useRef<SpeechSynthesisVoice[]>([])

  // Worker lifecycle (lazy start, startup-error recovery, idle unload after
  // half an hour without reading, download-progress aggregation) - shared
  // with dictation and translate via useModelWorker. A loaded Piper session
  // holds ~100MB+ per voice, hence the idle unload.
  const worker = useModelWorker<TtsWorkerResponse>({
    create: () => new TtsWorker(),
    onMessage: (msg) => handleWorkerMessage(msg),
    // Terminate and drop the broken worker (as dictation/translate do) -
    // keeping it cached would make every later read-aloud post messages
    // into a dead worker and hang in 'speaking' forever.
    onStartupError: () => {
      stop()
      alertDialog('Read aloud failed to start (see DevTools).')
    },
    isIdle: () => !speakingRef.current,
    onProgress: setDownloadProgress
  })

  const finishIfDone = (): void => {
    if (pendingIdsRef.current.size === 0 && bufferRef.current.size === 0 && !playingRef.current) {
      speakingRef.current = false
      setSpeaking(false)
      setDownloadProgress(null)
      worker.scheduleIdleUnload()
    }
  }

  const playNext = (): void => {
    if (playingRef.current || !speakingRef.current) return
    const item = bufferRef.current.get(playIndexRef.current)
    if (!item) {
      finishIfDone()
      return
    }
    bufferRef.current.delete(playIndexRef.current)
    playIndexRef.current += 1
    playingRef.current = true

    if (item.kind === 'wav') {
      const audio = new Audio(item.url)
      audioRef.current = audio
      audio.playbackRate = rateRef.current
      audio.onended = () => {
        URL.revokeObjectURL(item.url)
        playingRef.current = false
        audioRef.current = null
        playNext()
      }
      // A chunk that fails to *play* is abnormal (e.g. CSP blocking blob:
      // media) - stop loudly rather than silently skipping through the text.
      // play()'s rejection (autoplay policy, an aborted load) needs the same
      // treatment as onerror; either can fire without the other - or both,
      // hence the once-guard - and an unhandled rejection would leave
      // playingRef stuck at true, wedging the whole pipeline in 'speaking'.
      let failed = false
      const fail = (): void => {
        if (failed) return
        failed = true
        URL.revokeObjectURL(item.url)
        stop()
        alertDialog('Read aloud playback failed (see DevTools console).')
      }
      audio.onerror = fail
      audio.play().catch(fail)
    } else {
      const utterance = new SpeechSynthesisUtterance(item.text)
      const lang = detectLang(item.text)
      const voice = pickSystemVoice(systemVoicesRef.current, lang)
      if (voice) utterance.voice = voice
      utterance.lang = lang === 'ru' ? 'ru-RU' : 'en-US'
      utterance.rate = rateRef.current
      utterance.onend = utterance.onerror = () => {
        playingRef.current = false
        playNext()
      }
      speechSynthesis.speak(utterance)
    }
  }

  const handleWorkerMessage = (msg: TtsWorkerResponse): void => {
    switch (msg.type) {
      case 'progress':
        worker.reportFileProgress(msg.url, msg.loaded, msg.total)
        break
      case 'audio': {
        if (!pendingIdsRef.current.delete(msg.id)) return // stale, after stop()
        markVoiceDownloaded(msg.voiceId)
        setDownloadProgress(null)
        setModalPhase(null)
        const blob = new Blob([msg.wav], { type: 'audio/wav' })
        bufferRef.current.set(msg.id, { kind: 'wav', url: URL.createObjectURL(blob) })
        playNext()
        break
      }
      case 'error':
        if (!pendingIdsRef.current.delete(msg.id)) return
        stop()
        alertDialog(`Read aloud failed: ${msg.message}`)
        break
    }
  }

  const stop = (): void => {
    speakingRef.current = false
    setSpeaking(false)
    setDownloadProgress(null)
    setModalPhase(null)
    pendingChunksRef.current = []
    if (worker.hasWorker()) worker.getWorker().postMessage({ type: 'cancel' })
    pendingIdsRef.current.clear()
    for (const item of bufferRef.current.values()) {
      if (item.kind === 'wav') URL.revokeObjectURL(item.url)
    }
    bufferRef.current.clear()
    playingRef.current = false
    if (audioRef.current) {
      audioRef.current.pause()
      // onended never fires after pause(), so the playing chunk's blob URL
      // must be revoked here - the loop above only covers queued ones.
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
    speechSynthesis.cancel()
    worker.scheduleIdleUnload()
  }

  const enqueueChunks = async (chunks: string[]): Promise<void> => {
    worker.resetProgress()
    playIndexRef.current = nextIdRef.current
    if (chunks.some((c) => voiceFor(detectLang(c)) === 'system')) {
      systemVoicesRef.current = await ensureSystemVoices()
      if (!speakingRef.current) return // stopped while voices were loading
    }
    for (const chunk of chunks) {
      const id = nextIdRef.current++
      const voice = voiceFor(detectLang(chunk))
      if (voice === 'system') {
        bufferRef.current.set(id, { kind: 'system', text: chunk })
      } else {
        pendingIdsRef.current.add(id)
        worker.getWorker().postMessage({ type: 'synthesize', id, text: chunk, voiceId: voice.id })
      }
    }
    playNext()
  }

  const speak = (text: string, options: { markdown: boolean }): void => {
    stop()
    const chunks = chunkText(options.markdown ? markdownToPlainText(text) : text)
    if (chunks.length === 0) return

    speakingRef.current = true
    setSpeaking(true)

    // Languages whose selected voice is neural but never downloaded: open
    // the consent dialog (listing every needed language's voice choices)
    // and keep the chunks aside until the user decides.
    const langs = [...new Set(chunks.map(detectLang))]
    const missing = langs.filter((lang) => {
      const voice = voiceFor(lang)
      return voice !== 'system' && !downloadedVoices().includes(voice.id)
    })
    if (missing.length > 0) {
      pendingChunksRef.current = chunks
      setConsentLangs(langs)
      setModalPhase('consent')
      return
    }
    enqueueChunks(chunks)
  }

  // Consent dialog confirmed. The dialog may have changed the voice choices;
  // they're applied to the refs right away (App persists them to Settings in
  // parallel) so this read uses them. If everything selected is already
  // downloaded or 'system', the dialog just closes and reading starts.
  const confirmVoiceDownload = (choices: Partial<ReadVoices>): void => {
    voicesRef.current = { ...voicesRef.current, ...choices }
    const stillMissing = consentLangs.some((lang) => {
      const voice = voiceFor(lang)
      return voice !== 'system' && !downloadedVoices().includes(voice.id)
    })
    setModalPhase(stillMissing ? 'downloading' : null)
    const chunks = pendingChunksRef.current
    pendingChunksRef.current = []
    enqueueChunks(chunks)
  }

  // Fetch voices to OPFS without reading anything - the Settings-opened
  // dialog's Download button. Progress flows through the same modal states
  // as the consent flow.
  const predownloadVoices = async (voiceIds: string[]): Promise<void> => {
    setModalPhase('downloading')
    // No worker involved (piperDownload fetches straight to OPFS), but the
    // handle's aggregation gives the same combined percentage for free.
    worker.resetProgress()
    try {
      for (const voiceId of voiceIds) {
        await piperDownload(voiceId as never, (p) => {
          worker.reportFileProgress(p.url, p.loaded, p.total)
        })
        markVoiceDownloaded(voiceId)
      }
    } catch (e) {
      alertDialog(`Voice download failed: ${e instanceof Error ? e.message : e}`)
    }
    setDownloadProgress(null)
    setModalPhase(null)
  }

  // Delete a downloaded voice from disk (trash icon in the voice dialog).
  // The worker is dropped too - one of its sessions may hold that voice.
  const deleteVoice = async (voiceId: string): Promise<void> => {
    if (speakingRef.current) stop()
    worker.terminateWorker()
    try {
      await piperRemove(voiceId as never)
    } catch {
      // Not in OPFS (e.g. cleared manually) - the marker removal is what counts.
    }
    unmarkVoiceDownloaded(voiceId)
  }

  // Closing the dialog = don't read; mid-download it also terminates the
  // worker, the only way to abort the in-flight fetches (finished files stay
  // cached, so retrying resumes).
  const closeVoiceModal = (): void => {
    if (modalPhase === 'downloading') worker.terminateWorker()
    stop()
  }

  // Cycles 1x -> 1.5x -> 2x, applied live to the playing audio (pitch is
  // preserved by the browser) and to everything queued after it.
  const cycleRate = (): void => {
    const next =
      READ_ALOUD_RATES[(READ_ALOUD_RATES.indexOf(rateRef.current) + 1) % READ_ALOUD_RATES.length]
    rateRef.current = next
    setRate(next)
    localStorage.setItem(RATE_KEY, String(next))
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  useEffect(() => {
    return () => {
      // The worker itself is terminated by useModelWorker's own cleanup.
      // A detached HTMLAudioElement keeps playing after unmount - silence it.
      audioRef.current?.pause()
      speechSynthesis.cancel()
    }
  }, [])

  return {
    speaking,
    rate,
    downloadProgress,
    modalPhase,
    consentLangs,
    confirmVoiceDownload,
    closeVoiceModal,
    predownloadVoices,
    deleteVoice,
    cycleRate,
    speak,
    stop
  }
}
