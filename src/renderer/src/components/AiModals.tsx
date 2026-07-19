import React from 'react'
import { TranslateModal } from './TranslateModal'
import { VoiceModelModal } from './VoiceModelModal'
import { ReadAloudModal } from './ReadAloudModal'
import { READ_LANGS } from '../../../shared/settings'
import { VOICE_CATALOG, downloadedVoices } from '../hooks/useReadAloud'
import type { useTranslate } from '../hooks/useTranslate'
import type { useVoiceInput } from '../hooks/useVoiceInput'
import type { useReadAloud } from '../hooks/useReadAloud'
import type { useSettings } from '../hooks/useSettings'

interface AiModalsProps {
  settings: ReturnType<typeof useSettings>['settings']
  updateSetting: ReturnType<typeof useSettings>['updateSetting']
  translate: ReturnType<typeof useTranslate>
  voice: ReturnType<typeof useVoiceInput>
  readAloud: ReturnType<typeof useReadAloud>
  // The dictation/read-aloud/translate dialogs double as their Settings
  // pages - "Configure…" opens them on top of the Settings modal.
  showTranslateConfig: boolean
  setShowTranslateConfig: (show: boolean) => void
  showDictationConfig: boolean
  setShowDictationConfig: (show: boolean) => void
  showReadAloudConfig: boolean
  setShowReadAloudConfig: (show: boolean) => void
}

// The translate/dictation/read-aloud model dialogs: consent + download
// progress when a feature is first used, and the same dialogs opened as
// configuration pages from Settings.
export const AiModals: React.FC<AiModalsProps> = ({
  settings,
  updateSetting,
  translate,
  voice,
  readAloud,
  showTranslateConfig,
  setShowTranslateConfig,
  showDictationConfig,
  setShowDictationConfig,
  showReadAloudConfig,
  setShowReadAloudConfig
}) => (
  <>
    {(translate.status === 'consent' ||
      translate.status === 'downloading' ||
      showTranslateConfig) && (
      <TranslateModal
        defaultModel={settings.translateModel}
        defaultPair={settings.translatePair}
        downloading={translate.status === 'downloading'}
        progress={translate.progress}
        onConfirm={(model, pair) => {
          updateSetting('translateModel', model)
          updateSetting('translatePair', pair)
          setShowTranslateConfig(false)
          // Also warms/downloads the model; harmless when opened from
          // Settings - the modal stays visible through 'downloading'.
          translate.confirmDownload(model, pair)
        }}
        onDeleteUnit={translate.deleteUnit}
        onClose={() => {
          setShowTranslateConfig(false)
          if (translate.status === 'downloading') translate.cancelDownload()
          else translate.dismissConsent()
        }}
      />
    )}

    {(voice.status === 'consent' || voice.status === 'downloading' || showDictationConfig) && (
      <VoiceModelModal
        defaultModel={settings.voiceModel}
        language={settings.voiceLanguage}
        onLanguageChange={(lang) => updateSetting('voiceLanguage', lang)}
        downloading={voice.status === 'downloading'}
        progress={voice.progress}
        onConfirm={(model) => {
          updateSetting('voiceModel', model)
          setShowDictationConfig(false)
          // Also warms/downloads the model; harmless when opened from
          // Settings - the modal stays visible through 'downloading'.
          voice.confirmDownload(model)
        }}
        onDeleteModel={voice.deleteModel}
        onClose={() => {
          setShowDictationConfig(false)
          if (voice.status === 'downloading') voice.cancelDownload()
          else voice.dismissConsent()
        }}
      />
    )}

    {(readAloud.modalPhase !== null || showReadAloudConfig) && (
      <ReadAloudModal
        langs={showReadAloudConfig ? READ_LANGS : readAloud.consentLangs}
        current={settings.readVoices}
        downloading={readAloud.modalPhase === 'downloading'}
        progress={readAloud.downloadProgress}
        mode={showReadAloudConfig ? 'settings' : 'consent'}
        onConfirm={(choices) => {
          updateSetting('readVoices', { ...settings.readVoices, ...choices })
          if (showReadAloudConfig) {
            // Settings flow: download anything newly selected, no reading.
            const missing = Object.entries(choices)
              .map(([lang, key]) =>
                key && key !== 'system'
                  ? (
                      VOICE_CATALOG[lang as keyof typeof VOICE_CATALOG] as Record<
                        string,
                        { id: string }
                      >
                    )[key].id
                  : null
              )
              .filter((id): id is string => !!id && !downloadedVoices().includes(id))
            if (missing.length > 0) readAloud.predownloadVoices(missing)
            else setShowReadAloudConfig(false)
          } else {
            readAloud.confirmVoiceDownload(choices)
          }
        }}
        onDeleteVoice={readAloud.deleteVoice}
        onClose={() => {
          setShowReadAloudConfig(false)
          readAloud.closeVoiceModal()
        }}
      />
    )}
  </>
)
