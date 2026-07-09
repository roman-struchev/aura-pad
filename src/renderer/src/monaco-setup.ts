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
