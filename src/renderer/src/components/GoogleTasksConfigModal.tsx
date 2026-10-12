import React from 'react'
import clsx from 'clsx'
import { Check, Loader2, Plus, X } from 'lucide-react'
import type { AppSettings } from '../../../shared/settings'
import type { DensityPreset } from '../density'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'
import { useGoogleAccounts } from '../hooks/useGoogleAccounts'

interface GoogleTasksConfigModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  density: DensityPreset
  onClose: () => void
}

// The Google Tasks extension's settings page (Settings → Google Tasks → Configure…):
// the enable toggle and connected accounts. Accounts can also be added from the tab
// itself - this is the central place to manage accounts.
export const GoogleTasksConfigModal: React.FC<GoogleTasksConfigModalProps> = ({
  settings,
  updateSetting,
  density,
  onClose
}) => {
  const gtasks = settings.extensions.googleTasks
  const { accounts, connecting, justConnected, connect, disconnect, clientStatus } =
    useGoogleAccounts()

  const patch = (values: Partial<typeof gtasks>): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      googleTasks: { ...gtasks, ...values }
    })

  const hasCredentials = clientStatus?.hasCredentials ?? false

  return (
    <Modal title="Google Tasks" onClose={onClose} width="w-[26rem]">
      <div className="flex flex-col gap-4">
        <SettingToggle
          label="Enabled"
          description="Show the Google Tasks button and tab"
          checked={gtasks.enabled}
          onChange={(v) => patch({ enabled: v })}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />

        <div className="flex flex-col gap-1.5">
          <span className={clsx(density.settingsLabelClass, 'text-fleet-text')}>Accounts</span>

          {accounts.length === 0 && (
            <span className={clsx(density.settingsDescriptionClass, 'text-gray-500 italic')}>
              No accounts connected.
            </span>
          )}

          {accounts.map((email) => (
            <div
              key={email}
              className={clsx(
                'group flex items-center gap-2 px-2 py-1 rounded border text-xs text-fleet-text transition-colors',
                justConnected === email
                  ? 'bg-accent-ok/10 border-accent-ok/50'
                  : 'bg-fleet-bg border-fleet-border'
              )}
            >
              {justConnected === email && <Check size={12} className="text-accent-ok shrink-0" />}
              <span className="truncate flex-1">{email}</span>
              {justConnected === email && (
                <span className="text-accent-ok shrink-0">Connected</span>
              )}
              <button
                className="opacity-50 hover:opacity-100 shrink-0"
                title="Disconnect"
                onClick={() => disconnect(email)}
              >
                <X size={12} />
              </button>
            </div>
          ))}

          <div className="flex flex-col gap-1 mt-1">
            <button
              className="self-start px-2.5 py-1 text-xs rounded border border-fleet-border hover:bg-fleet-active text-fleet-text disabled:opacity-40 flex items-center gap-1.5"
              disabled={connecting || !hasCredentials}
              onClick={connect}
            >
              {connecting ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Waiting for browser sign-in…
                </>
              ) : (
                <>
                  <Plus size={12} /> Add Google Account
                </>
              )}
            </button>
            {!hasCredentials && (
              <span className="text-[11px] text-accent-warn">
                OAuth client is not configured. See docs/GOOGLE_TASKS_SETUP.md.
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
