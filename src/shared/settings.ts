export type UiMode = 'micro' | 'compact' | 'normal' | 'large'
export type SidebarPosition = 'left' | 'right'
export type ThemeMode = 'dark' | 'light' | 'system'

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large']
export const SIDEBAR_POSITIONS: SidebarPosition[] = ['left', 'right']
export const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system']

export interface AppSettings {
  theme: ThemeMode
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: UiMode
  gitEnabled: boolean
  diagnosticsEnabled: boolean
  sidebarPosition: SidebarPosition
  sidebarWidth: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  tabsEnabled: true,
  autosaveEnabled: true,
  uiMode: 'compact',
  gitEnabled: true,
  diagnosticsEnabled: true,
  sidebarPosition: 'right',
  sidebarWidth: 256
}
