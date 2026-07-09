import { useEffect, useState } from 'react'

export function useTheme(): boolean {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    window.api.getTheme().then(setIsDark)
    const unsubscribe = window.api.onThemeUpdated(setIsDark)
    return unsubscribe
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  }, [isDark])

  return isDark
}
