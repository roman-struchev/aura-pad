import type { UiMode } from '../../shared/settings'

export type { UiMode }

export interface DensityPreset {
  editorFontSize: number
  // Sidebar/tree text. Kept at or below editorFontSize: UI text larger than
  // the editor text reads as inverted hierarchy (Fleet/VS Code both keep
  // UI <= editor).
  uiFontSize: number
  treeRowPadding: string
  tabBarHeight: string
  terminalFontSize: number
  settingsLabelClass: string
  settingsDescriptionClass: string
}

export const DENSITY: Record<UiMode, DensityPreset> = {
  micro: {
    uiFontSize: 11,
    editorFontSize: 11,
    treeRowPadding: 'py-0.5',
    tabBarHeight: 'h-7',
    terminalFontSize: 11,
    settingsLabelClass: 'text-xs',
    settingsDescriptionClass: 'text-[10px]'
  },
  compact: {
    uiFontSize: 12,
    editorFontSize: 12,
    treeRowPadding: 'py-1',
    tabBarHeight: 'h-8',
    terminalFontSize: 12,
    settingsLabelClass: 'text-sm',
    settingsDescriptionClass: 'text-xs'
  },
  normal: {
    uiFontSize: 13,
    editorFontSize: 13,
    treeRowPadding: 'py-1.5',
    tabBarHeight: 'h-9',
    terminalFontSize: 13,
    settingsLabelClass: 'text-base',
    settingsDescriptionClass: 'text-sm'
  },
  large: {
    uiFontSize: 14,
    editorFontSize: 15,
    treeRowPadding: 'py-2',
    tabBarHeight: 'h-10',
    terminalFontSize: 15,
    settingsLabelClass: 'text-lg',
    settingsDescriptionClass: 'text-base'
  }
}
