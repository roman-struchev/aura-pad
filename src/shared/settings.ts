export type UiMode = 'micro' | 'compact' | 'normal' | 'large'
export type SidebarPosition = 'left' | 'right'

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large']
export const SIDEBAR_POSITIONS: SidebarPosition[] = ['left', 'right']

export interface AppSettings {
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: UiMode
  gitEnabled: boolean
  diagnosticsEnabled: boolean
  sidebarPosition: SidebarPosition
}

export const DEFAULT_SETTINGS: AppSettings = {
  tabsEnabled: true,
  autosaveEnabled: true,
  uiMode: 'compact',
  gitEnabled: true,
  diagnosticsEnabled: true,
  sidebarPosition: 'right'
}
