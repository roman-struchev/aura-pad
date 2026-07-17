import React, { useState } from 'react'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'
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
  downloading: boolean
  progress: number
  onConfirm: (model: TranslateModel, pair: TranslatePair) => void
  onDeleteUnit: (model: TranslateModel, pair: TranslatePair) => Promise<void>
  onClose: () => void
}

// Translation dialog, doubling as its Settings page: pick the model and the
// language pair, download (with progress; closing mid-download cancels), or
// free disk space via the trash icon on downloaded models. NLLB is one
// download for every pair; Opus-MT downloads per pair.
export const TranslateModal: React.FC<TranslateModalProps> = ({
  defaultModel,
  defaultPair,
  downloading,
  progress,
  onConfirm,
  onDeleteUnit,
  onClose
}) => {
  const [selected, setSelected] = useState<TranslateModel>(defaultModel)
  const [pair, setPair] = useState<TranslatePair>(defaultPair)
  // Bumped after a deletion so the "downloaded" marks re-read localStorage.
  const [, setDeletedCount] = useState(0)

  const handleDelete = async (e: React.MouseEvent, model: TranslateModel): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    await onDeleteUnit(model, pair)
    setDeletedCount((n) => n + 1)
  }

  return (
    <Modal onClose={onClose} width="w-[26rem]">
      <div className="text-sm font-medium text-fleet-text mb-1">Translation</div>
      <div className="text-xs text-gray-400 mb-3">
        {selected === 'google-web'
          ? 'Google Translate is an online service: the selected text is sent to Google on every translation. Nothing is downloaded or stored.'
          : 'Local models run entirely on this computer - text never leaves it. They download once from huggingface.co and are stored locally.'}{' '}
        The direction is picked automatically from the selected text&apos;s language.
      </div>

      <div className="flex flex-col gap-1.5">
        {TRANSLATE_MODELS.map((id) => {
          const info = TRANSLATE_MODEL_CATALOG[id]
          // The online engine's marker is consent, not bytes on disk - no
          // "downloaded" badge or trash icon for it.
          const downloaded = id !== 'google-web' && isDownloaded(id, pair)
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
                name="translate-model"
                className="accent-blue-500 shrink-0"
                checked={selected === id}
                disabled={downloading}
                onChange={() => setSelected(id)}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs text-fleet-text">
                  {info.label}
                  {downloaded && <span className="text-green-500"> - downloaded</span>}
                </span>
                <span className="text-[11px] text-gray-500">
                  {info.quality} · {info.approxDownload(pair)}
                </span>
              </div>
              {downloaded && (
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

      {downloading && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>Downloading {TRANSLATE_MODEL_CATALOG[selected].label}…</span>
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
          onClick={() => onConfirm(selected, pair)}
        >
          {selected === 'google-web'
            ? 'Use Google Translate'
            : isDownloaded(selected, pair)
              ? 'Use Model'
              : 'Download'}
        </button>
      </div>
    </Modal>
  )
}
