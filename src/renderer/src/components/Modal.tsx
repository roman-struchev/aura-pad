import React, { useEffect, useRef } from 'react'

interface ModalProps {
  onClose: () => void
  children: React.ReactNode
  width?: string
  height?: string
}

// Open modals in mount order. Every instance listens for Escape on window,
// so without this, stacked dialogs (e.g. a voice-config dialog opened from
// Settings) would close bottom-first - whichever registered its listener
// earlier. Escape must only close the topmost one.
const modalStack: symbol[] = []

// Shared overlay + card used by every dialog in the app (rename/create/
// settings/confirm/alert), so backdrop-click-to-close and Escape-to-close
// behave the same everywhere instead of being reimplemented ad hoc per dialog.
export const Modal: React.FC<ModalProps> = ({ onClose, children, width = 'w-80', height }) => {
  const stackIdRef = useRef(Symbol('modal'))
  useEffect(() => {
    const id = stackIdRef.current
    modalStack.push(id)
    return () => {
      const index = modalStack.indexOf(id)
      if (index >= 0) modalStack.splice(index, 1)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === stackIdRef.current) onClose()
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
        className={`bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl p-4 flex flex-col max-h-[85vh] overflow-y-auto ${width} ${height || ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
