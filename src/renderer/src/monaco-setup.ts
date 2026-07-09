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

// Monaco's core bundle has no folding support for markdown headings (that's a
// separate VS Code extension upstream, not part of monaco-editor) - so `#`
// sections can't be collapsed out of the box. Provide a minimal one: each
// heading folds up to (but not including) the next heading of the same or
// shallower level, skipping fenced code blocks so a `#` in a shell comment
// inside a ```sh block isn't mistaken for a heading.
monaco.languages.registerFoldingRangeProvider('markdown', {
  provideFoldingRanges(model) {
    const lineCount = model.getLineCount()
    const headings: { line: number; level: number }[] = []
    let inFence = false

    for (let line = 1; line <= lineCount; line++) {
      const text = model.getLineContent(line)
      if (/^\s*(```|~~~)/.test(text)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const match = text.match(/^(#{1,6})\s+\S/)
      if (match) headings.push({ line, level: match[1].length })
    }

    const ranges: monaco.languages.FoldingRange[] = []
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
