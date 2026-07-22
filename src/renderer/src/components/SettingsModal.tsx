import React, { useState } from 'react'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import type { AppSettings, ExtensionSettings } from '../../../shared/settings'
import type { UpdateNotification } from '../../../shared/updateNotification'
import {
  SIDEBAR_POSITIONS,
  THEME_MODES,
  TRANSLATE_MODEL_LABELS,
  TRANSLATE_PAIR_LABELS,
  UI_MODES
} from '../../../shared/settings'
import type { DensityPreset } from '../density'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'
import { SettingSelect } from './SettingSelect'

interface SettingsModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  density: DensityPreset
  appVersion?: string
  updateNotification?: UpdateNotification | null
  updateInstalling?: boolean
  onUpdateAction?: () => void
  onConfigureDictation: () => void
  onConfigureReadAloud: () => void
  onConfigureTranslate: () => void
  onConfigureGoogleTasks: () => void
  onConfigureWorkTogether: () => void
  onClose: () => void
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '⌘S', description: 'Save file' },
  { keys: '⌘W', description: 'Close tab' },
  { keys: '⇧⌘T', description: 'Reopen closed tab' },
  { keys: '⌘K', description: 'Open the Git tab for the current project' },
  { keys: '⌘D', description: 'Start/stop voice dictation' },
  { keys: '⌥⌘T', description: 'Translate the selected text' },
  { keys: '⌥⌘L', description: 'Format document (JSON/HTML/XML)' },
  { keys: '⇧⌘P', description: 'Toggle Markdown/HTML preview' },
  { keys: '⌃`', description: 'Toggle the terminal' },
  { keys: '⇧⌘F', description: 'Search in workspace' },
  { keys: 'Shift Shift', description: 'Quick open a file or folder' },
  { keys: '⌘C / ⌘V', description: 'Copy/paste in the file tree (row focused)' },
  { keys: 'Delete', description: 'Delete in the file tree (row focused)' },
  {
    keys: 'Esc',
    description:
      'Close a dialog or the translation popup / discard a dictation take / stop reading aloud'
  }
]

