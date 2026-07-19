import React from 'react'
import { Loader2 } from 'lucide-react'
import type { UpdateNotification } from '../../../shared/updateNotification'

interface UpdateToastProps {
  notification: UpdateNotification
  installing: boolean
  // Shared with SettingsModal's update row - the apply/dismiss logic lives
  // once in App.
  onApply: () => void
  onDismiss: () => void
}

// The bottom-right "new version" toast: offers Install/Restart/Download,
// turns into a progress note while the update is being applied, and shows a
// retry state when main reports a failed attempt.
export const UpdateToast: React.FC<UpdateToastProps> = ({
  notification,
  installing,
  onApply,
  onDismiss
}) => (
  <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-4 bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl px-4 py-3 text-xs text-fleet-text">
    {installing ? (
      <>
        <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
        <span>
          {notification.mode === 'install'
            ? 'Restarting to install the update…'
            : `Installing AuraPad ${notification.version}… the app will restart itself.`}
        </span>
      </>
    ) : (
      <>
        <span>
          {notification.failed
            ? 'Update failed — check your connection and try again.'
            : notification.mode === 'install'
              ? `AuraPad ${notification.version} is ready to install.`
              : `AuraPad ${notification.version} is available.`}
        </span>
        <button className="underline text-blue-400 hover:text-blue-300" onClick={onApply}>
          {notification.failed
            ? 'Retry'
            : notification.mode === 'install'
              ? 'Restart'
              : notification.mode === 'script'
                ? 'Install'
                : 'Download'}
        </button>
        <button className="underline text-gray-500 hover:text-gray-400" onClick={onDismiss}>
          Later
        </button>
      </>
    )}
  </div>
)
