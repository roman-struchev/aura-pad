import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  onClose: () => void
  children: React.ReactNode
  width?: string
  height?: string
  // When set, the dialog renders a header row with this title and a close (✕)
  // button - the standard way to dismiss a dialog, so consumers no longer need
  // their own "Done"/"Close" footer button.
  title?: string
  // Overrides the default padded, vertically scrolling body wrapper - e.g. the
  // settings dialog uses a two-pane row layout that scrolls only its content
  // pane.
  bodyClassName?: string
}

// Open modals in mount order. Every instance listens for Escape on window,
// so without this, stacked dialogs (e.g. a voice-config dialog opened from
// Settings) would close bottom-first - whichever registered its listener
// earlier. Escape (and the Tab focus trap below) must only act on the
// topmost one.
const modalStack: symbol[] = []

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Shared overlay + card used by every dialog in the app (rename/create/
// settings/confirm/alert), so backdrop-click-to-close, Escape-to-close, and
// keyboard focus handling behave the same everywhere instead of being
// reimplemented ad hoc per dialog.
export const Modal: React.FC<ModalProps> = ({
  onClose,
  children,
  width = 'w-80',
  height,
  title,
  bodyClassName
}) => {
  const stackIdRef = useRef(Symbol('modal'))
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = stackIdRef.current
    modalStack.push(id)
    return () => {
      const index = modalStack.indexOf(id)
      if (index >= 0) modalStack.splice(index, 1)
    }
  }, [])

  // Move focus into the dialog on open and restore it on close, so keyboard
  // and screen-reader users aren't left on a now-hidden element behind the
  // overlay. A dialog that wants a specific control focused marks it with
  // [data-autofocus] (e.g. the rename input); otherwise the first focusable
  // element wins. Focus isn't stolen if the dialog already placed it inside
  // (the rename input also selects its text via its own effect).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const card = cardRef.current
    if (card && !card.contains(document.activeElement)) {
      const preferred = card.querySelector<HTMLElement>('[data-autofocus]')
      const target = preferred ?? card.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      target?.focus()
    }
    return () => {
      // Only restore if focus is still inside this dialog - if the user
      // clicked elsewhere first, don't yank it back.
      if (card?.contains(document.activeElement)) previouslyFocused?.focus?.()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isTopmost = modalStack[modalStack.length - 1] === stackIdRef.current
      if (!isTopmost) return
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Trap Tab within the dialog: Tab off the last focusable wraps to the
      // first, Shift+Tab off the first wraps to the last, so focus can never
      // land on the app behind the overlay.
      if (e.key === 'Tab') {
        const card = cardRef.current
        if (!card) return
        const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement
        )
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !card.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className={`bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden ${width} ${height || ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-fleet-border shrink-0">
            <span className="text-sm font-medium text-fleet-text truncate">{title}</span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 -mr-1 rounded text-gray-400 hover:text-fleet-textHover hover:bg-fleet-active transition-colors shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className={bodyClassName ?? 'p-4 flex flex-col flex-1 min-h-0 overflow-y-auto'}>
          {children}
        </div>
      </div>
    </div>
  )
}
