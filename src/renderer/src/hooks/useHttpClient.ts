import { useCallback, useMemo, useRef, useState } from 'react'
import type { HttpRequestSpec, HttpResponse } from '../../../shared/http'

// One in-flight-or-finished request per tab: opening the response pane is a
// property of the tab you ran the request from, so switching tabs and coming
// back finds the same response, and running again replaces it.

export interface HttpExchange {
  // null for a request that never left the renderer (a parse error).
  requestId: string | null
  // "POST https://api.example.com/tasks", shown in the pane header.
  title: string
  spec: HttpRequestSpec | null
  running: boolean
  response?: HttpResponse
  error?: string
  cancelled?: boolean
  sentAt: number
}

export interface HttpClient {
  exchanges: Record<string, HttpExchange>
  send: (key: string, spec: HttpRequestSpec) => Promise<void>
  showError: (key: string, title: string, error: string) => void
  cancel: (key: string) => void
  close: (key: string) => void
  prune: (openKeys: string[]) => void
}

function titleFor(spec: HttpRequestSpec): string {
  return `${spec.method} ${spec.url}`
}

export function useHttpClient(): HttpClient {
  const [exchanges, setExchanges] = useState<Record<string, HttpExchange>>({})
  // Monotonic per session; combined with the timestamp it identifies the
  // request to main for cancellation.
  const counter = useRef(0)
  // key -> requestId of whatever is still in flight. Kept outside React state
  // so Cancel/Close can read it without doing IPC inside a state updater
  // (updaters run twice under StrictMode - a request would be aborted twice).
  const inFlight = useRef<Record<string, string>>({})

  const send = useCallback(async (key: string, spec: HttpRequestSpec): Promise<void> => {
    // Re-running while the previous one is still streaming: its result is
    // already unwanted (the state slot below is about to be overwritten), so
    // stop it rather than leaving it to download in the background.
    const previous = inFlight.current[key]
    if (previous) window.api.httpCancel(previous)
    counter.current += 1
    const requestId = `${Date.now()}-${counter.current}`
    inFlight.current[key] = requestId
    setExchanges((prev) => ({
      ...prev,
      [key]: { requestId, title: titleFor(spec), spec, running: true, sentAt: Date.now() }
    }))

    const result = await window.api.httpSend(requestId, spec)
    if (inFlight.current[key] === requestId) delete inFlight.current[key]

    setExchanges((prev) => {
      const current = prev[key]
      // A newer request from the same tab already took this slot: its result
      // is the one the user is waiting for, so drop this late arrival.
      if (!current || current.requestId !== requestId) return prev
      return {
        ...prev,
        [key]: result.success
          ? { ...current, running: false, response: result.response }
          : { ...current, running: false, error: result.error, cancelled: result.cancelled }
      }
    })
  }, [])

  // A request that failed to parse still opens the pane - that's where the
  // user is looking, and "-o is not supported here" belongs next to the run
  // button, not in a toast that disappears.
  const showError = useCallback((key: string, title: string, error: string): void => {
    delete inFlight.current[key]
    setExchanges((prev) => ({
      ...prev,
      [key]: { requestId: null, title, spec: null, running: false, error, sentAt: Date.now() }
    }))
  }, [])

  const cancel = useCallback((key: string): void => {
    const requestId = inFlight.current[key]
    if (requestId) window.api.httpCancel(requestId)
  }, [])

  const close = useCallback((key: string): void => {
    const requestId = inFlight.current[key]
    if (requestId) {
      window.api.httpCancel(requestId)
      delete inFlight.current[key]
    }
    setExchanges((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  // Responses belong to their tab: once it is closed there is no way back to
  // one, and a body can be megabytes. Driven by the open-tab list rather than
  // by each close path, because closing can be declined at the unsaved-changes
  // prompt (and tabs also disappear when their file is deleted).
  const prune = useCallback((openKeys: string[]): void => {
    const open = new Set(openKeys)
    for (const [key, requestId] of Object.entries(inFlight.current)) {
      if (open.has(key)) continue
      window.api.httpCancel(requestId)
      delete inFlight.current[key]
    }
    setExchanges((prev) => {
      const stale = Object.keys(prev).filter((key) => !open.has(key))
      if (!stale.length) return prev
      const next = { ...prev }
      for (const key of stale) delete next[key]
      return next
    })
  }, [])

  // Memoized so callers can depend on the client itself in an effect without
  // re-running it on every render (the prune effect in App does exactly that).
  return useMemo(
    () => ({ exchanges, send, showError, cancel, close, prune }),
    [exchanges, send, showError, cancel, close, prune]
  )
}