// Obsidian-style grouping: a left nav of categories, each showing its own set
// of settings in the content pane on the right - instead of one long list.
type CategoryId = 'appearance' | 'editor' | 'extensions' | 'voice' | 'shortcuts'

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'voice', label: 'Voice & Language' },
  { id: 'shortcuts', label: 'Shortcuts' }
]

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  updateSetting,
  density,
  appVersion,
  updateNotification,
  updateInstalling,
  onUpdateAction,
  onConfigureDictation,
  onConfigureReadAloud,
  onConfigureTranslate,
  onConfigureGoogleTasks,
  onConfigureWorkTogether,
  onClose
}) => {
  const [category, setCategory] = useState<CategoryId>('appearance')

  // Extension settings are namespaced (settings.extensions.<id>.<key>) so
  // each extension owns its block; this patches one block without the
  // callers having to rebuild the whole extensions object.
  const updateExtension = <K extends keyof ExtensionSettings>(
    id: K,
    patch: Partial<ExtensionSettings[K]>
  ): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      [id]: { ...settings.extensions[id], ...patch }
    })

  // The "<Feature> · <status>" rows that open a dedicated config dialog all
  // share this shape, so render them from one helper.
  const configureRow = (label: string, sub: string, onClick: () => void): React.ReactElement => (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col min-w-0">
        <span className={clsx(density.settingsLabelClass, 'text-fleet-text')}>{label}</span>
        <span className={clsx(density.settingsDescriptionClass, 'text-gray-500')}>{sub}</span>
      </div>
      <button
        className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text hover:bg-fleet-active shrink-0"
        onClick={onClick}
      >
        Configure…
      </button>
    </div>
  )

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width="w-[46rem]"
      height="h-[34rem]"
      bodyClassName="flex min-h-0 flex-1"
    >
      {/* Left: category nav + version/update footer */}
      <div className="w-44 shrink-0 border-r border-fleet-border flex flex-col">
        <div className={clsx('flex flex-col gap-0.5 overflow-y-auto', density.settingsPad)}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={clsx(
                'text-left px-2.5 py-1.5 rounded text-sm transition-colors',
                category === c.id
                  ? 'bg-fleet-active text-fleet-text'
                  : 'text-gray-400 hover:text-fleet-text hover:bg-fleet-bg'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div
          className={clsx(
            'mt-auto border-t border-fleet-border flex flex-col gap-1.5',
            density.settingsPad
          )}
        >
          {appVersion && (
            <a
              href={`https://github.com/roman-struchev/aura-pad/releases/tag/v${appVersion}`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-gray-500 hover:text-gray-400 hover:underline font-mono tracking-wide transition-colors"
              title="View release notes"
            >
              v{appVersion}
            </a>
          )}
          {updateNotification &&
            !updateNotification.failed &&
            (updateInstalling ? (
              <span className="flex items-center gap-1.5 text-[11px] text-blue-400">
                <Loader2 size={12} className="animate-spin" />
                Installing…
              </span>
            ) : (
              <button
                className="text-[11px] text-blue-400 hover:text-blue-300 underline text-left"
                onClick={onUpdateAction}
              >
                {updateNotification.mode === 'install'
                  ? 'Restart to update'
                  : updateNotification.mode === 'script'
                    ? 'Install update'
                    : 'Download update'}
              </button>
            ))}
        </div>
      </div>

      {/* Right: the selected category's settings */}
      <div className={clsx('flex-1 min-w-0 overflow-y-auto', density.settingsPad)}>
        {category === 'appearance' && (
          <div className={clsx('flex flex-col', density.settingsGap)}>
            <SettingSelect
              label="Theme"
              description="Dark, light, follow the OS, or a full color scheme"
              value={settings.theme}
              options={THEME_MODES}
              onChange={(v) => updateSetting('theme', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingSelect
              label="Mode"
              description="UI density - editor font size, row height, spacing"
              value={settings.uiMode}
              options={UI_MODES}
              onChange={(v) => updateSetting('uiMode', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingSelect
              label="Sidebar"
              description="Which side the file tree sits on"
              value={settings.sidebarPosition}
              options={SIDEBAR_POSITIONS}
              onChange={(v) => updateSetting('sidebarPosition', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
          </div>
        )}

        {category === 'editor' && (
          <div className={clsx('flex flex-col', density.settingsGap)}>
            <SettingToggle
              label="Line Numbers"
              description="Show line numbers in the editor"
              checked={settings.lineNumbersEnabled}
              onChange={(v) => updateSetting('lineNumbersEnabled', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingToggle
              label="Tabs"
              description="Keep multiple files open at once"
              checked={settings.tabsEnabled}
              onChange={(v) => updateSetting('tabsEnabled', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
          </div>
        )}

        {category === 'extensions' && (
          <div className={clsx('flex flex-col', density.settingsGap)}>
            <SettingToggle
              label="Git"
              description="Status badges in the file tree and the per-project Git tab"
              checked={settings.extensions.git.enabled}
              onChange={(v) => updateExtension('git', { enabled: v })}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            {configureRow(
              'Google Tasks',
              `${settings.extensions.googleTasks.enabled ? 'Enabled' : 'Disabled'} · accounts and OAuth client`,
              onConfigureGoogleTasks
            )}
            {configureRow(
              'Work Together',
              `${settings.extensions.workTogether.enabled ? 'Enabled' : 'Disabled'} · share the active file by a time-limited link`,
              onConfigureWorkTogether
            )}
          </div>
        )}

        {category === 'voice' && (
          <div className={clsx('flex flex-col', density.settingsGap)}>
            {configureRow(
              'Dictation',
              `${settings.dictationEnabled ? 'Enabled' : 'Disabled'} · Whisper ${settings.voiceModel} · ${settings.voiceLanguage}`,
              onConfigureDictation
            )}
            {configureRow(
              'Read Aloud',
              `${settings.readAloudEnabled ? 'Enabled' : 'Disabled'} · Voices: ${settings.readVoices.en.replace('_', ' ')} / ${settings.readVoices.ru}`,
              onConfigureReadAloud
            )}
            {configureRow(
              'Translation',
              `${settings.translateEnabled ? 'Enabled' : 'Disabled'} · ${TRANSLATE_MODEL_LABELS[settings.translateModel]} · ${TRANSLATE_PAIR_LABELS[settings.translatePair]}`,
              onConfigureTranslate
            )}
          </div>
        )}

        {category === 'shortcuts' && (
          <div className="flex flex-col gap-1.5">
            {SHORTCUTS.map((s) => (
              <div key={s.description} className="flex items-center justify-between gap-3">
                <span className={clsx(density.settingsDescriptionClass, 'text-gray-400')}>
                  {s.description}
                </span>
                <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-fleet-bg border border-fleet-border text-gray-300 font-mono shrink-0">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
