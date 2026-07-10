import type { ResolvedTheme } from '../../../shared/settings'

// Maps the app's resolved theme to a Monaco theme name. 'monokai'/'solarized'
// are custom themes registered in monaco-setup.ts; 'dark'/'light' use Monaco's
// own built-in vs-dark/vs.
export function getMonacoTheme(resolvedTheme: ResolvedTheme): string {
  switch (resolvedTheme) {
    case 'monokai':
      return 'monokai'
    case 'solarized':
      return 'solarized'
    case 'light':
      return 'vs'
    default:
      return 'vs-dark'
  }
}
