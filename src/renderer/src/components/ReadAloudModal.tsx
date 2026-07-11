import React, { useState } from 'react'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import {
  EN_VOICES,
  RU_VOICES,
  downloadedVoices,
  type ReadLang,
  type ReadVoiceInfo
} from '../hooks/useReadAloud'
import {
  READ_VOICES_EN,
  READ_VOICES_RU,
  type ReadVoiceEn,
  type ReadVoiceRu
} from '../../../shared/settings'

interface ReadAloudModalProps {
  langs: ReadLang[]
  currentRu: ReadVoiceRu
  currentEn: ReadVoiceEn
  downloading: boolean
  progress: number | null
  // 'consent' = opened by pressing Read Aloud (confirm starts reading);
  // 'settings' = opened from Settings (confirm just saves/downloads).
  mode: 'consent' | 'settings'
  onConfirm: (choices: { ru?: ReadVoiceRu; en?: ReadVoiceEn }) => void
  onDeleteVoice: (voiceId: string) => Promise<void>
  onClose: () => void
}

const LANG_TITLES: Record<ReadLang, string> = { ru: 'Russian voice', en: 'English voice' }

const voiceInfo = (lang: ReadLang, key: ReadVoiceRu | ReadVoiceEn): ReadVoiceInfo | null => {
  if (key === 'system') return null
  return lang === 'ru'
    ? RU_VOICES[key as Exclude<ReadVoiceRu, 'system'>]
    : EN_VOICES[key as Exclude<ReadVoiceEn, 'system'>]
}

// First-use read-aloud dialog, mirroring the dictation model dialog: a radio
// list of voices per language the text needs - the OS's basic voice is one of
// the options (no download) - with a progress bar while the chosen neural
// voices fetch. The selection is saved to Settings by the confirm handler.
export const ReadAloudModal: React.FC<ReadAloudModalProps> = ({
  langs,
  currentRu,
  currentEn,
  downloading,
  progress,
  mode,
  onConfirm,
  onDeleteVoice,
  onClose
}) => {
  const [ru, setRu] = useState<ReadVoiceRu>(currentRu)
  const [en, setEn] = useState<ReadVoiceEn>(currentEn)
  // Bumped after a deletion so the "downloaded" marks re-read localStorage.
  const [, setDeletedCount] = useState(0)
  const downloaded = downloadedVoices()

  const handleDelete = async (e: React.MouseEvent, voiceId: string): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    await onDeleteVoice(voiceId)
    setDeletedCount((n) => n + 1)
  }

  const needsDownload = langs.some((lang) => {
    const info = voiceInfo(lang, lang === 'ru' ? ru : en)
    return info !== null && !downloaded.includes(info.id)
  })

  const renderOption = (
    lang: ReadLang,
    key: ReadVoiceRu | ReadVoiceEn,
    selected: boolean,
    onSelect: () => void
  ): React.ReactElement => {
    const info = voiceInfo(lang, key)
    return (
      <label
        key={key}
        className={clsx(
          'flex items-center gap-2.5 rounded border px-2.5 py-1.5 cursor-pointer',
          selected ? 'border-blue-500 bg-blue-500/10' : 'border-fleet-border hover:bg-fleet-active',
          downloading && 'pointer-events-none opacity-60'
        )}
      >
        <input
          type="radio"
          name={`read-voice-${lang}`}
          className="accent-blue-500 shrink-0"
          checked={selected}
          disabled={downloading}
          onChange={onSelect}
        />
        <span className="flex-1 text-xs text-fleet-text">
          {info ? info.label : 'System voice'}
          {info && downloaded.includes(info.id) && (
            <span className="text-green-500"> - downloaded</span>
          )}
        </span>
        <span className="text-[11px] text-gray-500">
          {info ? info.approxDownload : 'no download'}
        </span>
        {info && downloaded.includes(info.id) && (
          <button
            className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-fleet-bg shrink-0"
            title="Delete downloaded voice"
            onClick={(e) => handleDelete(e, info.id)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </label>
    )
  }

  return (
    <Modal onClose={onClose} width="w-[26rem]">
      <div className="text-sm font-medium text-fleet-text mb-1">Read Aloud</div>
      <div className="text-xs text-gray-400 mb-3">
        Natural-sounding voices run entirely on this computer - downloaded once from huggingface.co
        and stored locally. The choice is remembered in Settings.
      </div>

      {langs.map((lang) => (
        <div key={lang} className="mb-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">
            {LANG_TITLES[lang]}
          </div>
          <div className="flex flex-col gap-1.5">
            {lang === 'ru'
              ? READ_VOICES_RU.map((key) => renderOption(lang, key, ru === key, () => setRu(key)))
              : READ_VOICES_EN.map((key) => renderOption(lang, key, en === key, () => setEn(key)))}
          </div>
        </div>
      ))}

      {downloading && (
        <div className="mt-1 mb-1">
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>Downloading…</span>
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

      <div className="flex justify-end gap-2 mt-3">
        <button
          className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          disabled={downloading}
          onClick={() =>
            onConfirm({
              ru: langs.includes('ru') ? ru : undefined,
              en: langs.includes('en') ? en : undefined
            })
          }
        >
          {needsDownload ? 'Download' : mode === 'consent' ? 'Read' : 'Done'}
        </button>
      </div>
    </Modal>
  )
}
