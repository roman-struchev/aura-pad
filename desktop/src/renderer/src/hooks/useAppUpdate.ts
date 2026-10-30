import { useEffect, useState } from 'react'
import type { UpdateNotification, UpdateProgress } from '../../../shared/updateNotification'

export interface AppUpdate {
  appVersion: string
  // A new app version: either downloaded and ready to install (restart), or -
  // where this build can't self-update - available for manual download.
  notification: UpdateNotification | null
  // True from clicking Install/Restart until the app restarts itself - or
  // until main reports a failed attempt (a fresh notification with `failed`
  // set), which must drop the spinner and show the retry state instead.
  installing: boolean
  // How far the macOS install script has got, so the spinner can carry a
  // percentage instead of nothing. Null until the script reports its first
  // step (and on the other platforms, which install without a script).
  progress: UpdateProgress | null
  apply: () => void
  dismiss: () => void
}

// The app's own version and the update flow main drives (see updater.ts),
// shared by the update toast and the Settings modal.
export function useAppUpdate(): AppUpdate {
  const [appVersion, setAppVersion] = useState<string>('')
  const [notification, setNotification] = useState<UpdateNotification | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)

  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(
    () =>
      window.api.onUpdateNotification((update) => {
        setNotification(update)
        setInstalling(false)
        setProgress(null)
      }),
    []
  )

  // Progress is only ever emitted while an install is actually running, so it
  // also (re)asserts the installing state - the toast can't be showing its
  // buttons while the script is already replacing the app underneath it.
  useEffect(
    () =>
      window.api.onUpdateProgress((next) => {
        setProgress(next)
        setInstalling(true)
      }),
    []
  )

  // 'manual' just opens the releases page - nothing to wait for. The
  // self-applying modes keep the toast up as a progress indicator until the
  // app restarts itself.
  const apply = (): void => {
    window.api.applyUpdate()
    setProgress(null)
    if (notification?.mode === 'manual') setNotification(null)
    else setInstalling(true)
  }

  return {
    appVersion,
    notification,
    installing,
    progress,
    apply,
    dismiss: () => setNotification(null)
  }
}
