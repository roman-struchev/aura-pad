export type UiMode = 'micro' | 'compact' | 'normal' | 'large'

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large']

export interface AppSettings {
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: UiMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  tabsEnabled: true,
  autosaveEnabled: true,
  uiMode: 'compact'
}
