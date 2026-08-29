import React, { useEffect, useRef, useState } from 'react'
import {
  ClipboardPaste,
  ExternalLink,
  FilePlus2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
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
import { HttpEnvironmentsModal } from './HttpEnvironmentsModal'
import { ToolbarButton } from './ToolbarButton'
import { looksLikeCurl, parseCurl, toCurl } from '../lib/http/curl'
import { substitute } from '../lib/http/httpFile'
import { loadSavedRequests, type SavedRequest } from '../lib/http/savedRequests'
import { relativeToRoot } from '../lib/path'
import type { FileNode } from '../../../shared/fileNode'
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
  // The workspace trees: where the saved requests are read from, and what
  // their paths are shown relative to.
  rootNodes: FileNode[]
  // Open a saved request where it lives, at its request line.
  onOpenRequest: (filePath: string, line: number) => void
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
  onSaveToFile,
  rootNodes,
  onOpenRequest
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
  const [showEnvironments, setShowEnvironments] = useState(false)
  const [savedAll, setSavedAll] = useState<SavedRequest[] | null>(null)
  const [savedFilter, setSavedFilter] = useState('')
  const [savedReloads, setSavedReloads] = useState(0)

  const running = !!exchange?.running
  const environments = settings.extensions.httpClient.environments
  const environmentName = settings.extensions.httpClient.selectedEnvironment
  const environmentVariables = Object.fromEntries(
    (environments.find((e) => e.name === environmentName)?.variables ?? [])
      .filter((v) => v.name.trim() !== '')
      .map((v) => [v.name.trim(), v.value])
  )
  const panelCollapsed = settings.extensions.httpClient.sidePanelCollapsed
  const panelView = settings.extensions.httpClient.sidePanel
  const setPanelCollapsed = (collapsed: boolean): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...settings.extensions.httpClient, sidePanelCollapsed: collapsed }
    })

  const setPanelView = (view: 'history' | 'saved'): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...settings.extensions.httpClient, sidePanel: view }
    })

  // The trees change identity on every tree refresh, so the load reads them
  // through a ref: the list is re-read when the panel is opened on Saved and
  // when asked, not every time a watcher rebuilds the tree under it.
  const rootNodesRef = useRef(rootNodes)
  useEffect(() => {
    rootNodesRef.current = rootNodes
  })

  useEffect(() => {
    if (panelCollapsed || panelView !== 'saved') return
    let alive = true
    void loadSavedRequests(rootNodesRef.current, (path) => window.api.readFile(path)).then(
      (list) => {
        if (alive) setSavedAll(list)
      }
    )
    return () => {
      alive = false
    }
  }, [panelCollapsed, panelView, savedReloads])

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

  const selectEnvironment = (name: string): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...settings.extensions.httpClient, selectedEnvironment: name }
    })

  // {{name}} filled in from the selected environment - the same substitution
  // a .http file gets (and the same generated {{$uuid}}/{{$timestamp}}
  // values, which need no environment at all). The form keeps the
  // placeholders: they are what the user typed, and what a saved request
  // should still say tomorrow when it runs against another environment.
  const resolveSpec = (spec: HttpRequestSpec): { spec: HttpRequestSpec; missing: string[] } => {
    const missing: string[] = []
    const fill = (text: string): string => {
      const result = substitute(text, environmentVariables)
      missing.push(...result.missing)
      return result.text
    }
    return {
      spec: {
        ...spec,
        url: fill(spec.url),
        headers: spec.headers.map((h) => ({ name: fill(h.name), value: fill(h.value) })),
        body: spec.body === undefined ? undefined : fill(spec.body)
      },
      missing: [...new Set(missing)]
    }
  }

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
  const loadSpecIntoForm = (spec: HttpRequestSpec): void => {
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

  const loadFromHistory = (entry: HttpHistoryEntry): void => loadSpecIntoForm(entry.spec)

  // Same landing as a history entry: everything the request holds goes back
  // into the form, so Send re-runs that request and not a version of it with
  // the headers missing.
  const loadSaved = (entry: SavedRequest): boolean => {
    if (!entry.spec) {
      setImportError(entry.error ?? 'That request could not be read.')
      return false
    }
    loadSpecIntoForm(entry.spec)
    return true
  }

  // Run it where it is, without the trip through the form: the form still
  // gets filled in, so what was sent is on screen and can be edited and sent
  // again. A {{placeholder}} the file leaves to an environment is resolved
  // here, the same way Send does it.
  const runSaved = (entry: SavedRequest): void => {
    if (!loadSaved(entry) || !entry.spec) return
    const resolved = resolveSpec(entry.spec)
    if (resolved.missing.length > 0) {
      setImportError(
        `Undefined variable: ${resolved.missing.join(', ')}${
          environmentName ? '' : ' - no environment is selected'
        }`
      )
      return
    }
    onSend(resolved.spec)
  }

  const rootPaths = rootNodes.map((r) => r.path)
  const savedQuery = savedFilter.trim().toLowerCase()
  const savedRequests = (savedAll ?? []).filter((entry) =>
    savedQuery === ''
      ? true
      : `${entry.name} ${entry.method} ${entry.url} ${entry.file}`
          .toLowerCase()
          .includes(savedQuery)
  )

  const send = (): void => {
    if (!canSend) return
    const resolved = resolveSpec(buildSpec())
    // A request with an unfilled {{placeholder}} in it would go somewhere
    // nobody meant - to a URL with a hole in it, or with an empty token.
    // Naming what is missing beats sending it and showing a 401.
    if (resolved.missing.length > 0) {
      setImportError(
        `Undefined variable: ${resolved.missing.join(', ')}${
          environmentName ? '' : ' - no environment is selected'
        }`
      )
      return
    }
    setImportError(null)
    // Saved on send rather than on every keystroke: the form lives in
    // settings.json, and persisting each character would write it constantly.
    persist()
    onSend(resolved.spec)
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

  // Short labels with the full sentence on hover: these sit in a row that
  // already holds everything else the request needs, and "Follow redirects"
  // spelled out was two of the widest words in it.
  const checkbox = (
    label: string,
    title: string,
    checked: boolean,
    onChange: (value: boolean) => void
  ): React.ReactElement => (
    <label
      title={title}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-gray-400 cursor-pointer"
    >
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
      {!panelCollapsed && (
        <div className="w-56 shrink-0 border-r border-fleet-border flex flex-col min-h-0">
          {/* Two lists, one panel: what was sent, and what the project has
              written down. They answer different questions ("what did I just
              run" vs "what do we have for this API") and neither is worth a
              column of its own next to the form. */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-fleet-border">
            {(['history', 'saved'] as const).map((view) => (
              <button
                key={view}
                onClick={() => setPanelView(view)}
                className={clsx(
                  'px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wider',
                  panelView === view
                    ? 'bg-fleet-active text-fleet-textHover'
                    : 'text-gray-500 hover:text-fleet-textHover'
                )}
              >
                {view}
              </button>
            ))}
            <div className="flex-1" />
            {panelView === 'history' && history.length > 0 && (
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
            {panelView === 'saved' && (
              <ToolbarButton
                dense
                title="Re-read the request files"
                tooltipAlign="right"
                colorClassName="text-gray-500 hover:text-fleet-textHover"
                onClick={() => setSavedReloads((n) => n + 1)}
              >
                <RefreshCw size={13} />
              </ToolbarButton>
            )}
          </div>
          {panelView === 'history' && (
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
                      <span className="font-medium text-gray-400 shrink-0">
                        {entry.spec.method}
                      </span>
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
          )}

          {panelView === 'saved' && (
            <div className="flex-1 flex flex-col min-h-0" data-testid="http-saved">
              <div className="px-2 py-1.5">
                <input
                  value={savedFilter}
                  onChange={(e) => setSavedFilter(e.target.value)}
                  placeholder="Search saved"
                  aria-label="Search saved requests"
                  spellCheck={false}
                  className="w-full bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] text-fleet-text outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1 overflow-y-auto pb-1">
                {savedAll === null ? (
                  <div className="px-2 py-2 text-[11px] text-gray-500">Reading request files…</div>
                ) : savedRequests.length === 0 ? (
                  <div className="px-2 py-2 text-[11px] text-gray-500">
                    {savedAll.length === 0
                      ? 'Requests you save into .http files show up here'
                      : 'Nothing matches.'}
                  </div>
                ) : (
                  savedRequests.map((entry) => (
                    <div
                      key={entry.id}
                      data-saved-request={entry.name}
                      className="group flex items-center gap-0.5 px-1 rounded-sm hover:bg-fleet-active"
                    >
                      <button
                        onClick={() => loadSaved(entry)}
                        title={`${entry.method} ${entry.url}\n${entry.file}`}
                        className="flex-1 min-w-0 text-left px-1 py-1"
                      >
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="font-medium text-gray-400 shrink-0">{entry.method}</span>
                          <span className="truncate flex-1 text-fleet-text">{entry.name}</span>
                          {!entry.spec && <span className="text-amber-300 shrink-0">!</span>}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">
                          {relativeToRoot(entry.file, rootPaths)}
                        </div>
                      </button>
                      {/* Both actions on the row, revealed on hover: the panel
                          is narrow, and two permanent icons per line would
                          leave the names no width at all. */}
                      <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <ToolbarButton
                          dense
                          title="Run this request"
                          ariaLabel={`Run ${entry.name}`}
                          tooltipAlign="right"
                          colorClassName="text-gray-500 hover:text-fleet-textHover"
                          onClick={() => runSaved(entry)}
                        >
                          <Play size={12} />
                        </ToolbarButton>
                        <ToolbarButton
                          dense
                          title="Open where it is saved"
                          ariaLabel={`Open ${entry.name}`}
                          tooltipAlign="right"
                          colorClassName="text-gray-500 hover:text-fleet-textHover"
                          onClick={() => onOpenRequest(entry.file, entry.line)}
                        >
                          <ExternalLink size={12} />
                        </ToolbarButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showEnvironments && (
        <HttpEnvironmentsModal
          settings={settings}
          updateSetting={updateSetting}
          onClose={() => setShowEnvironments(false)}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="shrink-0 border-b border-fleet-border p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label="Method"
              className="shrink-0 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1.5 text-xs text-fleet-text outline-none focus:border-blue-500"
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
            <select
              value={environmentName}
              onChange={(e) => selectEnvironment(e.target.value)}
              aria-label="Environment"
              title="Fill {{placeholders}} from an environment"
              className="shrink-0 max-w-[9rem] bg-fleet-sidebar border border-fleet-border rounded px-1.5 py-1.5 text-[11px] text-fleet-text outline-none focus:border-blue-500"
            >
              {/* Short on purpose: it is the resting state of a picker
                  sitting between the URL and Send, where every pixel is
                  the URL's. */}
              <option value="">No env</option>
              {environments.map((env) => (
                <option key={env.name} value={env.name}>
                  {env.name}
                </option>
              ))}
              {/* A name the list no longer has (renamed or deleted in another
                  window) would otherwise show as blank while requests still
                  resolve against nothing. */}
              {environmentName && !environments.some((e) => e.name === environmentName) && (
                <option value={environmentName}>{environmentName} (missing)</option>
              )}
            </select>
            <ToolbarButton
              dense
              title="Edit environments"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => setShowEnvironments(true)}
            >
              <Settings2 size={14} />
            </ToolbarButton>
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

          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]">
            {/* First in the row because the panel it opens is immediately to
                its left: a control for something on one edge of the window
                does not belong on the other. It stopped being a clock when
                the panel stopped being only the history - it lists the
                project's saved requests too - so it is named and drawn as
                the panel it opens. */}
            <ToolbarButton
              dense
              active={!panelCollapsed}
              title={panelCollapsed ? 'Show the requests panel' : 'Hide the requests panel'}
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => setPanelCollapsed(!panelCollapsed)}
            >
              {panelCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </ToolbarButton>
            <div className="w-px h-4 bg-fleet-border mx-1" />
            {(['headers', 'body'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'shrink-0 whitespace-nowrap px-2 py-1 rounded capitalize',
                  tab === id
                    ? 'bg-fleet-active text-fleet-textHover'
                    : 'text-gray-400 hover:text-fleet-textHover'
                )}
              >
                {id === 'headers' ? `Headers (${headers.filter((h) => h.name.trim()).length})` : id}
              </button>
            ))}
            <div className="flex-1 min-w-0" />
            {checkbox('Redirects', 'Follow redirects', followRedirects, setFollowRedirects)}
            {checkbox('Ignore TLS', 'Ignore TLS certificate errors', insecure, setInsecure)}
            <div className="w-px h-4 bg-fleet-border mx-1" />
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
              // Resolved, so what lands in a terminal actually runs - unless
              // something is missing, in which case the placeholders are more
              // honest than blanks where the values should be.
              onClick={() => {
                const resolved = resolveSpec(buildSpec())
                navigator.clipboard.writeText(
                  toCurl(resolved.missing.length ? buildSpec() : resolved.spec)
                )
              }}
            >
              <Terminal size={14} />
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
