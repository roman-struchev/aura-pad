import React, { useState } from 'react'
import { ModelPickerModal, ModelPickerOption } from './ModelPickerModal'
import { useDeleteAndRefresh } from '../lib/useDeleteAndRefresh'
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
// disk space via the trash icon on downloaded models. The dialog frame,
// option rows and progress bar come from ModelPickerModal, shared with the
// translation and read-aloud dialogs.
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
  const handleDelete = useDeleteAndRefresh(onDeleteModel)

  return (
    <ModelPickerModal
      title="Voice Dictation"
      intro="Dictation runs entirely on this computer - audio never leaves it. It needs a speech model, downloaded once from huggingface.co and stored locally."
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      enabledDescription="Show the dictation button and enable its shortcut"
      downloading={downloading}
      progress={progress}
      progressLabel={`Downloading ${VOICE_MODEL_CATALOG[selected].label}…`}
      confirmLabel={isModelDownloaded(selected) ? 'Use Model' : 'Download'}
      onConfirm={() => onConfirm(selected)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        {VOICE_MODELS.map((id) => {
          const info = VOICE_MODEL_CATALOG[id]
          return (
            <ModelPickerOption
              key={id}
              name="voice-model"
              selected={selected === id}
              disabled={downloading}
              label={info.label}
              downloaded={isModelDownloaded(id)}
              detail={`${info.quality} · ${info.approxDownload}`}
              onSelect={() => setSelected(id)}
              onDelete={(e) => handleDelete(e, id)}
            />
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
    </ModelPickerModal>
  )
}
