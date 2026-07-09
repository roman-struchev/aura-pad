import { useEffect, useState } from 'react'
import type { ThemeMode } from '../../../shared/settings'

export function useTheme(themeMode: ThemeMode): boolean {
  const [systemIsDark, setSystemIsDark] = useState(true)

  useEffect(() => {
    window.api.getTheme().then(setSystemIsDark)
    const unsubscribe = window.api.onThemeUpdated(setSystemIsDark)
    return unsubscribe
  }, [])

  const isDark = themeMode === 'system' ? systemIsDark : themeMode === 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  }, [isDark])

  return isDark
}
