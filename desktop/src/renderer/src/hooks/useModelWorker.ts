import { useEffect, useRef, useState } from 'react'

// The worker-lifecycle skeleton shared by the three model-backed features
// (dictation/Whisper, translate/Opus-NLLB, read-aloud/Piper). Each of them
// used to hand-roll the same four pieces:
//
// - lazy worker creation with an onerror that terminates and drops the
//   broken worker (a worker that fails to even start never sends a message,
//   and keeping it cached would wedge the feature forever),
// - an idle-unload timer that tears the worker (and its hundreds of MB of
//   loaded model) down after a long period without use,
// - per-file download-progress aggregation into one percentage,
// - terminate-and-reset, the only way to abort in-flight model downloads.
//
// The consent/status state machines stay in the feature hooks - they differ
// for real reasons; only the worker plumbing is shared.

const DEFAULT_IDLE_UNLOAD_MS = 30 * 60 * 1000

interface ModelWorkerOptions<Res> {
  create: () => Worker
  onMessage: (msg: Res) => void
  // Called after the broken worker was terminated and dropped - reset any
  // feature state ("model X is loaded" refs, status) and tell the user.
  onStartupError: (message: string) => void
  // Consulted when the idle timer fires; the worker is only unloaded when
  // this returns true (e.g. status === 'idle', nothing speaking).
  isIdle: () => boolean
  // Fired after the idle timer actually unloaded the worker - reset any
  // "model loaded" refs so the next use knows to load again.
  onIdleUnload?: () => void
  // Aggregated download progress, 0-100.
  onProgress: (percent: number) => void
  idleUnloadMs?: number
}

export interface ModelWorkerHandle {
  // Creates the worker on first use; safe to call repeatedly.
  getWorker: () => Worker
  hasWorker: () => boolean
  // Terminate + drop + clear the idle timer. The caller resets its own
  // feature state (ready refs, status) - this only owns the worker.
  terminateWorker: () => void
  // (Re)arm the idle-unload timer; call whenever the worker finishes work.
  scheduleIdleUnload: () => void
  // Start a fresh download-progress aggregation (new load). Deliberately
  // does not emit onProgress(0): read-aloud renders "no download" as null,
  // and a forced zero would flash a bogus "0%" badge. Callers that show a
  // bar from the start reset their own progress state alongside.
  resetProgress: () => void
  // One file's progress tick; aggregates across files into onProgress.
  reportFileProgress: (file: string, loaded: number, total: number) => void
}

export function useModelWorker<Res>(options: ModelWorkerOptions<Res>): ModelWorkerHandle {
  const workerRef = useRef<Worker | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressPerFileRef = useRef<Map<string, { loaded: number; total: number }>>(new Map())

  // The worker's handlers are attached once per worker; read the latest
  // callbacks through a ref so they never act on a stale render's state.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  // Built exactly once via the useState initializer (a lazy-init ref would
  // mean reading a ref during render); every method closes over the refs
  // above and only dereferences them when called, from event handlers.
  const [handle] = useState<ModelWorkerHandle>(() => {
    const clearIdleTimer = (): void => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }

    return {
      getWorker: () => {
        if (!workerRef.current) {
          const worker = optionsRef.current.create()
          worker.onmessage = (e: MessageEvent<Res>) => optionsRef.current.onMessage(e.data)
          worker.onerror = (e: ErrorEvent) => {
            worker.terminate()
            if (workerRef.current === worker) workerRef.current = null
            optionsRef.current.onStartupError(e.message || 'worker error (see DevTools)')
          }
          workerRef.current = worker
        }
        return workerRef.current
      },
      hasWorker: () => workerRef.current !== null,
      terminateWorker: () => {
        workerRef.current?.terminate()
        workerRef.current = null
        clearIdleTimer()
      },
      scheduleIdleUnload: () => {
        clearIdleTimer()
        idleTimerRef.current = setTimeout(() => {
          idleTimerRef.current = null
          if (workerRef.current && optionsRef.current.isIdle()) {
            workerRef.current.terminate()
            workerRef.current = null
            optionsRef.current.onIdleUnload?.()
          }
        }, optionsRef.current.idleUnloadMs ?? DEFAULT_IDLE_UNLOAD_MS)
      },
      resetProgress: () => {
        progressPerFileRef.current = new Map()
      },
      reportFileProgress: (file, loaded, total) => {
        progressPerFileRef.current.set(file, { loaded, total })
        let loadedSum = 0
        let totalSum = 0
        for (const f of progressPerFileRef.current.values()) {
          loadedSum += f.loaded
          totalSum += f.total
        }
        if (totalSum > 0) optionsRef.current.onProgress(Math.round((loadedSum / totalSum) * 100))
      }
    }
  })

  useEffect(() => {
    return () => {
      handle.terminateWorker()
    }
  }, [])

  return handle
}
