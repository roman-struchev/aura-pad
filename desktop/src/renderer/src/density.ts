import type { UiMode } from '../../shared/settings'

export type { UiMode }

export interface DensityPreset {
  editorFontSize: number
  // Sidebar/tree text. Kept at or below editorFontSize: UI text larger than
  // the editor text reads as inverted hierarchy (Fleet/VS Code both keep
  // UI <= editor).
  uiFontSize: number
  treeRowPadding: string
  terminalFontSize: number
  settingsLabelClass: string
  settingsDescriptionClass: string
  // Vertical gap between rows within a settings pane, and the padding that
  // separates content from the dialog's dividing lines (header/nav/footer).
  // Both scale with density so a tighter Mode also tightens the spacing.
  settingsGap: string
  settingsPad: string
}

export const DENSITY: Record<UiMode, DensityPreset> = {
  micro: {
    uiFontSize: 11,
    editorFontSize: 11,
    treeRowPadding: 'py-0',
    terminalFontSize: 11,
    settingsLabelClass: 'text-xs',
    settingsDescriptionClass: 'text-[10px]',
    settingsGap: 'gap-2',
    settingsPad: 'p-2'
  },
  compact: {
    uiFontSize: 12,
    editorFontSize: 12,
    treeRowPadding: 'py-0.5',
    terminalFontSize: 12,
    settingsLabelClass: 'text-sm',
    settingsDescriptionClass: 'text-xs',
    settingsGap: 'gap-2.5',
    settingsPad: 'p-2.5'
  },
  normal: {
    uiFontSize: 13,
    editorFontSize: 13,
    treeRowPadding: 'py-1',
    terminalFontSize: 13,
    settingsLabelClass: 'text-base',
    settingsDescriptionClass: 'text-sm',
    settingsGap: 'gap-3',
    settingsPad: 'p-3'
  },
  large: {
    uiFontSize: 14,
    editorFontSize: 15,
    treeRowPadding: 'py-1.5',
    terminalFontSize: 15,
    settingsLabelClass: 'text-lg',
    settingsDescriptionClass: 'text-base',
    settingsGap: 'gap-4',
    settingsPad: 'p-4'
  }
}
