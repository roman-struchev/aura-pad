import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ModelPickerModal, ModelPickerOption } from './ModelPickerModal'
import { useDeleteAndRefresh } from '../lib/useDeleteAndRefresh'
import { downloadedVoices, voiceInfo, type ReadLang } from '../hooks/useReadAloud'
import { READ_VOICE_KEYS, type ReadVoices } from '../../../shared/settings'

interface ReadAloudModalProps {
  langs: ReadLang[]
  current: ReadVoices
  // The Enabled toggle only renders when both are provided.
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
  downloading: boolean
  progress: number | null
  // 'consent' = opened by pressing Read Aloud (confirm starts reading);
  // 'settings' = opened from Settings (confirm just saves/downloads).
  mode: 'consent' | 'settings'
  onConfirm: (choices: Partial<ReadVoices>) => void
  onDeleteVoice: (voiceId: string) => Promise<void>
  onClose: () => void
}

const LANG_TITLES: Record<ReadLang, string> = { ru: 'Russian voice', en: 'English voice' }

// First-use read-aloud dialog, mirroring the dictation model dialog (both are
// ModelPickerModal underneath): a radio list of voices per language the text
// needs - the OS's basic voice is one of the options (no download) - with a
// progress bar while the chosen neural voices fetch. The selection is saved to
// Settings by the confirm handler.
export const ReadAloudModal: React.FC<ReadAloudModalProps> = ({
  langs,
  current,
  enabled,
  onEnabledChange,
  downloading,
  progress,
  mode,
  onConfirm,
  onDeleteVoice,
  onClose
}) => {
  const [voices, setVoices] = useState<ReadVoices>(current)
  // Which language's voice list is open; starts on the first one so it's
  // immediately visible instead of a fully collapsed accordion.
  const [expanded, setExpanded] = useState<ReadLang>(langs[0])
  const handleDelete = useDeleteAndRefresh(onDeleteVoice)
  const downloaded = downloadedVoices()

  const needsDownload = langs.some((lang) => {
    const info = voiceInfo(lang, voices[lang])
    return info !== null && !downloaded.includes(info.id)
  })

  const renderOption = (
    lang: ReadLang,
    key: string,
    selected: boolean,
    onSelect: () => void
  ): React.ReactElement => {
    const info = voiceInfo(lang, key)
    return (
      <ModelPickerOption
        key={key}
        name={`read-voice-${lang}`}
        selected={selected}
        disabled={downloading}
        compact
        label={info ? info.label : 'System voice'}
        downloaded={!!info && downloaded.includes(info.id)}
        trailing={info ? info.approxDownload : 'no download'}
        onSelect={onSelect}
        onDelete={info ? (e) => handleDelete(e, info.id) : undefined}
        deleteTitle="Delete downloaded voice"
      />
    )
  }

  return (
    <ModelPickerModal
      title="Read Aloud"
      intro="Natural-sounding voices run entirely on this computer - downloaded once from huggingface.co and stored locally. The choice is remembered in Settings."
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      enabledDescription="Show the Read Aloud button and menu item"
      downloading={downloading}
      progress={progress}
      progressLabel="Downloading…"
      confirmLabel={needsDownload ? 'Download' : mode === 'consent' ? 'Read' : 'Use Model'}
      onConfirm={() => onConfirm(Object.fromEntries(langs.map((lang) => [lang, voices[lang]])))}
      onClose={onClose}
      // The accordions already carry their own bottom margin, so this dialog
      // keeps the tighter spacing it had below them.
      progressClassName="mt-1 mb-1"
      footerClassName="mt-3"
    >
      {langs.map((lang) => {
        const isOpen = expanded === lang
        const selectedInfo = voiceInfo(lang, voices[lang])
        return (
          <div key={lang} className="mb-2 rounded border border-fleet-border overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-fleet-active"
              onClick={() => setExpanded(lang)}
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="flex-1 text-[11px] uppercase tracking-wide text-gray-500">
                {LANG_TITLES[lang]}
              </span>
              <span className="text-xs text-fleet-text">
                {selectedInfo ? selectedInfo.label : 'System voice'}
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1.5 px-2.5 pt-1 pb-2.5">
                {READ_VOICE_KEYS[lang].map((key) =>
                  renderOption(lang, key, voices[lang] === key, () =>
                    setVoices((v) => ({ ...v, [lang]: key }))
                  )
                )}
              </div>
            )}
          </div>
        )
      })}
    </ModelPickerModal>
  )
}
