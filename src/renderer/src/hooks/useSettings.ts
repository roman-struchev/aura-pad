import { useEffect, useState } from 'react'
import { type AppSettings, DEFAULT_SETTINGS } from '../../../shared/settings'

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      window.api.saveSettings(next)
      return next
    })
  }

  return { settings, updateSetting }
}
