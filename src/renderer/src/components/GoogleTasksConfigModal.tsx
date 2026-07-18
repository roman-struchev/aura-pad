import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Loader2, Plus, X } from 'lucide-react'
import type { AppSettings } from '../../../shared/settings'
import type { DensityPreset } from '../density'
import { Modal } from './Modal'
import { SettingToggle } from './SettingToggle'
import { alertDialog, confirmDialog } from '../lib/dialogs'

interface GoogleTasksConfigModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  density: DensityPreset
  onClose: () => void
}

// The Google Tasks extension's own settings page (Settings → Google Tasks →
// Configure…): the enable toggle, the one-time OAuth client setup, and the
// connected accounts. Accounts can also be added from the tab itself - this
// is just the one place where everything lives together.
export const GoogleTasksConfigModal: React.FC<GoogleTasksConfigModalProps> = ({
  settings,
  updateSetting,
  density,
  onClose
}) => {
  const gtasks = settings.extensions.googleTasks
  const [accounts, setAccounts] = useState<string[]>([])
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    window.api.gtasksAccounts().then(setAccounts)
  }, [])

  const patch = (values: Partial<typeof gtasks>): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      googleTasks: { ...gtasks, ...values }
    })

  const addAccount = async (): Promise<void> => {
    setConnecting(true)
    try {
      const result = await window.api.gtasksAddAccount()
      if (!result.success) {
        await alertDialog(result.error || 'Sign-in failed.')
        return
      }
      setAccounts(await window.api.gtasksAccounts())
    } finally {
      setConnecting(false)
    }
  }

  const removeAccount = async (email: string): Promise<void> => {
    if (!(await confirmDialog(`Disconnect ${email}?`))) return
    await window.api.gtasksRemoveAccount(email)
    setAccounts(await window.api.gtasksAccounts())
  }

  return (
    <Modal onClose={onClose} width="w-[26rem]">
      <div className="flex flex-col gap-4">
        <span className={clsx(density.settingsLabelClass, 'font-medium text-fleet-textHover')}>
          Google Tasks
        </span>

        <SettingToggle
          label="Enabled"
          description="Show the Google Tasks button and tab"
          checked={gtasks.enabled}
          onChange={(v) => patch({ enabled: v })}
          labelClassName={density.settingsLabelClass}
          descriptionClassName={density.settingsDescriptionClass}
        />

        <div className="flex flex-col gap-2">
          <span className={clsx(density.settingsLabelClass, 'text-fleet-text')}>OAuth Client</span>
          {(
            [
              ['clientId', 'Client ID'],
              ['clientSecret', 'Client Secret']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className={clsx(density.settingsDescriptionClass, 'text-gray-500')}>
                {label}
              </span>
              <input
                type={key === 'clientSecret' ? 'password' : 'text'}
                className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
                value={gtasks[key]}
                spellCheck={false}
                onChange={(e) => patch({ [key]: e.target.value })}
              />
            </label>
          ))}
          <span className={clsx(density.settingsDescriptionClass, 'text-gray-600')}>
            One-time setup: create a “Desktop app” OAuth client at{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline"
            >
              console.cloud.google.com/apis/credentials
            </a>{' '}
            (with the Tasks API enabled). After that, connecting an account is just a browser
            sign-in.
          </span>
          <span className={clsx(density.settingsDescriptionClass, 'text-gray-600')}>
            For create/edit access, add the <code>tasks</code> scope (not just{' '}
            <code>tasks.readonly</code>) under{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials/consent"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline"
            >
              OAuth consent screen → Data access
            </a>
            , then reconnect any already-connected account.
          </span>
        </div>

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
              className="group flex items-center gap-2 px-2 py-1 rounded bg-fleet-bg border border-fleet-border text-xs text-fleet-text"
            >
              <span className="truncate flex-1">{email}</span>
              <button
                className="opacity-50 hover:opacity-100 shrink-0"
                title="Disconnect"
                onClick={() => removeAccount(email)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            className="self-start mt-1 px-2.5 py-1 text-xs rounded border border-fleet-border hover:bg-fleet-active text-fleet-text disabled:opacity-40 flex items-center gap-1.5"
            disabled={connecting}
            onClick={addAccount}
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
        </div>
      </div>
    </Modal>
  )
}
