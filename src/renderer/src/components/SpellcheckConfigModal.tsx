import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Check, Download, Loader2, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'
import { SPELL_DICTIONARIES, type SpellLanguage } from '../../../shared/spellcheck'
import type { AppSettings } from '../../../shared/settings'
import type { DensityPreset } from '../density'

interface SpellcheckConfigModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  density: DensityPreset
  onClose: () => void
}

// Spelling settings: the switch, which dictionaries are on the machine, and
// the words the user taught it.
//
// Dictionaries are downloaded once, on request - the same deal the voice and
// translation models get, for the same reason: the app promises that text
// never leaves the machine, so the checking has to happen here, which means
// the word lists have to be here too.
export const SpellcheckConfigModal: React.FC<SpellcheckConfigModalProps> = ({
  settings,
  updateSetting,
  density,
  onClose
}) => {
  const [installed, setInstalled] = useState<SpellLanguage[] | null>(null)
  const [busy, setBusy] = useState<SpellLanguage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.spellDictionaries().then((list) => {
      if (alive) setInstalled(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const setLanguages = (langs: SpellLanguage[]): void => updateSetting('spellLanguages', langs)

  const install = async (lang: SpellLanguage): Promise<void> => {
    setBusy(lang)
    setError(null)
    const result = await window.api.spellDownloadDictionary(lang)
    setBusy(null)
    if (!result.success) {
      setError(result.error ?? 'The dictionary could not be downloaded.')
      return
    }
    setInstalled(await window.api.spellDictionaries())
    // Downloading one is the same act as wanting it used.
    if (!settings.spellLanguages.includes(lang)) setLanguages([...settings.spellLanguages, lang])
  }

  const remove = async (lang: SpellLanguage): Promise<void> => {
    setBusy(lang)
    setError(null)
    await window.api.spellRemoveDictionary(lang)
    setBusy(null)
    setInstalled(await window.api.spellDictionaries())
    setLanguages(settings.spellLanguages.filter((l) => l !== lang))
  }

  return (
    <Modal title="Spelling" onClose={onClose} width="w-[30rem]">
      <div className={clsx('flex flex-col', density.settingsGap)}>
        <SettingToggle
          label="Check Spelling"
          description="Underline unknown words in Markdown and text files"
          checked={settings.spellcheckEnabled}
          onChange={(v) => updateSetting('spellcheckEnabled', v)}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />

        <div className="flex flex-col gap-1.5">
          <span className={clsx(density.settingsLabelClass, 'text-fleet-text')}>Dictionaries</span>
          {SPELL_DICTIONARIES.map((dictionary) => {
            const here = installed?.includes(dictionary.id) ?? false
            const active = settings.spellLanguages.includes(dictionary.id)
            return (
              <div
                key={dictionary.id}
                className="flex items-center gap-2 border border-fleet-border rounded px-2 py-1.5"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs text-fleet-text">{dictionary.label}</span>
                  <span className="text-[10px] text-gray-500">
                    {here ? 'Installed' : `Download once · ~${dictionary.sizeMb} MB`}
                  </span>
                </div>
                {here && (
                  <button
                    aria-label={`Use ${dictionary.label}`}
                    onClick={() =>
                      setLanguages(
                        active
                          ? settings.spellLanguages.filter((l) => l !== dictionary.id)
                          : [...settings.spellLanguages, dictionary.id]
                      )
                    }
                    className={clsx(
                      'flex items-center gap-1 rounded px-2 py-1 text-[11px] border',
                      active
                        ? 'border-blue-500 text-blue-300'
                        : 'border-fleet-border text-gray-400 hover:text-fleet-text'
                    )}
                  >
                    {active && <Check size={12} />}
                    {active ? 'In use' : 'Use'}
                  </button>
                )}
                <button
                  aria-label={here ? `Remove ${dictionary.label}` : `Download ${dictionary.label}`}
                  disabled={busy !== null}
                  onClick={() => void (here ? remove(dictionary.id) : install(dictionary.id))}
                  className="rounded p-1 text-gray-400 hover:text-white hover:bg-fleet-active disabled:opacity-40"
                >
                  {busy === dictionary.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : here ? (
                    <Trash2 size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                </button>
              </div>
            )
          })}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
          <span className="text-[10px] text-gray-500">
            Hunspell dictionaries from wooorm/dictionaries, pinned to one commit. They are
            downloaded once and checked entirely on this machine — nothing you write is sent
            anywhere.
          </span>
        </div>

        {settings.spellUserWords.length > 0 && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col min-w-0">
              <span className={clsx(density.settingsLabelClass, 'text-fleet-text')}>
                Your words
              </span>
              <span className={clsx(density.settingsDescriptionClass, 'text-gray-500 truncate')}>
                {settings.spellUserWords.slice(0, 8).join(', ')}
                {settings.spellUserWords.length > 8 ? '…' : ''}
              </span>
            </div>
            <button
              className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text hover:bg-fleet-active shrink-0"
              onClick={() => updateSetting('spellUserWords', [])}
            >
              Forget all
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
