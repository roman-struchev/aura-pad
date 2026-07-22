import React from 'react'
import clsx from 'clsx'
import type { AppSettings } from '../../../shared/settings'
import type { DensityPreset } from '../density'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'

interface WorkTogetherConfigModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  density: DensityPreset
  onClose: () => void
}

// Work Together's own settings page (Settings → Work Together → Configure…):
// the enable toggle and the one field it needs, the backend's address. The
// backend itself is a separate, self-hosted service - see
// docs/edit-together/specification.md for the contract it must implement.
export const WorkTogetherConfigModal: React.FC<WorkTogetherConfigModalProps> = ({
  settings,
  updateSetting,
  density,
  onClose
}) => {
  const workTogether = settings.extensions.workTogether

  const patch = (values: Partial<typeof workTogether>): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      workTogether: { ...workTogether, ...values }
    })

  return (
    <Modal title="Work Together" onClose={onClose} width="w-[26rem]">
      <div className="flex flex-col gap-4">
        <SettingToggle
          label="Enabled"
          description="Show the Share button on the active file"
          checked={workTogether.enabled}
          onChange={(v) => patch({ enabled: v })}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />

        <label className="flex flex-col gap-1">
          <span className={clsx(density.settingsDescriptionClass, 'text-gray-500')}>
            Backend URL
          </span>
          <input
            type="text"
            placeholder="https://collab.example.com"
            className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
            value={workTogether.backendUrl}
            spellCheck={false}
            onChange={(e) => patch({ backendUrl: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={clsx(density.settingsDescriptionClass, 'text-gray-500')}>
            Display Name
          </span>
          <input
            type="text"
            placeholder="Host"
            className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
            value={workTogether.displayName}
            spellCheck={false}
            onChange={(e) => patch({ displayName: e.target.value })}
          />
        </label>

        <span className={clsx(density.settingsDescriptionClass, 'text-gray-600')}>
          The address of the Work Together backend - a separate, self-hosted service that relays
          edits and mints the share links. It must implement the{' '}
          <a
            href="https://github.com/roman-struchev/aura-editor/blob/main/docs/edit-together/specification.md"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline"
          >
            Work Together backend specification
          </a>
          ; AuraPad never sends file content anywhere else.
        </span>
      </div>
    </Modal>
  )
}
