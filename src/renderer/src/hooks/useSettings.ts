import { useEffect, useRef, useState } from 'react'
import { type AppSettings, DEFAULT_SETTINGS } from '../../../shared/settings'

export interface UseSettingsResult {
  settings: AppSettings
  // False until the persisted settings have actually arrived from main -
  // until then `settings` is still DEFAULT_SETTINGS. Anything that reads a
  // setting *once* (session restore, Work Together resume) must wait for
  // this, or it silently acts on the defaults instead of the user's choice.
  settingsLoaded: boolean
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // Mirrors `settings` so updateSetting can build the next value (and write
  // it) outside of setState's updater - a save is a side effect, and React
  // may invoke an updater more than once (StrictMode double-invokes it in
  // dev), which turned every change into two IPC writes. Updated
  // synchronously here as well, so two updateSetting calls in the same tick
  // (e.g. model + language from one dialog) still compose instead of the
  // second one dropping the first.
  const settingsRef = useRef(settings)

  useEffect(() => {
    window.api
      .getSettings()
      .then((loaded) => {
        settingsRef.current = loaded
        setSettings(loaded)
      })
      // A failed load leaves the defaults in place - but the flag must still
      // flip, or everything gated on it would wait forever.
      .finally(() => setSettingsLoaded(true))
  }, [])

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next
    setSettings(next)
    window.api.saveSettings(next)
  }

  return { settings, settingsLoaded, updateSetting }
}
