import type { UiMode } from '../../shared/settings'

export type { UiMode }

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large']

interface DensityPreset {
  editorFontSize: number
  treeRowPadding: string
  tabBarHeight: string
  terminalFontSize: number
  settingsLabelClass: string
  settingsDescriptionClass: string
}

export const DENSITY: Record<UiMode, DensityPreset> = {
  micro: {
    editorFontSize: 11,
    treeRowPadding: 'py-0.5',
    tabBarHeight: 'h-7',
    terminalFontSize: 11,
    settingsLabelClass: 'text-xs',
    settingsDescriptionClass: 'text-[10px]'
  },
  compact: {
    editorFontSize: 12,
    treeRowPadding: 'py-1',
    tabBarHeight: 'h-8',
    terminalFontSize: 12,
    settingsLabelClass: 'text-sm',
    settingsDescriptionClass: 'text-xs'
  },
  normal: {
    editorFontSize: 13,
    treeRowPadding: 'py-1.5',
    tabBarHeight: 'h-9',
    terminalFontSize: 13,
    settingsLabelClass: 'text-base',
    settingsDescriptionClass: 'text-sm'
  },
  large: {
    editorFontSize: 15,
    treeRowPadding: 'py-2',
    tabBarHeight: 'h-10',
    terminalFontSize: 15,
    settingsLabelClass: 'text-lg',
    settingsDescriptionClass: 'text-base'
  }
}
