export type UiMode = 'micro' | 'compact' | 'normal' | 'large';

export const UI_MODES: UiMode[] = ['micro', 'compact', 'normal', 'large'];

interface DensityPreset {
  editorFontSize: number;
  treeRowPadding: string;
  tabBarHeight: string;
  terminalFontSize: number;
}

export const DENSITY: Record<UiMode, DensityPreset> = {
  micro: { editorFontSize: 11, treeRowPadding: 'py-0.5', tabBarHeight: 'h-7', terminalFontSize: 11 },
  compact: { editorFontSize: 12, treeRowPadding: 'py-1', tabBarHeight: 'h-8', terminalFontSize: 12 },
  normal: { editorFontSize: 13, treeRowPadding: 'py-1.5', tabBarHeight: 'h-9', terminalFontSize: 13 },
  large: { editorFontSize: 15, treeRowPadding: 'py-2', tabBarHeight: 'h-10', terminalFontSize: 15 }
};
