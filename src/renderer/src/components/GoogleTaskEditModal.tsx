import React, { useState } from 'react'
import clsx from 'clsx'
import { Mic, Square, Loader2, X } from 'lucide-react'
import type { GTask, GTaskInput } from '../../../shared/googleTasks'
import type { VoiceLanguage, VoiceModel } from '../../../shared/settings'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { Modal } from './Modal'
import { VoiceModelModal } from './VoiceModelModal'

interface GoogleTaskEditModalProps {
  mode: 'create' | 'edit'
  task?: GTask
  onSave: (input: GTaskInput) => Promise<boolean>
  onClose: () => void
  voiceModel: VoiceModel
  voiceLanguage: VoiceLanguage
  onVoiceModelChange: (model: VoiceModel) => void
  onVoiceLanguageChange: (language: VoiceLanguage) => void
}

// `due` from the API is a full RFC 3339 timestamp with the time forced to
// midnight UTC; <input type="date"> only wants the date part.
function dueToDateInput(due?: string): string {
  return due ? due.slice(0, 10) : ''
}

// Local calendar date, not UTC - toISOString would shift across midnight
// depending on the timezone offset, silently picking the wrong day.
function localDateInput(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function appendDictated(current: string, text: string): string {
  if (!current) return text
  return /\s$/.test(current) ? `${current}${text}` : `${current} ${text}`
}

type DictationField = 'title' | 'notes'

// Shared create/edit form (Settings → Google Tasks's "+" and clicking a task
// both open this). Title/notes/due only - completion is toggled from the
// task row itself, not duplicated here. Each of Title/Notes has its own mic
// button, backed by one shared dictation session (the same Whisper
// model/worker as the editor's Cmd+D) - only one field can record at a time,
// so the other field's mic is disabled while it's busy.
export const GoogleTaskEditModal: React.FC<GoogleTaskEditModalProps> = ({
  mode,
  task,
  onSave,
  onClose,
  voiceModel,
  voiceLanguage,
  onVoiceModelChange,
  onVoiceLanguageChange
}) => {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [due, setDue] = useState(dueToDateInput(task?.due))
  const [saving, setSaving] = useState(false)
  // Which field a recording in progress (or about to start) targets - set
  // right before toggling into a recording, read once the transcription
  // comes back.
  const [dictationTarget, setDictationTarget] = useState<DictationField>('title')

  const voice = useVoiceInput(voiceModel, voiceLanguage, (text) => {
    const setter = dictationTarget === 'title' ? setTitle : setNotes
    setter((prev) => appendDictated(prev, text))
  })

  const canSave = !saving && title.trim().length > 0

  const handleSave = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    try {
      const ok = await onSave({
        title: title.trim(),
        notes: notes.trim(),
        // Tasks discards the time-of-day anyway - midnight UTC matches what
        // the API itself returns for `due`.
        due: due ? `${due}T00:00:00.000Z` : ''
      })
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  const startDictation = (field: DictationField): void => {
    if (voice.status === 'idle') setDictationTarget(field)
    voice.toggle()
  }

  // Overlaid inside the field's own box (like the date field's clear button
  // sits right at its edge) rather than as a separate control beside it -
  // no room for the level meter at this size, so recording is shown as a
  // pulsing stop icon instead.
  const renderMic = (field: DictationField): React.ReactNode => {
    const isTarget = dictationTarget === field
    const recording = voice.status === 'recording' && isTarget
    const busy = isTarget && (voice.status === 'transcribing' || voice.status === 'downloading')
    const blockedByOtherField = voice.status !== 'idle' && !isTarget
    return (
      <button
        type="button"
        className={clsx(
          'p-1 rounded hover:bg-fleet-border disabled:opacity-30',
          recording ? 'text-blue-400' : 'text-gray-500 hover:text-white'
        )}
        title={recording ? 'Stop dictation' : busy ? 'Working…' : 'Dictate'}
        disabled={blockedByOtherField}
        onClick={() => startDictation(field)}
      >
        {recording ? (
          <Square size={12} className="fill-current animate-pulse" />
        ) : busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Mic size={12} />
        )}
      </button>
    )
  }

  return (
    <>
      <Modal onClose={onClose} width="w-96">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-fleet-textHover">
            {mode === 'create' ? 'New Task' : 'Edit Task'}
          </span>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Title</span>
            <div className="relative">
              <input
                autoFocus
                className="w-full bg-fleet-bg border border-fleet-border rounded pl-2 pr-8 py-1.5 text-sm text-fleet-text outline-none focus:border-blue-500"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">{renderMic('title')}</div>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Notes</span>
            <div className="relative">
              <textarea
                className="w-full bg-fleet-bg border border-fleet-border rounded pl-2 pr-8 py-1.5 text-xs text-fleet-text outline-none focus:border-blue-500 resize-none"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="absolute right-1 top-1">{renderMic('notes')}</div>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Due date</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="flex-1 min-w-0 bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-xs text-fleet-text outline-none focus:border-blue-500"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
              <button
                type="button"
                className="p-1.5 rounded border border-fleet-border hover:bg-fleet-active text-gray-500 hover:text-white disabled:opacity-30 shrink-0"
                title="Clear due date"
                disabled={!due}
                onClick={() => setDue('')}
              >
                <X size={12} />
              </button>
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  ['Today', 0],
                  ['Tomorrow', 1],
                  ['Next week', 7]
                ] as const
              ).map(([label, days]) => (
                <button
                  key={label}
                  type="button"
                  className="px-2 py-0.5 text-[10px] rounded border border-fleet-border hover:bg-fleet-active text-gray-400 hover:text-gray-200"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() + days)
                    setDue(localDateInput(d))
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <div className="flex items-center justify-end gap-2 mt-1">
            <button
              className="px-3 py-1.5 text-xs rounded border border-fleet-border hover:bg-fleet-active text-fleet-text"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white"
              disabled={!canSave}
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {(voice.status === 'consent' || voice.status === 'downloading') && (
        <VoiceModelModal
          defaultModel={voiceModel}
          language={voiceLanguage}
          onLanguageChange={onVoiceLanguageChange}
          downloading={voice.status === 'downloading'}
          progress={voice.progress}
          onConfirm={(model) => {
            onVoiceModelChange(model)
            voice.confirmDownload(model)
          }}
          onDeleteModel={voice.deleteModel}
          onClose={() => {
            if (voice.status === 'downloading') voice.cancelDownload()
            else voice.dismissConsent()
          }}
        />
      )}
    </>
  )
}
