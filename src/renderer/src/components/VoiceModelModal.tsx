import React, { useState } from 'react'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'
import { VOICE_MODEL_CATALOG, isModelDownloaded } from '../lib/voice/models'
import {
  VOICE_LANGUAGES,
  VOICE_MODELS,
  type VoiceLanguage,
  type VoiceModel
} from '../../../shared/settings'

interface VoiceModelModalProps {
  defaultModel: VoiceModel
  language: VoiceLanguage
  onLanguageChange: (language: VoiceLanguage) => void
  // The Enabled toggle only renders when both are provided (Settings flow);
  // the task-editor's inline consent dialog omits them.
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
  downloading: boolean
  progress: number
  onConfirm: (model: VoiceModel) => void
  onDeleteModel: (model: VoiceModel) => Promise<void>
  onClose: () => void
}

// Dictation model dialog, doubling as its Settings page: pick the model and
// language, download (with progress; closing mid-download cancels), or free
// disk space via the trash icon on downloaded models.
export const VoiceModelModal: React.FC<VoiceModelModalProps> = ({
  defaultModel,
  language,
  onLanguageChange,
  enabled,
  onEnabledChange,
  downloading,
  progress,
  onConfirm,
  onDeleteModel,
  onClose
}) => {
  const [selected, setSelected] = useState<VoiceModel>(defaultModel)
  // Bumped after a deletion so the "downloaded" marks re-read localStorage.
  const [, setDeletedCount] = useState(0)

  const handleDelete = async (e: React.MouseEvent, id: VoiceModel): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    await onDeleteModel(id)
    setDeletedCount((n) => n + 1)
  }

  return (
    <Modal onClose={onClose} width="w-[26rem]">
      <div className="text-sm font-medium text-fleet-text mb-1">Voice Dictation</div>
      <div className="text-xs text-gray-400 mb-3">
        Dictation runs entirely on this computer - audio never leaves it. It needs a speech model,
        downloaded once from huggingface.co and stored locally.
      </div>

      {enabled !== undefined && onEnabledChange && (
        <div className="border-y border-fleet-border py-3 mb-3">
          <SettingToggle
            label="Enabled"
            description="Show the dictation button and enable its shortcut"
            checked={enabled}
            onChange={onEnabledChange}
            labelClassName="text-xs"
            descriptionClassName="text-[11px]"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {VOICE_MODELS.map((id) => {
          const info = VOICE_MODEL_CATALOG[id]
          return (
            <label
              key={id}
              className={clsx(
                'flex items-center gap-2.5 rounded border px-2.5 py-2 cursor-pointer',
                selected === id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-fleet-border hover:bg-fleet-active',
                downloading && 'pointer-events-none opacity-60'
              )}
            >
              <input
                type="radio"
                name="voice-model"
                className="accent-blue-500 shrink-0"
                checked={selected === id}
                disabled={downloading}
                onChange={() => setSelected(id)}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs text-fleet-text">
                  {info.label}
                  {isModelDownloaded(id) && <span className="text-green-500"> - downloaded</span>}
                </span>
                <span className="text-[11px] text-gray-500">
                  {info.quality} · {info.approxDownload}
                </span>
              </div>
              {isModelDownloaded(id) && (
                <button
                  className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-fleet-bg shrink-0"
                  title="Delete downloaded model"
                  onClick={(e) => handleDelete(e, id)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </label>
          )
        })}
      </div>

      <label className="flex items-center justify-between gap-4 mt-3">
        <span className="text-xs text-fleet-text">Dictation language</span>
        <select
          value={language}
          disabled={downloading}
          onChange={(e) => onLanguageChange(e.target.value as VoiceLanguage)}
          className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500 capitalize shrink-0"
        >
          {VOICE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang} className="capitalize">
              {lang}
            </option>
          ))}
        </select>
      </label>

      {downloading && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>Downloading {VOICE_MODEL_CATALOG[selected].label}…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 rounded bg-fleet-bg overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button
          className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          disabled={downloading}
          onClick={() => onConfirm(selected)}
        >
          {isModelDownloaded(selected) ? 'Use Model' : 'Download'}
        </button>
      </div>
    </Modal>
  )
}
