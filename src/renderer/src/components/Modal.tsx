import React, { useEffect } from 'react'

interface ModalProps {
  onClose: () => void
  children: React.ReactNode
  width?: string
}

// Shared overlay + card used by every dialog in the app (rename/create/
// settings/confirm/alert), so backdrop-click-to-close and Escape-to-close
// behave the same everywhere instead of being reimplemented ad hoc per dialog.
export const Modal: React.FC<ModalProps> = ({ onClose, children, width = 'w-80' }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
        className={`bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl p-4 ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
