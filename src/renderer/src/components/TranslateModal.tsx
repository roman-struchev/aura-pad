import React, { useState } from 'react'
import { ModelPickerModal, ModelPickerOption } from './ModelPickerModal'
import { useDeleteAndRefresh } from '../lib/useDeleteAndRefresh'
import { TRANSLATE_MODEL_CATALOG, TRANSLATE_CATALOG, isDownloaded } from '../lib/translate/models'
import {
  TRANSLATE_MODELS,
  TRANSLATE_PAIRS,
  type TranslateModel,
  type TranslatePair
} from '../../../shared/settings'

interface TranslateModalProps {
  defaultModel: TranslateModel
  defaultPair: TranslatePair
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  downloading: boolean
  progress: number
  onConfirm: (model: TranslateModel, pair: TranslatePair) => void
  onDeleteUnit: (model: TranslateModel, pair: TranslatePair) => Promise<void>
  onClose: () => void
}

// Translation dialog, doubling as its Settings page: pick the model and the
// language pair, download (with progress; closing mid-download cancels), or
// free disk space via the trash icon on downloaded models. NLLB is one
// download for every pair; Opus-MT downloads per pair. Shares its frame with
// the dictation/read-aloud dialogs via ModelPickerModal.
export const TranslateModal: React.FC<TranslateModalProps> = ({
  defaultModel,
  defaultPair,
  enabled,
  onEnabledChange,
  downloading,
  progress,
  onConfirm,
  onDeleteUnit,
  onClose
}) => {
  const [selected, setSelected] = useState<TranslateModel>(defaultModel)
  const [pair, setPair] = useState<TranslatePair>(defaultPair)
  const handleDelete = useDeleteAndRefresh((model: TranslateModel) => onDeleteUnit(model, pair))

  return (
    <ModelPickerModal
      title="Translation"
      intro={
        <>
          {selected === 'google-web'
            ? 'Google Translate is an online service: the selected text is sent to Google on every translation. Nothing is downloaded or stored.'
            : 'Local models run entirely on this computer - text never leaves it. They download once from huggingface.co and are stored locally.'}{' '}
          The direction is picked automatically from the selected text&apos;s language.
        </>
      }
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      enabledDescription="Show the Translate Selection menu item and shortcut"
      downloading={downloading}
      progress={progress}
      progressLabel={`Downloading ${TRANSLATE_MODEL_CATALOG[selected].label}…`}
      confirmLabel={
        selected === 'google-web'
          ? 'Use Google Translate'
          : isDownloaded(selected, pair)
            ? 'Use Model'
            : 'Download'
      }
      onConfirm={() => onConfirm(selected, pair)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        {TRANSLATE_MODELS.map((id) => {
          const info = TRANSLATE_MODEL_CATALOG[id]
          // The online engine's marker is consent, not bytes on disk - no
          // "downloaded" badge or trash icon for it.
          const downloaded = id !== 'google-web' && isDownloaded(id, pair)
          return (
            <ModelPickerOption
              key={id}
              name="translate-model"
              selected={selected === id}
              disabled={downloading}
              label={info.label}
              downloaded={downloaded}
              detail={`${info.quality} · ${info.approxDownload(pair)}`}
              onSelect={() => setSelected(id)}
              onDelete={(e) => handleDelete(e, id)}
            />
          )
        })}
      </div>

      <label className="flex items-center justify-between gap-4 mt-3">
        <span className="text-xs text-fleet-text">Language pair</span>
        <select
          value={pair}
          disabled={downloading}
          onChange={(e) => setPair(e.target.value as TranslatePair)}
          className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500 shrink-0"
        >
          {TRANSLATE_PAIRS.map((p) => (
            <option key={p} value={p}>
              {TRANSLATE_CATALOG[p].label}
            </option>
          ))}
        </select>
      </label>
    </ModelPickerModal>
  )
}
