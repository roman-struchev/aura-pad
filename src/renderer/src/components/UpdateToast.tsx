import React from 'react'
import { Loader2 } from 'lucide-react'
import type { UpdateNotification, UpdateProgress } from '../../../shared/updateNotification'

interface UpdateToastProps {
  notification: UpdateNotification
  installing: boolean
  // Only the macOS script install reports progress; null everywhere else.
  progress: UpdateProgress | null
  // Shared with SettingsModal's update row - the apply/dismiss logic lives
  // once in App.
  onApply: () => void
  onDismiss: () => void
}

// What the spinner line says while an update is being applied. The download is
// the long part, so it gets the percentage; mounting/copying is a few seconds
// of indeterminate work.
function installingLabel(
  notification: UpdateNotification,
  progress: UpdateProgress | null
): string {
  if (notification.mode === 'install') return 'Restarting to install the update…'
  if (progress?.phase === 'download') {
    const pct = progress.percent === undefined ? '' : ` ${progress.percent}%`
    return `Downloading AuraPad ${notification.version}…${pct}`
  }
  return `Installing AuraPad ${notification.version}… the app will restart itself.`
}

// The bottom-right "new version" toast: offers Install/Restart/Download,
// turns into a progress note while the update is being applied, and shows a
// retry state when main reports a failed attempt.
export const UpdateToast: React.FC<UpdateToastProps> = ({
  notification,
  installing,
  progress,
  onApply,
  onDismiss
}) => (
  <div
    data-update-toast
    className="fixed bottom-4 right-4 z-[90] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl overflow-hidden"
  >
    <div className="flex items-center gap-4 px-4 py-3 text-xs text-fleet-text">
      {installing ? (
        <>
          <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
          <span>{installingLabel(notification, progress)}</span>
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
          <button
            data-update-dismiss
            className="underline text-gray-500 hover:text-gray-400"
            onClick={onDismiss}
          >
            Later
          </button>
        </>
      )}
    </div>
    {/* A hairline along the toast's bottom edge - the percentage again, but
        readable at a glance without reading the sentence. */}
    {installing && progress?.percent !== undefined && (
      <div className="h-0.5 bg-fleet-border">
        <div
          data-update-bar
          className="h-full bg-blue-500 transition-[width] duration-200"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    )}
  </div>
)
