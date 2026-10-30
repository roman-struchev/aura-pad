import React from 'react'
import { Modal } from './Modal'

interface NameInputModalProps {
  title: string
  value: string
  placeholder?: string
  confirmLabel: string
  // Owned by App (not created here): useWorkspaceTree focuses/selects the
  // input through this same ref when the dialog opens.
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

// The rename/create-file dialogs are the same modal with different labels -
// one text input, Enter to confirm, and the primary button; Esc / the header
// ✕ cancel.
export const NameInputModal: React.FC<NameInputModalProps> = ({
  title,
  value,
  placeholder,
  confirmLabel,
  inputRef,
  onChange,
  onConfirm,
  onCancel
}) => (
  <Modal title={title} onClose={onCancel}>
    <input
      ref={inputRef}
      data-autofocus
      className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-sm text-fleet-text outline-none focus:border-blue-500"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onConfirm()
      }}
    />
    <div className="flex justify-end mt-3">
      <button
        className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </Modal>
)
