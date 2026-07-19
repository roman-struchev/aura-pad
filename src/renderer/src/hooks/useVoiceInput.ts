import { useEffect, useRef, useState } from 'react'
import WhisperWorker from '../lib/voice/whisperWorker?worker'
import type { WorkerResponse } from '../lib/voice/whisperWorker'
import { deleteModelDownload, isModelDownloaded, markModelDownloaded } from '../lib/voice/models'
import { useModelWorker } from './useModelWorker'
import { alertDialog } from '../lib/dialogs'
import type { VoiceLanguage, VoiceModel } from '../../../shared/settings'

// 'consent' = waiting in the download dialog; 'downloading' = fetching model
// weights after the user confirmed. There's deliberately no 'loading' state:
// when the model is on disk but not in memory yet, recording starts
// immediately and the load runs in parallel (the worker queues the
// transcribe behind it), so the user never waits for session init.
export type VoiceStatus = 'idle' | 'consent' | 'downloading' | 'recording' | 'transcribing'

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

  const readyModelRef = useRef<VoiceModel | null>(null)
  // What 'ready' from the worker should do to the UI: 'idle' closes the
  // consent-download dialog; 'none' leaves the status alone - that's the
  // parallel load-while-recording case, where recording (or transcribing)
  // is already in progress and owns the status.
  const afterLoadRef = useRef<'idle' | 'none'>('none')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const levelCtxRef = useRef<AudioContext | null>(null)
  // Set by cancelRecording (Escape): the recorder's onstop then throws the
  // take away instead of transcribing it.
  const discardRef = useRef(false)
  const statusRef = useRef<VoiceStatus>('idle')
  useEffect(() => {
    statusRef.current = status
  })

  // Worker lifecycle (lazy start, startup-error recovery, idle unload after
  // half an hour without dictation, download-progress aggregation) - shared
  // with translate and read-aloud via useModelWorker.
  const worker = useModelWorker<WorkerResponse>({
    create: () => new WhisperWorker(),
    onMessage: (msg) => handleWorkerMessage(msg),
    onStartupError: (message) => {
      readyModelRef.current = null
      setStatus('idle')
      alertDialog(`Dictation failed to start: ${message}`)
    },
    isIdle: () => statusRef.current === 'idle',
    // A model loaded in the unloaded worker is gone with it.
    onIdleUnload: () => {
      readyModelRef.current = null
    },
    onProgress: setProgress
  })

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
      case 'progress':
        // Only the .onnx weights are worth tracking - the config/tokenizer
        // JSONs are tiny and would briefly show a misleading "100%" while
        // they finish before the first weight file even starts.
        if (msg.file.endsWith('.onnx')) worker.reportFileProgress(msg.file, msg.loaded, msg.total)
        break
      case 'ready':
        markModelDownloaded(msg.model)
        readyModelRef.current = msg.model
        if (afterLoadRef.current === 'idle') setStatus('idle')
        worker.scheduleIdleUnload()
        break
      case 'result':
        if (msg.text) onTextRef.current(msg.text)
        setStatus('idle')
        worker.scheduleIdleUnload()
        break
      case 'error':
        // If the model failed to load while a parallel recording was running,
        // the take has nowhere to go - discard it rather than queueing a
        // transcribe that would just fail again.
        if (msg.context === 'load') cancelRecording()
        setStatus('idle')
        worker.scheduleIdleUnload()
        alertDialog(
          msg.context === 'load'
            ? `Failed to load the speech model: ${msg.message}`
            : `Transcription failed: ${msg.message}`
        )
        break
    }
  }

  const loadModel = (target: VoiceModel, then: 'idle' | 'none'): void => {
    afterLoadRef.current = then
    worker.resetProgress()
    setProgress(0)
    worker.getWorker().postMessage({ type: 'load', model: target })
  }

  const startRecording = async (): Promise<void> => {
    // Claim the busy state before the getUserMedia await - and mirror it into
    // statusRef synchronously, since the effect only syncs the ref after a
    // render - so a second toggle while the permission prompt is up can't
    // pass the idle check and start a parallel recording, leaking the first
    // recorder and its MediaStream.
    setStatus('recording')
    statusRef.current = 'recording'
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setStatus('idle')
      statusRef.current = 'idle'
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
      if (discardRef.current) {
        discardRef.current = false
        setStatus('idle')
        worker.scheduleIdleUnload()
        return
      }
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
      worker.getWorker().postMessage(
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
    // Read through statusRef, not the render-time `status` closure: two quick
    // presses can both arrive before React re-renders, and the second must
    // see the first's synchronous status claim from startRecording.
    const current = statusRef.current
    if (current === 'recording') {
      recorderRef.current?.stop()
      return
    }
    if (current !== 'idle') return
    const target = modelRef.current
    if (readyModelRef.current === target) {
      startRecording()
    } else if (isModelDownloaded(target)) {
      // Model on disk but not in memory yet: record right away and load in
      // parallel. The worker runs its messages strictly in order, so the
      // transcribe posted when the user stops simply queues behind the load -
      // no visible waiting, at most a longer "transcribing" spinner on the
      // very first take of a session.
      loadModel(target, 'none')
      startRecording()
    } else {
      setStatus('consent')
    }
  }

  // Escape: stop an active recording and throw it away (no transcription).
  const cancelRecording = (): void => {
    if (recorderRef.current?.state === 'recording') {
      discardRef.current = true
      recorderRef.current.stop()
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
    worker.terminateWorker()
    readyModelRef.current = null
    setStatus('idle')
  }

  const dismissConsent = (): void => setStatus('idle')

  // Delete a downloaded model from disk (trash icon in the model dialog).
  // If it's the one currently loaded, the worker goes with it.
  const deleteModel = async (target: VoiceModel): Promise<void> => {
    if (readyModelRef.current === target) {
      worker.terminateWorker()
      readyModelRef.current = null
      // The worker may have been mid-transcribe (the model dialog stays
      // reachable while a take is processing) - its 'result' will never
      // arrive now, so the status must be reset here or toggle() stays
      // blocked forever. A live recording is discarded the usual way.
      if (statusRef.current === 'recording') {
        cancelRecording()
      } else if (statusRef.current !== 'idle') {
        setStatus('idle')
        statusRef.current = 'idle'
      }
    }
    await deleteModelDownload(target)
  }

  useEffect(() => {
    return () => {
      // Stop a live recording so the microphone (the MediaStream's tracks,
      // released in the recorder's onstop) actually turns off - nothing else
      // here touches it. discardRef makes onstop throw the take away instead
      // of posting a transcribe to the just-terminated worker.
      if (recorderRef.current?.state === 'recording') {
        discardRef.current = true
        recorderRef.current.stop()
      }
      // The worker itself is terminated by useModelWorker's own cleanup.
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      levelCtxRef.current?.close()
      levelCtxRef.current = null
    }
  }, [])

  return {
    status,
    progress,
    analyser,
    toggle,
    cancelRecording,
    confirmDownload,
    cancelDownload,
    dismissConsent,
    deleteModel
  }
}
