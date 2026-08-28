import React, { useEffect, useState } from 'react'
import {
  ClipboardPaste,
  FilePlus2,
  History,
  Loader2,
  Plus,
  Send,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import clsx from 'clsx'
import {
  DEFAULT_TIMEOUT_MS,
  type HttpHistoryEntry,
  type HttpRequestSpec
} from '../../../shared/http'
import type { AppSettings, HttpScratchRequest } from '../../../shared/settings'
import { HttpResponseView } from './HttpResponseView'
import { ToolbarButton } from './ToolbarButton'
import { looksLikeCurl, parseCurl, toCurl } from '../lib/http/curl'
import { useStableCallback } from '../lib/useStableCallback'
import type { HttpExchange } from '../hooks/useHttpClient'

interface HttpClientTabProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  exchange?: HttpExchange
  onSend: (spec: HttpRequestSpec) => void
  onCancel: () => void
  // Hand the request to App, which asks where to put it and appends it to
  // that .http file - the point where a one-off becomes part of the repo.
  onSaveToFile: (spec: HttpRequestSpec) => void
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

// Coarse enough to read at a glance ("3h ago"), exact enough to tell this
// morning's call from last week's.
function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(timestamp).toLocaleDateString()
}

// The path (with query) is what distinguishes two calls to the same API; the
// host is the same for a whole session's worth of entries - except when the
// path is all there is to a URL, and a list of bare "/" rows tells nobody
// which request is which.
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`
    return path === '/' || path === '' ? parsed.host : path
  } catch {
    return url
  }
}

function historyStatusClass(entry: HttpHistoryEntry): string {
  if (entry.error) return 'text-red-300'
  if (entry.status && entry.status >= 400) return 'text-amber-300'
  return 'text-emerald-300'
}

// A one-off request that isn't worth a file: method, URL, headers and body in
// a form, the response right below it. Everything else about the HTTP client
// (parsing, sending, the response viewer) is shared with the .http files -
// this tab only builds the same HttpRequestSpec by hand.
export const HttpClientTab: React.FC<HttpClientTabProps> = ({
  settings,
  updateSetting,
  exchange,
  onSend,
  onCancel,
  onSaveToFile
}) => {
  const saved = settings.extensions.httpClient.request
  const [method, setMethod] = useState(saved.method)
  const [url, setUrl] = useState(saved.url)
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>(saved.headers)
  const [body, setBody] = useState(saved.body)
  const [followRedirects, setFollowRedirects] = useState(saved.followRedirects)
  const [insecure, setInsecure] = useState(saved.insecure)
  const [tab, setTab] = useState<'headers' | 'body'>('headers')
  const [importError, setImportError] = useState<string | null>(null)
  const [history, setHistory] = useState<HttpHistoryEntry[]>([])

  const running = !!exchange?.running
  const historyCollapsed = settings.extensions.httpClient.historyCollapsed
  const setHistoryCollapsed = (collapsed: boolean): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...settings.extensions.httpClient, historyCollapsed: collapsed }
    })

  // Reloaded when the tab mounts and after each request settles - main
  // records the history for *both* routes into the client, so a request run
  // from a .http file shows up here too, next time this list is read.
  useEffect(() => {
    if (running) return
    window.api.httpHistory().then(setHistory)
  }, [running, exchange?.requestId])
  const canSend = url.trim().length > 0 && !running

  const buildSpec = (): HttpRequestSpec => ({
    method,
    url: url.trim(),
    // Half-typed rows (a name with no value yet, or an empty row waiting for
    // input) are part of editing, not of the request.
    headers: headers.filter((h) => h.name.trim() !== ''),
    body: body.trim() === '' ? undefined : body,
    followRedirects,
    insecure,
    timeoutMs: DEFAULT_TIMEOUT_MS
  })

  const persist = (): void => {
    const request: HttpScratchRequest = { method, url, headers, body, followRedirects, insecure }
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...settings.extensions.httpClient, request }
    })
  }

  // The form is only written to settings on send, so leaving the tab (which
  // unmounts it) would otherwise discard an unsent draft.
  const persistNow = useStableCallback(persist)
  useEffect(() => () => persistNow(), [persistNow])

  // Everything the entry holds lands back in the form, so Send re-runs the
  // same request rather than an emptied-out version of it. Two shapes the
  // form has no field for (`-d @file` and multipart parts) are called out
  // instead of being dropped in silence - they are the difference between a
  // request that repeats and one that only looks like it.
  const loadFromHistory = (entry: HttpHistoryEntry): void => {
    const { spec } = entry
    setMethod(spec.method)
    setUrl(spec.url)
    setHeaders(spec.headers)
    setBody(spec.body ?? '')
    setFollowRedirects(spec.followRedirects)
    setInsecure(spec.insecure)
    const unsupported = spec.bodyFilePath
      ? `Body came from a file (${spec.bodyFilePath}) - it is not part of this form`
      : spec.form
        ? 'The multipart form parts of this request are not editable here'
        : null
    setImportError(unsupported)
    // A filled-in body is invisible while the Headers tab is up, which reads
    // as "the body was lost".
    if (spec.body || spec.bodyFilePath || spec.form) setTab('body')
  }

  const send = (): void => {
    if (!canSend) return
    // Saved on send rather than on every keystroke: the form lives in
    // settings.json, and persisting each character would write it constantly.
    persist()
    onSend(buildSpec())
  }

  // A curl command from anywhere (a terminal, a colleague, browser devtools)
  // becomes a filled-in form - the same parser the editor's Run uses, so what
  // runs here is what would run there. Whitespace around it is whatever the
  // terminal wrapped the command in, not part of it.
  const applyCurl = (text: string): boolean => {
    const parsed = parseCurl(text.trim(), null)
    if (!parsed.ok) {
      setImportError(parsed.error)
      return false
    }
    setImportError(null)
    setMethod(parsed.spec.method)
    setUrl(parsed.spec.url)
    setHeaders(parsed.spec.headers)
    setBody(parsed.spec.body ?? '')
    setFollowRedirects(parsed.spec.followRedirects)
    setInsecure(parsed.spec.insecure)
    if (parsed.spec.body) setTab('body')
    return true
  }

  const importCurl = async (): Promise<void> => {
    setImportError(null)
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setImportError('Could not read the clipboard')
      return
    }
    if (text.trim() === '') {
      setImportError('The clipboard is empty')
      return
    }
    applyCurl(text)
  }

  const setHeaderAt = (index: number, patch: Partial<{ name: string; value: string }>): void =>
    setHeaders((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)))

  const checkbox = (
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void
  ): React.ReactElement => (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
      {label}
    </label>
  )

  return (
    <div className="h-full flex min-h-0" data-testid="http-client-tab">
      {/* Collapsed, the list is gone entirely rather than reduced to a rail:
          a strip holding one icon costs the form a column of width and buys
          nothing the toolbar's own toggle doesn't already say. */}
      {!historyCollapsed && (
        <div className="w-56 shrink-0 border-r border-fleet-border flex flex-col min-h-0">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fleet-border">
            <History size={13} className="text-gray-500" />
            <span className="text-[11px] uppercase tracking-wider text-gray-500 flex-1">
              History
            </span>
            {history.length > 0 && (
              <ToolbarButton
                dense
                title="Clear history"
                tooltipAlign="right"
                colorClassName="text-gray-500 hover:text-fleet-textHover"
                onClick={() => window.api.httpHistoryClear().then(setHistory)}
              >
                <Trash2 size={13} />
              </ToolbarButton>
            )}
          </div>
          <div className="flex-1 overflow-y-auto py-1" data-testid="http-history">
            {history.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-gray-500">
                Requests you send show up here
              </div>
            ) : (
              // No dividers between entries: at two lines each they read as
              // rows on their own, and a rule under every one turned the list
              // into a grid of lines with text in it.
              history.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => loadFromHistory(entry)}
                  title={`${entry.spec.method} ${entry.spec.url}`}
                  className="w-full text-left px-2 py-1 rounded-sm hover:bg-fleet-active"
                >
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-medium text-gray-400 shrink-0">{entry.spec.method}</span>
                    <span className="truncate flex-1 font-mono text-fleet-text">
                      {shortUrl(entry.spec.url)}
                    </span>
                    <span className={clsx('shrink-0', historyStatusClass(entry))}>
                      {entry.error ? '!' : (entry.status ?? '')}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 truncate">
                    {ago(entry.sentAt)}
                    {entry.durationMs !== undefined ? ` · ${entry.durationMs} ms` : ''}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="shrink-0 border-b border-fleet-border p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label="Method"
              className="bg-fleet-sidebar border border-fleet-border rounded px-2 py-1.5 text-xs text-fleet-text outline-none focus:border-blue-500"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
              // Pasting a whole curl command into the URL field is what
              // people try first - it lands as the request it describes
              // rather than as a URL that happens to start with "curl".
              // Anything that isn't one pastes normally.
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text')
                if (!looksLikeCurl(pasted)) return
                e.preventDefault()
                applyCurl(pasted)
              }}
              placeholder="https://api.example.com/items"
              aria-label="URL"
              spellCheck={false}
              className="flex-1 min-w-0 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1.5 text-xs font-mono text-fleet-text outline-none focus:border-blue-500"
            />
            <button
              onClick={running ? onCancel : send}
              disabled={!canSend && !running}
              className={clsx(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                running
                  ? 'bg-fleet-active text-fleet-text hover:text-fleet-textHover'
                  : canSend
                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                    : 'bg-fleet-active text-gray-500 cursor-not-allowed'
              )}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {running ? 'Cancel' : 'Send'}
            </button>
          </div>

          <div className="flex items-center gap-1 text-[11px]">
            {(['headers', 'body'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'px-2 py-1 rounded capitalize',
                  tab === id
                    ? 'bg-fleet-active text-fleet-textHover'
                    : 'text-gray-400 hover:text-fleet-textHover'
                )}
              >
                {id === 'headers' ? `Headers (${headers.filter((h) => h.name.trim()).length})` : id}
              </button>
            ))}
            <div className="flex-1" />
            {checkbox('Follow redirects', followRedirects, setFollowRedirects)}
            {checkbox('Ignore TLS errors', insecure, setInsecure)}
            <ToolbarButton
              dense
              title="Fill from a cURL command on the clipboard"
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={importCurl}
            >
              <ClipboardPaste size={14} />
            </ToolbarButton>
            <ToolbarButton
              dense
              title="Save as a request in a .http file"
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => onSaveToFile(buildSpec())}
            >
              <FilePlus2 size={14} />
            </ToolbarButton>
            <ToolbarButton
              dense
              title="Copy as cURL"
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => navigator.clipboard.writeText(toCurl(buildSpec()))}
            >
              <Terminal size={14} />
            </ToolbarButton>
            {/* Separated from the two beside it: those act on the request in
                the form, this one only decides what is on screen. */}
            <div className="w-px h-4 bg-fleet-border mx-1" />
            <ToolbarButton
              dense
              active={!historyCollapsed}
              title={historyCollapsed ? 'Show history' : 'Hide history'}
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => setHistoryCollapsed(!historyCollapsed)}
            >
              <History size={14} />
            </ToolbarButton>
          </div>

          {importError && <div className="text-[11px] text-red-300">{importError}</div>}

          {tab === 'headers' ? (
            <div className="flex flex-col gap-1">
              {headers.map((header, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={header.name}
                    onChange={(e) => setHeaderAt(index, { name: e.target.value })}
                    placeholder="Header"
                    aria-label={`Header ${index + 1} name`}
                    spellCheck={false}
                    className="w-52 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] font-mono text-fleet-text outline-none focus:border-blue-500"
                  />
                  <input
                    value={header.value}
                    onChange={(e) => setHeaderAt(index, { value: e.target.value })}
                    placeholder="Value"
                    aria-label={`Header ${index + 1} value`}
                    spellCheck={false}
                    className="flex-1 min-w-0 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] font-mono text-fleet-text outline-none focus:border-blue-500"
                  />
                  <ToolbarButton
                    dense
                    title="Remove header"
                    tooltipAlign="right"
                    colorClassName="text-gray-500 hover:text-fleet-textHover"
                    onClick={() => setHeaders((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <X size={13} />
                  </ToolbarButton>
                </div>
              ))}
              <button
                onClick={() => setHeaders((prev) => [...prev, { name: '', value: '' }])}
                className="self-start flex items-center gap-1 text-[11px] text-gray-400 hover:text-fleet-textHover px-1 py-0.5"
              >
                <Plus size={12} />
                Add header
              </button>
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{ "title": "hello" }'
              aria-label="Request body"
              spellCheck={false}
              rows={8}
              className="w-full bg-fleet-sidebar border border-fleet-border rounded px-2 py-1.5 text-[11px] font-mono text-fleet-text outline-none focus:border-blue-500 resize-y"
            />
          )}
        </div>

        <div className="flex-1 min-h-0">
          {exchange ? (
            // No request bar: the form above already names the request
            // and carries its own Copy as cURL.
            <HttpResponseView exchange={exchange} onCancel={onCancel} showRequestBar={false} />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-xs">
              Send a request to see the response here
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
