export type UiMode = 'micro' | 'compact' | 'normal' | 'large'
export type SidebarPosition = 'left' | 'right'
// 'dark'/'light' are the app's original two looks; 'system' follows the OS
// between those two. 'monokai'/'solarized' are full app-wide themes (chrome
// CSS variables in main.css *and* the Monaco editor color scheme) - not tied
// to the OS, they look the same regardless of it.
export type ThemeMode = 'dark' | 'light' | 'system' | 'monokai' | 'solarized'
// What `theme` above actually resolves to once 'system' is settled one way
// or the other - this is what CSS `[data-theme]` and the Monaco theme picker
// key off of.
export type ResolvedTheme = 'dark' | 'light' | 'monokai' | 'solarized'

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large']
export const SIDEBAR_POSITIONS: SidebarPosition[] = ['left', 'right']
export const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system', 'monokai', 'solarized']

export interface AppSettings {
  theme: ThemeMode
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: UiMode
  gitEnabled: boolean
  diagnosticsEnabled: boolean
  sidebarPosition: SidebarPosition
  sidebarWidth: number
  lineNumbersEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  tabsEnabled: true,
  autosaveEnabled: true,
  uiMode: 'compact',
  gitEnabled: true,
  diagnosticsEnabled: true,
  sidebarPosition: 'left',
  sidebarWidth: 256,
  lineNumbersEnabled: true
}
