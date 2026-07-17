import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import TranslateWorker from '../lib/translate/translateWorker?worker'
import type { TranslateWorkerResponse } from '../lib/translate/translateWorker'
import {
  TRANSLATE_CATALOG,
  deleteDownload,
  downloadKey,
  isDownloaded,
  markDownloaded
} from '../lib/translate/models'
import { detectLanguage, type LangCode } from '../lib/langDetect'
import { chunkSentences } from '../lib/sentenceChunks'
import { alertDialog } from '../lib/dialogs'
import type { TranslateModel, TranslatePair } from '../../../shared/settings'

// 'consent' = waiting in the download dialog; 'downloading' = fetching model
// weights after the user confirmed; 'translating' = the popup is streaming.
export type TranslateStatus = 'idle' | 'consent' | 'downloading' | 'translating'

// Everything the popup widget renders. sourceRange is frozen at request time
// and stays valid because the popup closes on any edit or model switch.
export interface TranslatePopupState {
  from: LangCode
  to: LangCode
  sourceRange: monaco.Range
  anchor: monaco.IPosition
  text: string
  streaming: boolean
  notice: string | null
}

// Selection captured while the consent dialog decides; direction and chunks
// are recomputed at fire time since the dialog may switch the model or pair.
interface PendingRequest {
  text: string
  range: monaco.Range
  anchor: monaco.IPosition
  truncNotice: string | null
}

// Never merge sentences into one model call: Opus-MT is trained on single
// sentences and silently drops content from multi-sentence inputs (verified
// with opus-mt-en-ru: "Hello world. This is a test." loses the first
// sentence). One sentence per call is also what streams most naturally.
const NEVER_MERGE = (): boolean => false
const CHUNK_MAX_CHARS = 600
// Hard cap on how much of a selection gets translated - wasm latency on a
// whole file would be minutes, and the popup isn't the place for that much
// text anyway.
const MAX_SELECTION_CHARS = 5000
// A loaded model holds from a few hundred MB (Opus-MT) to well over a GB
// (NLLB) of RAM/VRAM; after this long without translating the worker is torn
// down (mirrors dictation/read-aloud).
const MODEL_IDLE_UNLOAD_MS = 30 * 60 * 1000

