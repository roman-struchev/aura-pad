import { useEffect, useState } from 'react'
import type { ResolvedTheme, ThemeMode } from '../../../shared/settings'

export function useTheme(themeMode: ThemeMode): ResolvedTheme {
  // Guessed synchronously from the OS-level media query (available
  // immediately, unlike the getTheme() IPC round-trip below) so a
  // light-system user doesn't see a flash of the dark theme for the one
  // frame or two before that response arrives.
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  )

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
