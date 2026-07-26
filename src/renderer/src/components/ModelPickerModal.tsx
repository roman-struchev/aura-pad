import React from 'react'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'

// The shared shell behind the three model dialogs (dictation, translation,
// read-aloud). All of them are the same page: an intro paragraph, an optional
// "Enabled" toggle, a radio list of downloadable units with a per-row trash
// icon, whatever extra picker the feature needs, a download progress bar and
// a single confirm button. Only the list contents and the labels differ, so
// those come in as children/props while everything else lives here once.

interface ModelPickerModalProps {
  title: string
  // Explanatory paragraph above the list; a node, since some of them switch
  // text depending on the current selection.
  intro: React.ReactNode
  // The feature's Settings flag. Both must be present for the toggle to
  // render - the inline consent flows (opened by using the feature rather
  // than from Settings) omit it.
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
  enabledDescription?: string
  downloading: boolean
  // 0-100, or null while a download hasn't reported anything yet.
  progress: number | null
  // Shown next to the percentage, e.g. "Downloading Whisper Base…".
  progressLabel: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  // The option rows (see ModelPickerOption) plus any feature-specific picker.
  children: React.ReactNode
  // Spacing overrides for the two blocks below the children, so each dialog
  // keeps the exact rhythm it had before this component existed (read-aloud's
  // accordions already carry their own bottom margin).
  progressClassName?: string
  footerClassName?: string
}

export const ModelPickerModal: React.FC<ModelPickerModalProps> = ({
  title,
  intro,
  enabled,
  onEnabledChange,
  enabledDescription,
  downloading,
  progress,
  progressLabel,
  confirmLabel,
  onConfirm,
  onClose,
  children,
  progressClassName = 'mt-3',
  footerClassName = 'mt-4'
}) => (
  <Modal title={title} onClose={onClose} width="w-[26rem]">
    <div className="text-xs text-gray-400 mb-3">{intro}</div>

    {enabled !== undefined && onEnabledChange && (
      <div className="border-y border-fleet-border py-2.5 mb-2.5">
        <SettingToggle
          label="Enabled"
          description={enabledDescription ?? ''}
          checked={enabled}
          onChange={onEnabledChange}
          labelClassName="text-xs"
          descriptionClassName="text-[11px]"
        />
      </div>
    )}

    {children}

    {downloading && (
      <div className={progressClassName}>
        <div className="flex justify-between text-[11px] text-gray-400 mb-1">
          <span>{progressLabel}</span>
          <span>{progress ?? 0}%</span>
        </div>
        <div className="h-1.5 rounded bg-fleet-bg overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
      </div>
    )}

    <div className={clsx('flex justify-end', footerClassName)}>
      <button
        className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
        disabled={downloading}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </Modal>
)

interface ModelPickerOptionProps {
  // Radio group name - one per dialog (and per language, for read-aloud).
  name: string
  selected: boolean
  disabled?: boolean
  label: string
  // Appends the green "- downloaded" marker and enables the trash icon.
  downloaded?: boolean
  // Second line under the label (size/quality), for the model dialogs.
  detail?: string
  // Right-aligned single line instead of a second row, for the voice lists.
  trailing?: string
  onSelect: () => void
  // Omitted when there's nothing on disk to free (or the unit isn't a
  // download at all, like the online translator or the OS voice).
  onDelete?: (e: React.MouseEvent) => void
  deleteTitle?: string
  // Tighter row, used inside read-aloud's per-language accordions.
  compact?: boolean
}

// One selectable unit: model, engine or voice. The whole row is the radio's
// label, so clicking anywhere in it selects - except the trash button, which
// stops the event itself.
export const ModelPickerOption: React.FC<ModelPickerOptionProps> = ({
  name,
  selected,
  disabled,
  label,
  downloaded,
  detail,
  trailing,
  onSelect,
  onDelete,
  deleteTitle = 'Delete downloaded model',
  compact
}) => (
  <label
    className={clsx(
      'flex items-center gap-2.5 rounded border px-2.5 cursor-pointer',
      compact ? 'py-1.5' : 'py-2',
      selected ? 'border-blue-500 bg-blue-500/10' : 'border-fleet-border hover:bg-fleet-active',
      disabled && 'pointer-events-none opacity-60'
    )}
  >
    <input
      type="radio"
      name={name}
      className="accent-blue-500 shrink-0"
      checked={selected}
      disabled={disabled}
      onChange={onSelect}
    />
    <div className="flex flex-col min-w-0 flex-1">
      <span className="text-xs text-fleet-text">
        {label}
        {downloaded && <span className="text-green-500"> - downloaded</span>}
      </span>
      {detail && <span className="text-[11px] text-gray-500">{detail}</span>}
    </div>
    {trailing && <span className="text-[11px] text-gray-500">{trailing}</span>}
    {downloaded && onDelete && (
      <button
        className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-fleet-bg shrink-0"
        title={deleteTitle}
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    )}
  </label>
)
