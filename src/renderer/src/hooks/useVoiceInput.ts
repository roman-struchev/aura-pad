import { useEffect, useRef, useState } from 'react'
import WhisperWorker from '../lib/voice/whisperWorker?worker'
import type { WorkerResponse } from '../lib/voice/whisperWorker'
import { isModelDownloaded, markModelDownloaded } from '../lib/voice/models'
import { alertDialog } from '../lib/dialogs'
import type { VoiceLanguage, VoiceModel } from '../../../shared/settings'

// 'consent' = waiting in the download dialog; 'downloading' = fetching model
// weights after the user confirmed; 'loading' = model already on disk, just
// initializing the session before recording starts.
export type VoiceStatus =
  'idle' | 'consent' | 'downloading' | 'loading' | 'recording' | 'transcribing'

// Hard cap so a forgotten hot mic doesn't record (and then transcribe)
// indefinitely.
const MAX_RECORDING_MS = 5 * 60 * 1000
// Anything shorter is an accidental tap - not worth a transcription pass.
const MIN_RECORDING_SECONDS = 0.35

// Push-to-talk voice dictation: toggle() starts the microphone, a second
// toggle() stops it and runs the recording through Whisper in a worker, and
// the recognized text lands in onText. The first use of a model goes through
// a consent dialog (status 'consent') before anything is downloaded.
export function useVoiceInput(
  model: VoiceModel,
  language: VoiceLanguage,
  onText: (text: string) => void
) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [progress, setProgress] = useState(0)
  // Live analyser over the mic stream while recording - the toolbar's level
  // meter reads it directly (via rAF, no React state churn) to show the
  // voice reacting in real time.
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const readyModelRef = useRef<VoiceModel | null>(null)
  // What to do once the worker reports the model is ready: recording follows
  // a normal mic press; after a consent-dialog download we deliberately stop
  // at 'idle' instead, so the mic never turns itself on at the end of a long
  // download the user may have walked away from.
  const afterLoadRef = useRef<'record' | 'idle'>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const levelCtxRef = useRef<AudioContext | null>(null)
  const progressPerFileRef = useRef<Map<string, { loaded: number; total: number }>>(new Map())

  // Read through refs by the worker's message handler (attached once per
  // worker) and by callers registered once, so they always see current values.
  const modelRef = useRef(model)
  const languageRef = useRef(language)
  const onTextRef = useRef(onText)
  useEffect(() => {
    modelRef.current = model
    languageRef.current = language
    onTextRef.current = onText
  })

  const handleWorkerMessage = (msg: WorkerResponse): void => {
    switch (msg.type) {
      case 'progress': {
        // Only the .onnx weights are worth tracking - the config/tokenizer
        // JSONs are tiny and would briefly show a misleading "100%" while
        // they finish before the first weight file even starts.
        if (!msg.file.endsWith('.onnx')) break
        progressPerFileRef.current.set(msg.file, { loaded: msg.loaded, total: msg.total })
        let loaded = 0
        let total = 0
        for (const f of progressPerFileRef.current.values()) {
          loaded += f.loaded
          total += f.total
        }
        if (total > 0) setProgress(Math.round((loaded / total) * 100))
        break
      }
      case 'ready':
        markModelDownloaded(msg.model)
        readyModelRef.current = msg.model
        if (afterLoadRef.current === 'record') startRecording()
        else setStatus('idle')
        break
      case 'result':
        if (msg.text) onTextRef.current(msg.text)
        setStatus('idle')
        break
      case 'error':
        setStatus('idle')
        alertDialog(
          msg.context === 'load'
            ? `Failed to load the speech model: ${msg.message}`
            : `Transcription failed: ${msg.message}`
        )
        break
    }
  }

  const getWorker = (): Worker => {
    if (!workerRef.current) {
      const worker = new WhisperWorker()
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => handleWorkerMessage(e.data)
      // A worker that fails to even start (script load/parse error) never
      // sends a message - without this the UI would hang at 0% forever.
      worker.onerror = (e: ErrorEvent) => {
        worker.terminate()
        workerRef.current = null
        readyModelRef.current = null
        setStatus('idle')
        alertDialog(`Dictation failed to start: ${e.message || 'worker error (see DevTools)'}`)
      }
      workerRef.current = worker
    }
    return workerRef.current
  }

  const loadModel = (target: VoiceModel, then: 'record' | 'idle'): void => {
    afterLoadRef.current = then
    progressPerFileRef.current = new Map()
    setProgress(0)
    getWorker().postMessage({ type: 'load', model: target })
  }

  const startRecording = async (): Promise<void> => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setStatus('idle')
      alertDialog('Microphone access was denied. Allow it in System Settings to use dictation.')
      return
    }
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      levelCtxRef.current?.close()
      levelCtxRef.current = null
      setAnalyser(null)
      recorderRef.current = null
      transcribeBlob(new Blob(chunks, { type: recorder.mimeType }))
    }
    recorderRef.current = recorder
    recorder.start()
    // Tap the same stream with an analyser for the live level meter. Purely
    // cosmetic, so a failure here must never block the recording itself.
    try {
      const ctx = new AudioContext()
      const node = ctx.createAnalyser()
      node.fftSize = 64
      node.smoothingTimeConstant = 0.75
      ctx.createMediaStreamSource(stream).connect(node)
      levelCtxRef.current = ctx
      setAnalyser(node)
    } catch {
      // No meter, but dictation still works.
    }
    setStatus('recording')
    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }, MAX_RECORDING_MS)
  }

  const transcribeBlob = async (blob: Blob): Promise<void> => {
    setStatus('transcribing')
    try {
      // A 16kHz AudioContext makes decodeAudioData resample the recording to
      // Whisper's expected input rate as part of decoding.
      const ctx = new AudioContext({ sampleRate: 16000 })
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
      await ctx.close()
      if (decoded.duration < MIN_RECORDING_SECONDS) {
        setStatus('idle')
        return
      }
      // Mix down to mono if the mic happens to deliver more than one channel.
      let audio = decoded.getChannelData(0)
      if (decoded.numberOfChannels > 1) {
        audio = new Float32Array(decoded.length)
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch)
          for (let i = 0; i < data.length; i++) audio[i] += data[i] / decoded.numberOfChannels
        }
      }
      getWorker().postMessage(
        {
          type: 'transcribe',
          audio,
          // null tells the worker to auto-detect the spoken language.
          language: languageRef.current === 'auto' ? null : languageRef.current
        },
        [audio.buffer]
      )
    } catch (e) {
      setStatus('idle')
      alertDialog(`Could not process the recording: ${e instanceof Error ? e.message : e}`)
    }
  }

  // The mic button / Cmd+Shift+D. One press to record, another to transcribe;
  // presses while busy (loading/transcribing/consent dialog open) do nothing.
  const toggle = (): void => {
    if (status === 'recording') {
      recorderRef.current?.stop()
      return
    }
    if (status !== 'idle') return
    const target = modelRef.current
    if (readyModelRef.current === target) {
      startRecording()
    } else if (isModelDownloaded(target)) {
      setStatus('loading')
      loadModel(target, 'record')
    } else {
      setStatus('consent')
    }
  }

  // Consent dialog confirmed - start the actual download.
  const confirmDownload = (target: VoiceModel): void => {
    setStatus('downloading')
    loadModel(target, 'idle')
  }

  // Cancel mid-download: terminating the worker is the only way to abort the
  // in-flight fetches. Files that finished downloading stay in the cache, so
  // retrying later resumes from where it left off.
  const cancelDownload = (): void => {
    workerRef.current?.terminate()
    workerRef.current = null
    readyModelRef.current = null
    setStatus('idle')
  }

  const dismissConsent = (): void => setStatus('idle')

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      levelCtxRef.current?.close()
    }
  }, [])

  return {
    status,
    progress,
    analyser,
    toggle,
    confirmDownload,
    cancelDownload,
    dismissConsent
  }
}