// Selection translation: translateSelection() detects which side of the
// configured pair the selected text is written in, translates towards the
// other side in a worker, and streams the result into a popup anchored at
// the selection. The first use of a model goes through a consent dialog
// (status 'consent') before anything is downloaded.
export function useTranslate(model: TranslateModel, pair: TranslatePair) {
  const [status, setStatus] = useState<TranslateStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [popup, setPopup] = useState<TranslatePopupState | null>(null)

  const workerRef = useRef<Worker | null>(null)
  // downloadKey() of the unit the worker has loaded, if any.
  const readyKeyRef = useRef<string | null>(null)
  // What 'ready' from the worker should do when there's no pending request:
  // 'idle' closes the consent-download dialog; 'none' leaves the status
  // alone - that's the load-behind-translate case, where the queued translate
  // already owns the status.
  const afterLoadRef = useRef<'idle' | 'none'>('none')
  const pendingRef = useRef<PendingRequest | null>(null)
  const idleUnloadRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressPerFileRef = useRef<Map<string, { loaded: number; total: number }>>(new Map())
  // The active translate request's id; worker messages for any other id are
  // stale (a closed popup) and dropped.
  const requestSeqRef = useRef(0)
  const requestIdRef = useRef<number | null>(null)
  // Separators to re-attach after each chunk, and how many chunks finished.
  const sepsRef = useRef<string[]>([])
  const chunkIndexRef = useRef(0)

  const statusRef = useRef<TranslateStatus>('idle')
  const popupRef = useRef<TranslatePopupState | null>(null)
  useEffect(() => {
    statusRef.current = status
    popupRef.current = popup
  })
  const modelRef = useRef(model)
  const pairRef = useRef(pair)
  useEffect(() => {
    modelRef.current = model
    pairRef.current = pair
  })

  // (Re)armed every time the worker finishes something; if half an hour
  // passes with no translation, drop the worker and its loaded models.
  const scheduleIdleUnload = (): void => {
    if (idleUnloadRef.current) clearTimeout(idleUnloadRef.current)
    idleUnloadRef.current = setTimeout(() => {
      if (statusRef.current === 'idle' && workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
        readyKeyRef.current = null
      }
    }, MODEL_IDLE_UNLOAD_MS)
  }

  const handleWorkerMessage = (msg: TranslateWorkerResponse): void => {
    switch (msg.type) {
      case 'progress': {
        // Only the .onnx weights are worth tracking - the config/tokenizer
        // files are tiny and would briefly show a misleading "100%" while
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
      case 'ready': {
        markDownloaded(msg.model, msg.pair)
        readyKeyRef.current = downloadKey(msg.model, msg.pair)
        const pending = pendingRef.current
        if (pending) {
          pendingRef.current = null
          beginRequest(msg.model, msg.pair, pending)
        } else if (afterLoadRef.current === 'idle') {
          setStatus('idle')
        }
        scheduleIdleUnload()
        break
      }
      case 'delta':
        if (msg.id !== requestIdRef.current) break
        setPopup((p) => (p ? { ...p, text: p.text + msg.text } : p))
        break
      case 'chunk-done': {
        if (msg.id !== requestIdRef.current) break
        const sep = sepsRef.current[chunkIndexRef.current] ?? ''
        chunkIndexRef.current += 1
        if (sep) setPopup((p) => (p ? { ...p, text: p.text + sep } : p))
        break
      }
      case 'done': {
        if (msg.id !== requestIdRef.current) break
        requestIdRef.current = null
        const text = msg.finals.map((f, i) => f + (sepsRef.current[i] ?? '')).join('')
        setPopup((p) => (p ? { ...p, text, streaming: false } : p))
        setStatus('idle')
        statusRef.current = 'idle'
        scheduleIdleUnload()
        break
      }
      case 'error':
        requestIdRef.current = null
        pendingRef.current = null
        setPopup(null)
        setStatus('idle')
        statusRef.current = 'idle'
        scheduleIdleUnload()
        alertDialog(
          msg.context === 'load'
            ? `Failed to load the translation model: ${msg.message}`
            : `Translation failed: ${msg.message}`
        )
        break
    }
  }

  const getWorker = (): Worker => {
    if (!workerRef.current) {
      const worker = new TranslateWorker()
      worker.onmessage = (e: MessageEvent<TranslateWorkerResponse>) => handleWorkerMessage(e.data)
      // A worker that fails to even start (script load/parse error) never
      // sends a message - without this the UI would hang forever.
      worker.onerror = (e: ErrorEvent) => {
        worker.terminate()
        workerRef.current = null
        readyKeyRef.current = null
        pendingRef.current = null
        setPopup(null)
        setStatus('idle')
        alertDialog(`Translation failed to start: ${e.message || 'worker error (see DevTools)'}`)
      }
      workerRef.current = worker
    }
    return workerRef.current
  }

  const loadUnit = (
    targetModel: TranslateModel,
    targetPair: TranslatePair,
    then: 'idle' | 'none'
  ): void => {
    afterLoadRef.current = then
    progressPerFileRef.current = new Map()
    setProgress(0)
    getWorker().postMessage({ type: 'load', model: targetModel, pair: targetPair })
  }

  // Detection, direction and chunking happen here (not at capture time) so a
  // model/pair switched in the consent dialog applies to the pending selection.
  const beginRequest = (
    targetModel: TranslateModel,
    targetPair: TranslatePair,
    req: PendingRequest
  ): void => {
    const info = TRANSLATE_CATALOG[targetPair]
    const detected = detectLanguage(req.text, [info.a, info.b])
    const from = detected === info.b ? info.b : info.a
    const to = detected === info.b ? info.a : info.b
    const notices: string[] = []
    if (detected === null)
      notices.push(
        `Language not recognized — translating ${from.toUpperCase()} → ${to.toUpperCase()}`
      )
    if (req.truncNotice) notices.push(req.truncNotice)

    // The online engine: one request for the whole selection via the main
    // process (no worker, no chunking - Google takes multi-sentence input
    // fine and the selection is already capped at MAX_SELECTION_CHARS).
    // No streaming either: the popup opens in its 'streaming' spinner state
    // and fills in with the full text when the response lands.
    if (targetModel === 'google-web') {
      const id = ++requestSeqRef.current
      requestIdRef.current = id
      sepsRef.current = []
      chunkIndexRef.current = 0
      setPopup({
        from,
        to,
        sourceRange: req.range,
        anchor: req.anchor,
        text: '',
        streaming: true,
        notice: notices.length > 0 ? notices.join(' · ') : null
      })
      setStatus('translating')
      statusRef.current = 'translating'
      window.api.translateGoogleWeb(req.text, from, to).then((res) => {
        // Stale id = the popup was closed while the request was in flight.
        if (requestIdRef.current !== id) return
        requestIdRef.current = null
        setStatus('idle')
        statusRef.current = 'idle'
        if (res.success && res.text !== undefined) {
          const text = res.text
          setPopup((p) => (p ? { ...p, text, streaming: false } : p))
        } else {
          setPopup(null)
          alertDialog(
            `Translation failed: ${res.error ?? 'unknown error'}. ` +
              'Google Translate needs an internet connection - the local models in Settings work offline.'
          )
        }
      })
      return
    }

    const chunks = chunkSentences(req.text, CHUNK_MAX_CHARS, NEVER_MERGE)
    if (chunks.length === 0) {
      setStatus('idle')
      return
    }
    const id = ++requestSeqRef.current
    requestIdRef.current = id
    sepsRef.current = chunks.map((c) => c.sep)
    chunkIndexRef.current = 0
    setPopup({
      from,
      to,
      sourceRange: req.range,
      anchor: req.anchor,
      text: '',
      streaming: true,
      notice: notices.length > 0 ? notices.join(' · ') : null
    })
    setStatus('translating')
    // Mirrored synchronously (the effect only syncs after a render) so a
    // rapid second trigger can't slip past translateSelection's idle check.
    statusRef.current = 'translating'
    getWorker().postMessage({
      type: 'translate',
      id,
      model: targetModel,
      pair: targetPair,
      from,
      to,
      chunks: chunks.map((c) => c.text)
    })
  }

  // The context-menu action / Option+Cmd+T. Non-empty selection only; while
  // busy (consent dialog open, downloading, already translating) it does
  // nothing.
  const translateSelection = (editor: monaco.editor.IStandaloneCodeEditor): void => {
    if (statusRef.current !== 'idle') return
    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection || selection.isEmpty()) return
    let text = model.getValueInRange(selection)
    let truncNotice: string | null = null
    if (text.length > MAX_SELECTION_CHARS) {
      // Cut at the last sentence boundary under the cap, so the model never
      // sees (and the user never reads) half a sentence.
      const head = text.slice(0, MAX_SELECTION_CHARS)
      let cut = -1
      for (const m of head.matchAll(/[.!?…]\s/g)) cut = m.index + 1
      text = cut > 0 ? head.slice(0, cut) : head
      truncNotice = `Long selection — only the first ~${text.length.toLocaleString()} characters were translated`
    }
    if (!text.trim()) return
    const req: PendingRequest = {
      text,
      range: monaco.Range.lift(selection),
      anchor: selection.getEndPosition(),
      truncNotice
    }
    const targetModel = modelRef.current
    const targetPair = pairRef.current
    // Online engine: nothing to download or load, but the first use goes
    // through the same consent dialog - here it's consent to sending the
    // selection to Google rather than to a download.
    if (targetModel === 'google-web') {
      if (isDownloaded(targetModel, targetPair)) {
        beginRequest(targetModel, targetPair, req)
      } else {
        pendingRef.current = req
        setStatus('consent')
      }
      return
    }
    if (readyKeyRef.current === downloadKey(targetModel, targetPair)) {
      beginRequest(targetModel, targetPair, req)
    } else if (isDownloaded(targetModel, targetPair)) {
      // Model on disk but not in memory yet: post the load and the translate
      // together - the worker runs its messages strictly in order, so the
      // translate simply queues behind the load and the popup streams as soon
      // as the model is up.
      loadUnit(targetModel, targetPair, 'none')
      beginRequest(targetModel, targetPair, req)
    } else {
      pendingRef.current = req
      setStatus('consent')
    }
  }

  // The popup's Replace button: swap the original selection for the
  // translation in a single undo step.
  const replaceSelection = (editor: monaco.editor.IStandaloneCodeEditor): void => {
    const p = popupRef.current
    if (!p || p.streaming) return
    editor.executeEdits('translate', [
      { range: p.sourceRange, text: p.text, forceMoveMarkers: true }
    ])
    // The edit itself also closes the popup via its content-change listener;
    // closePopup is idempotent.
    closePopup()
    editor.focus()
  }

  const closePopup = (): void => {
    requestIdRef.current = null
    // Drops any not-yet-translated chunks; a chunk mid-inference finishes
    // silently (its output is filtered out by the request id).
    workerRef.current?.postMessage({ type: 'cancel' })
    setPopup(null)
    if (statusRef.current === 'translating') {
      setStatus('idle')
      statusRef.current = 'idle'
    }
    scheduleIdleUnload()
  }

  // Consent dialog confirmed - start the actual download. The dialog may
  // have picked a different model/pair than the ones the selection was
  // captured under; beginRequest re-detects against what 'ready' reports.
  const confirmDownload = (targetModel: TranslateModel, targetPair: TranslatePair): void => {
    // Online engine: nothing to download - record the consent and, if a
    // selection was waiting on the dialog, translate it right away.
    if (targetModel === 'google-web') {
      markDownloaded(targetModel, targetPair)
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        beginRequest(targetModel, targetPair, pending)
      } else {
        setStatus('idle')
      }
      return
    }
    setStatus('downloading')
    loadUnit(targetModel, targetPair, 'idle')
  }

  // Cancel mid-download: terminating the worker is the only way to abort the
  // in-flight fetches. Files that finished downloading stay in the cache, so
  // retrying later resumes from where it left off.
  const cancelDownload = (): void => {
    workerRef.current?.terminate()
    workerRef.current = null
    readyKeyRef.current = null
    pendingRef.current = null
    setStatus('idle')
  }

  const dismissConsent = (): void => {
    pendingRef.current = null
    setStatus('idle')
  }

  // Delete a downloaded unit from disk (trash icon in the dialog). If it's
  // the one currently loaded, the worker goes with it.
  const deleteUnit = async (
    targetModel: TranslateModel,
    targetPair: TranslatePair
  ): Promise<void> => {
    if (readyKeyRef.current === downloadKey(targetModel, targetPair)) {
      workerRef.current?.terminate()
      workerRef.current = null
      readyKeyRef.current = null
      // The worker may have been mid-translate (the settings dialog stays
      // reachable while the popup streams) - its 'done' will never arrive
      // now, so close the popup and free the status here or
      // translateSelection stays blocked forever.
      if (statusRef.current === 'translating') {
        requestIdRef.current = null
        setPopup(null)
        setStatus('idle')
        statusRef.current = 'idle'
      }
    }
    await deleteDownload(targetModel, targetPair)
  }

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      if (idleUnloadRef.current) clearTimeout(idleUnloadRef.current)
    }
  }, [])

  return {
    status,
    progress,
    popup,
    translateSelection,
    replaceSelection,
    closePopup,
    confirmDownload,
    cancelDownload,
    dismissConsent,
    deleteUnit
  }
}
