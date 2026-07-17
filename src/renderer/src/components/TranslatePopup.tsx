import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as monaco from 'monaco-editor'
import { Check, Copy, X } from 'lucide-react'
import type { TranslatePopupState } from '../hooks/useTranslate'

interface TranslatePopupProps {
  editor: monaco.editor.IStandaloneCodeEditor
  popup: TranslatePopupState
  onReplace: () => void
  onClose: () => void
}

// The translation result, anchored under the selection as a Monaco content
// widget: Monaco keeps it positioned through scrolling/layout and hides it
// when the anchor leaves the viewport, while the widget's DOM node is filled
// through a React portal so the streaming text and buttons are plain React.
// Dismissed by Escape (App's keydown handler), a click outside, any edit, or
// switching files - which is also what keeps sourceRange valid for Replace.
export const TranslatePopup: React.FC<TranslatePopupProps> = ({
  editor,
  popup,
  onReplace,
  onClose
}) => {
  const [copied, setCopied] = useState(false)
  // The widget's DOM node, created once - Monaco positions it, the portal
  // renders into it.
  const [node] = useState(() => document.createElement('div'))
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Read by listeners registered once per editor, so they see current values.
  const anchorRef = useRef(popup.anchor)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    anchorRef.current = popup.anchor
    onCloseRef.current = onClose
  })

  const widgetRef = useRef<monaco.editor.IContentWidget | null>(null)
  useEffect(() => {
    const widget: monaco.editor.IContentWidget = {
      getId: () => 'aurapad.translate-popup',
      getDomNode: () => node,
      getPosition: () => ({
        position: anchorRef.current,
        preference: [
          monaco.editor.ContentWidgetPositionPreference.BELOW,
          monaco.editor.ContentWidgetPositionPreference.ABOVE
        ]
      }),
      // Keep the widget inside the editor area: with overflow allowed it
      // renders in a page-level overlay and can cover the sidebar/tab bar.
      // Monaco clamps it into the viewport and flips below/above instead.
      allowEditorOverflow: false
    }
    widgetRef.current = widget
    editor.addContentWidget(widget)
    const subscriptions = [
      editor.onDidChangeModelContent(() => onCloseRef.current()),
      editor.onDidChangeModel(() => onCloseRef.current()),
      editor.onDidDispose(() => onCloseRef.current())
    ]
    return () => {
      subscriptions.forEach((s) => s.dispose())
      try {
        editor.removeContentWidget(widget)
      } catch {
        // The editor may already be disposed (file closed, preview toggled).
      }
    }
  }, [editor, node])

  // Growing text can change the widget's height (and flip it below/above);
  // keep Monaco's placement current, and keep the streaming tail in view.
  useEffect(() => {
    if (widgetRef.current) editor.layoutContentWidget(widgetRef.current)
    if (popup.streaming && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [editor, popup.text, popup.streaming, popup.notice])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (!node.contains(e.target as Node)) onCloseRef.current()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [node])

  const copy = (): void => {
    navigator.clipboard.writeText(popup.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return createPortal(
    <div
      className="w-[26rem] max-w-[80vw] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl text-fleet-text"
      // Keep clicks inside the popup away from Monaco (which would move the
      // cursor / clear the selection under the popup).
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 tracking-wide shrink-0">
          {popup.from.toUpperCase()} → {popup.to.toUpperCase()}
        </span>
        {popup.notice && (
          <span className="text-[11px] text-yellow-500 truncate" title={popup.notice}>
            {popup.notice}
          </span>
        )}
        <button
          className="ml-auto p-1 rounded text-gray-500 hover:text-fleet-text hover:bg-fleet-active shrink-0"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>
      <div ref={bodyRef} className="px-3 py-2 max-h-56 overflow-y-auto text-xs whitespace-pre-wrap">
        {popup.text.length === 0 && popup.streaming ? (
          <span className="text-gray-500 italic">Translating…</span>
        ) : (
          popup.text
        )}
        {popup.streaming && popup.text.length > 0 && (
          <span className="inline-block w-1.5 h-3 ml-0.5 align-text-bottom bg-blue-500 animate-pulse" />
        )}
      </div>
      <div className="flex justify-end gap-2 px-3 pb-2">
        <button
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-fleet-active text-gray-400 disabled:opacity-50"
          disabled={popup.streaming || popup.text.trim().length === 0}
          onClick={copy}
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          className="px-2 py-1 text-[11px] rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          disabled={popup.streaming || popup.text.trim().length === 0}
          onClick={onReplace}
        >
          Replace
        </button>
      </div>
    </div>,
    node
  )
}
