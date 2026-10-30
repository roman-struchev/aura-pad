// Single monospace stack for everything that renders code (Monaco, xterm).
// JetBrains Mono is bundled via @fontsource (imported in main.tsx) and has
// first-class Cyrillic; Menlo is the fallback while the webfont loads.
export const MONO_FONT_FAMILY = '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace'
