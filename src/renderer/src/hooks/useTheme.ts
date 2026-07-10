import { useEffect, useState } from 'react'
import type { ResolvedTheme, ThemeMode } from '../../../shared/settings'

export function useTheme(themeMode: ThemeMode): ResolvedTheme {
  const [systemIsDark, setSystemIsDark] = useState(true)

  useEffect(() => {
    window.api.getTheme().then(setSystemIsDark)
    const unsubscribe = window.api.onThemeUpdated(setSystemIsDark)
    return unsubscribe
  }, [])

  const resolved: ResolvedTheme =
    themeMode === 'system' ? (systemIsDark ? 'dark' : 'light') : themeMode

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  return resolved
}
