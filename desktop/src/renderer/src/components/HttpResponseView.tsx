import React, { useMemo, useState } from 'react'
import { Check, Copy, Loader2, Terminal, WrapText, X } from 'lucide-react'
import clsx from 'clsx'
import { ToolbarButton } from './ToolbarButton'
import { prettyPrintMarkup } from '../lib/formatMarkup'
import { toCurl } from '../lib/http/curl'
import type { HttpExchange } from '../hooks/useHttpClient'

interface HttpResponseViewProps {
  exchange: HttpExchange
  onCancel: () => void
  // Omitted where the response has no separate frame to dismiss (the HTTP
  // Client tab, which *is* the frame).
  onClose?: () => void
  // The row naming the request that was sent, with Cancel and Copy as cURL.
  // Beside the editor it is the only thing that says which request the
  // response belongs to; in the HTTP Client tab the form right above says it
  // already, and has both buttons of its own - so the row is off there
  // rather than repeating the URL and the curl a second time.
  showRequestBar?: boolean
}

type ViewTab = 'body' | 'headers' | 'request'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Status colors follow the class, not the exact code: green 2xx, blue 3xx,
// amber 4xx (your fault), red 5xx (theirs).
function statusClass(status: number): string {
  if (status >= 500) return 'bg-red-500/15 text-accent-error'
  if (status >= 400) return 'bg-amber-500/15 text-accent-warn'
  if (status >= 300) return 'bg-blue-500/15 text-accent-info'
  if (status >= 200) return 'bg-emerald-500/15 text-accent-ok'
  return 'bg-gray-500/15 text-fleet-text'
}

// Pretty-printing is best-effort by content type: JSON re-serialized with
// two-space indent, markup through the same formatter the editor's Format
// Document uses. Anything else is shown exactly as it arrived.
function prettify(body: string, contentType: string | null): string | null {
  const type = contentType ?? ''
  if (type.includes('json') || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      return null
    }
  }
  if (type.includes('xml') || type.includes('html')) {
    try {
      return prettyPrintMarkup(body)
    } catch {
      return null
    }
  }
  return null
}

