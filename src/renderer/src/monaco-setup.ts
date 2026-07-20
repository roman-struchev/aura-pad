import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

loader.config({ monaco })

// Force LF globally for any model created in Monaco (prevents CRLF offset drift)
monaco.editor.onDidCreateModel((model) => {
  model.setEOL(monaco.editor.EndOfLineSequence.LF)
  model.onDidChangeContent(() => {
    if (model.getEndOfLineSequence() !== monaco.editor.EndOfLineSequence.LF) {
      model.setEOL(monaco.editor.EndOfLineSequence.LF)
    }
  })
})

// Monaco measures glyph widths once per font config, and the JetBrains Mono
// webfont (plus its lazily-loaded Cyrillic subsets - @fontsource splits by
// unicode-range) may finish loading after that measurement, which would leave
// the cursor misaligned. Re-measure whenever any font load completes.
document.fonts.addEventListener('loadingdone', () => monaco.editor.remeasureFonts())

// Cmd+D belongs to voice dictation (a native menu accelerator, see menu.ts).
// Monaco binds it to "add selection to next find match" and preventDefaults
// it, and on macOS focused web content sees the key before the menu does -
// so with the editor focused the accelerator would never fire. Unbinding it
// here lets the key bubble through to the menu no matter what has focus.
monaco.editor.addKeybindingRule({
  keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD,
  command: null
})

// A couple of well-known color schemes on top of Monaco's own built-in
// vs/vs-dark, selectable via the "Editor Theme" setting (see lib/editorTheme.ts
// for how a setting value maps to one of these names). Defined with Monaco's
// own `defineTheme` API - no CSS overrides involved.
monaco.editor.defineTheme('monokai', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'type.identifier', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'function', foreground: 'a6e22e' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'identifier', foreground: 'f8f8f2' },
    { token: 'delimiter', foreground: 'f8f8f2' },
    { token: 'tag', foreground: 'f92672' },
    { token: 'attribute.name', foreground: 'a6e22e' },
    { token: 'attribute.value', foreground: 'e6db74' }
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editorCursor.foreground': '#f8f8f0',
    'editor.lineHighlightBackground': '#3e3d32',
    'editorLineNumber.foreground': '#90908a',
    'editor.selectionBackground': '#49483e',
    'editorIndentGuide.background': '#3b3a32'
  }
})

monaco.editor.defineTheme('solarized', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'type.identifier', foreground: 'b58900' },
    { token: 'function', foreground: '268bd2' },
    { token: 'variable', foreground: '657b83' },
    { token: 'identifier', foreground: '657b83' },
    { token: 'tag', foreground: '268bd2' },
    { token: 'attribute.name', foreground: '859900' },
    { token: 'attribute.value', foreground: '2aa198' }
  ],
  colors: {
    'editor.background': '#fdf6e3',
    'editor.foreground': '#657b83',
    'editorCursor.foreground': '#657b83',
    'editor.lineHighlightBackground': '#eee8d5',
    'editorLineNumber.foreground': '#93a1a1',
    'editor.selectionBackground': '#eee8d5'
  }
})

// Monaco's core bundle has no folding support for markdown (that's a separate
// VS Code extension upstream, not part of monaco-editor): no headings, no
// fenced code blocks, no frontmatter. Registering *any* explicit folding
// range provider for a language also fully replaces Monaco's generic
// indentation-based fallback folding for that language (it's an either/or,
// not a merge - see SyntaxRangeProvider upstream), so this intentionally
// covers the three syntax-level things worth folding in markdown:
//   - heading sections (up to the next heading of the same or shallower level)
//   - fenced code blocks (``` / ~~~)
//   - a leading YAML frontmatter block (--- ... ---)
// What's lost as a result: plain indentation-based folding of nested list
// items, which used to work "for free" via that fallback. Not reimplemented
// here since it's a fair bit of extra logic for a fairly minor loss - nested
// lists in this app's own docs are shallow - but it's a known trade-off if
// deeply nested lists turn out to matter.
monaco.languages.registerFoldingRangeProvider('markdown', {
  provideFoldingRanges(model) {
    const lineCount = model.getLineCount()
    const headings: { line: number; level: number }[] = []
    const ranges: monaco.languages.FoldingRange[] = []
    let fenceStart: number | null = null
    let frontmatterEnd = 0

    if (lineCount > 1 && model.getLineContent(1).trim() === '---') {
      for (let line = 2; line <= lineCount; line++) {
        if (model.getLineContent(line).trim() === '---') {
          frontmatterEnd = line
          if (line > 2) ranges.push({ start: 1, end: line })
          break
        }
      }
    }

    for (let line = frontmatterEnd + 1; line <= lineCount; line++) {
      const text = model.getLineContent(line)
      if (/^\s*(```|~~~)/.test(text)) {
        if (fenceStart === null) {
          fenceStart = line
        } else {
          if (line > fenceStart) ranges.push({ start: fenceStart, end: line })
          fenceStart = null
        }
        continue
      }
      if (fenceStart !== null) continue
      const match = text.match(/^(#{1,6})\s+\S/)
      if (match) headings.push({ line, level: match[1].length })
    }

    for (let i = 0; i < headings.length; i++) {
      const current = headings[i]
      let end = lineCount
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level <= current.level) {
          end = headings[j].line - 1
          break
        }
      }
      // Don't let the fold swallow the blank line(s) right before the next heading.
      while (end > current.line && model.getLineContent(end).trim() === '') end--
      if (end > current.line) ranges.push({ start: current.line, end })
    }

    return ranges
  }
})
