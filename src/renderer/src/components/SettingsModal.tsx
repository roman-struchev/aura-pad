import React, { useState } from 'react'
import clsx from 'clsx'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { AppSettings } from '../../../shared/settings'
import { SIDEBAR_POSITIONS, THEME_MODES } from '../../../shared/settings'
import { UI_MODES, type DensityPreset } from '../density'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'
import { SettingSelect } from './SettingSelect'

interface SettingsModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  density: DensityPreset
  onClose: () => void
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '⌘S', description: 'Save file' },
  { keys: '⌘W', description: 'Close tab' },
  { keys: '⇧⌘T', description: 'Reopen closed tab' },
  { keys: '⌘K', description: 'Toggle the Git sidebar tab' },
  { keys: '⇧⌘F', description: 'Search in workspace' },
  { keys: 'Shift Shift', description: 'Quick open a file or folder' },
  { keys: '⌘C / ⌘V', description: 'Copy/paste in the file tree (row focused)' },
  { keys: 'Delete', description: 'Delete in the file tree (row focused)' },
  { keys: 'Esc', description: 'Close a dialog' }
]

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  updateSetting,
  density,
  onClose
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false)

  return (
    <Modal onClose={onClose} width="w-[30rem]">
      <div className="flex flex-col gap-4">
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
        <SettingToggle
          label="Line Numbers"
          description="Show line numbers in the editor"
          checked={settings.lineNumbersEnabled}
          onChange={(v) => updateSetting('lineNumbersEnabled', v)}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />
        <SettingSelect
          label="Sidebar"
          description="Which side the file tree/git panel sits on"
          value={settings.sidebarPosition}
          options={SIDEBAR_POSITIONS}
          onChange={(v) => updateSetting('sidebarPosition', v)}
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
        <SettingToggle
          label="Autosave"
          description="Save automatically a moment after you stop typing"
          checked={settings.autosaveEnabled}
          onChange={(v) => updateSetting('autosaveEnabled', v)}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />
        <SettingToggle
          label="Git"
          description="Show git status badges and the Git panel for repositories"
          checked={settings.gitEnabled}
          onChange={(v) => updateSetting('gitEnabled', v)}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />
        <SettingToggle
          label="Diagnostics"
          description="Inline error checking for TypeScript, JavaScript and Python"
          checked={settings.diagnosticsEnabled}
          onChange={(v) => updateSetting('diagnosticsEnabled', v)}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />
      </div>

      <div className="border-t border-fleet-border mt-4 pt-3">
        <button
          className={clsx(
            density.settingsLabelClass,
            'font-medium text-fleet-textHover flex items-center gap-1 w-full'
          )}
          onClick={() => setShowShortcuts((v) => !v)}
        >
          {showShortcuts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Shortcuts
        </button>
        {showShortcuts && (
          <div className="flex flex-col gap-1.5 mt-2">
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

      <div className="flex justify-end mt-4">
        <button
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Modal>
  )
}