// The response side of the HTTP client: status line, body, headers, and what
// was actually sent. Deliberately plain DOM rather than a second Monaco
// instance - a read-only viewer doesn't need a full editor, and one editor
// per response would cost a model and a set of workers each time.
// The response itself: status line, body, headers, and the request that was
// sent. Shared by the pane beside the editor and the HTTP Client tab, which
// differ only in the frame around this.
//
// Deliberately plain DOM rather than a second Monaco instance - a read-only
// viewer doesn't need a full editor, and one editor per response would cost a
// model and a set of workers each time.
export const HttpResponseView: React.FC<HttpResponseViewProps> = ({
  exchange,
  onCancel,
  onClose,
  showRequestBar = true
}) => {
  const [tab, setTab] = useState<ViewTab>('body')
  const [raw, setRaw] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  const response = exchange.response
  const pretty = useMemo(
    () => (response ? prettify(response.body, response.contentType) : null),
    [response]
  )
  const shownBody = response ? (!raw && pretty ? pretty : response.body) : ''

  const copy = (what: string, text: string): void => {
    navigator.clipboard.writeText(text)
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1200)
  }

  const imageSource =
    response?.bodyBase64 && response.contentType?.startsWith('image/')
      ? `data:${response.contentType};base64,${response.bodyBase64}`
      : null

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="http-response-view">
      {showRequestBar && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-fleet-border">
          <span className="text-[11px] text-gray-400 truncate flex-1" title={exchange.title}>
            {exchange.title}
          </span>
          {exchange.running && (
            <button
              className="text-[11px] px-1.5 py-0.5 rounded text-fleet-text hover:bg-fleet-active"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          {exchange.spec && (
            <ToolbarButton
              dense
              title="Copy as cURL"
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => exchange.spec && copy('curl', toCurl(exchange.spec))}
            >
              {copied === 'curl' ? <Check size={14} /> : <Terminal size={14} />}
            </ToolbarButton>
          )}
          {onClose && (
            <ToolbarButton
              dense
              title="Close"
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={onClose}
            >
              <X size={14} />
            </ToolbarButton>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-fleet-border text-[11px]">
        {exchange.running ? (
          <span className="flex items-center gap-1.5 text-gray-400">
            <Loader2 size={12} className="animate-spin" />
            Sending…
          </span>
        ) : response ? (
          <>
            <span
              className={clsx('px-1.5 py-0.5 rounded font-medium', statusClass(response.status))}
            >
              {response.status}
              {response.statusText ? ` ${response.statusText}` : ''}
            </span>
            <span className="text-gray-400">{response.timings.totalMs} ms</span>
            <span className="text-gray-400">{formatBytes(response.bodyBytes)}</span>
            {response.redirects > 0 && (
              <span className="text-gray-500" title={response.finalUrl}>
                {response.redirects} redirect{response.redirects > 1 ? 's' : ''}
              </span>
            )}
          </>
        ) : (
          <span className="px-1.5 py-0.5 rounded font-medium bg-red-500/15 text-accent-error">
            {exchange.cancelled ? 'Cancelled' : 'Failed'}
          </span>
        )}
      </div>

      {exchange.error && (
        <div className="px-3 py-2 text-[12px] text-accent-error whitespace-pre-wrap break-words">
          {exchange.error}
        </div>
      )}

      {response && (
        <>
          <div className="flex items-center gap-1 px-2 pt-1.5 text-[11px]">
            {(['body', 'headers', 'request'] as ViewTab[]).map((id) => (
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
                {id === 'headers' ? `Headers (${response.headers.length})` : id}
              </button>
            ))}
            <div className="flex-1" />
            {tab === 'body' && pretty && (
              <button
                onClick={() => setRaw((r) => !r)}
                className={clsx(
                  'px-2 py-1 rounded',
                  raw
                    ? 'text-gray-400 hover:text-fleet-textHover'
                    : 'bg-fleet-active text-fleet-textHover'
                )}
                title="Pretty-print the body"
              >
                Format
              </button>
            )}
            <ToolbarButton
              dense
              title={wrap ? 'No wrap' : 'Wrap lines'}
              tooltipAlign="right"
              active={wrap}
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() => setWrap((w) => !w)}
            >
              <WrapText size={14} />
            </ToolbarButton>
            <ToolbarButton
              dense
              title={tab === 'headers' ? 'Copy headers' : 'Copy body'}
              tooltipAlign="right"
              colorClassName="text-gray-500 hover:text-fleet-textHover"
              onClick={() =>
                copy(
                  'content',
                  tab === 'headers'
                    ? response.headers.map((h) => `${h.name}: ${h.value}`).join('\n')
                    : tab === 'request' && exchange.spec
                      ? toCurl(exchange.spec)
                      : shownBody
                )
              }
            >
              {copied === 'content' ? <Check size={14} /> : <Copy size={14} />}
            </ToolbarButton>
          </div>

          <div className="flex-1 overflow-auto px-3 py-2 text-[12px] font-mono">
            {tab === 'body' && (
              <>
                {response.truncated && (
                  <div className="mb-2 text-accent-warn/80 text-[11px] font-sans">
                    Response truncated at {formatBytes(response.bodyBytes)}.
                  </div>
                )}
                {imageSource ? (
                  <img src={imageSource} alt="Response body" className="max-w-full" />
                ) : shownBody ? (
                  <pre
                    data-testid="http-response-body"
                    className={clsx(
                      'leading-relaxed',
                      wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                    )}
                  >
                    {shownBody}
                  </pre>
                ) : (
                  <span className="text-gray-500 font-sans">
                    {response.bodyBytes > 0
                      ? `${formatBytes(response.bodyBytes)} of ${response.contentType ?? 'binary'} data`
                      : 'Empty body'}
                  </span>
                )}
              </>
            )}

            {tab === 'headers' && (
              <table className="w-full border-collapse" data-testid="http-response-headers">
                <tbody>
                  {response.headers.map((header, index) => (
                    <tr key={`${header.name}-${index}`} className="align-top">
                      <td className="pr-3 py-0.5 text-gray-400 whitespace-nowrap">{header.name}</td>
                      <td className="py-0.5 break-all">{header.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'request' && exchange.spec && (
              <pre className="whitespace-pre-wrap break-words leading-relaxed">
                {toCurl(exchange.spec)}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  )
}
