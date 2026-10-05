import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import type { GitBlameLine, GitRepoStatus } from '../../../shared/gitStatus'
import { diffLines, splitLines, type DiffHunk } from '../lib/lineDiff'
import { modelUri } from '../lib/modelUri'

// Git in the editor itself, Zed-style:
//
// - change markers: a bar beside the line numbers for every line that differs
//   from HEAD (green added, blue modified, a red wedge where lines were
//   removed), recomputed from the live buffer as you type rather than from
//   the saved file, plus a matching tick in the scrollbar. Click a bar to
//   expand that hunk - what HEAD had there, and Revert to put it back (as an
//   undoable edit, like Local History's restore).
// - inline blame: the cursor line's author, age and commit subject, faint,
//   after the end of the line.
//
// HEAD is the base on purpose (not the index): "what did I change since the
// last commit" is the question a gutter answers, and staging a hunk shouldn't
// make it vanish from the editor.

interface Options {
  editor: monaco.editor.IStandaloneCodeEditor | null
  path: string | null
  repos: GitRepoStatus[]
  gutterEnabled: boolean
  blameEnabled: boolean
}

const DIFF_DELAY_MS = 120
const BLAME_DELAY_MS = 250
const SUMMARY_MAX = 70

// The repo a file belongs to: the deepest root it sits under, so a repo
// nested inside another open folder wins over its parent.
function repoFor(repos: GitRepoStatus[], path: string): GitRepoStatus | undefined {
  let best: GitRepoStatus | undefined
  for (const repo of repos) {
    if (path.startsWith(repo.root + '/') && (!best || repo.root.length > best.root.length)) {
      best = repo
    }
  }
  return best
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

export function formatAge(unixSeconds: number, now = Date.now() / 1000): string {
  const delta = Math.max(0, now - unixSeconds)
  for (const [unit, seconds] of UNITS) {
    if (delta >= seconds) return relativeTime.format(-Math.floor(delta / seconds), unit)
  }
  return 'just now'
}

export function blameText(blame: GitBlameLine): string {
  if (blame.uncommitted) return 'You • Uncommitted changes'
  const summary =
    blame.summary.length > SUMMARY_MAX
      ? blame.summary.slice(0, SUMMARY_MAX - 1) + '…'
      : blame.summary
  return `${blame.author}, ${formatAge(blame.date)} • ${summary}`
}

const HUNK_CLASS: Record<DiffHunk['kind'], string> = {
  added: 'aura-git-added',
  modified: 'aura-git-modified',
  deleted: 'aura-git-deleted'
}
const RULER_COLOR: Record<DiffHunk['kind'], string> = {
  added: '#2ea04370',
  modified: '#3b82f670',
  deleted: '#ef444470'
}

function hunkAt(hunks: DiffHunk[], line: number): DiffHunk | undefined {
  return hunks.find((h) =>
    h.kind === 'deleted'
      ? Math.max(1, h.startLine) === line
      : line >= h.startLine && line <= h.endLine
  )
}

function revertHunk(model: monaco.editor.ITextModel, hunk: DiffHunk): void {
  const eol = model.getEOL()
  const old = hunk.oldLines.join(eol)
  const lineCount = model.getLineCount()
  let range: monaco.IRange
  let text: string
  if (hunk.kind === 'modified') {
    range = new monaco.Range(hunk.startLine, 1, hunk.endLine, model.getLineMaxColumn(hunk.endLine))
    text = old
  } else if (hunk.kind === 'added') {
    if (hunk.endLine < lineCount) {
      range = new monaco.Range(hunk.startLine, 1, hunk.endLine + 1, 1)
    } else if (hunk.startLine > 1) {
      const prev = hunk.startLine - 1
      range = new monaco.Range(
        prev,
        model.getLineMaxColumn(prev),
        hunk.endLine,
        model.getLineMaxColumn(hunk.endLine)
      )
    } else {
      range = model.getFullModelRange()
    }
    text = ''
  } else if (hunk.startLine === 0) {
    range = new monaco.Range(1, 1, 1, 1)
    text = old + eol
  } else {
    const col = model.getLineMaxColumn(hunk.startLine)
    range = new monaco.Range(hunk.startLine, col, hunk.startLine, col)
    text = eol + old
  }
  model.pushStackElement()
  model.pushEditOperations([], [{ range, text, forceMoveMarkers: true }], () => null)
  model.pushStackElement()
}

export function useGitDecorations({
  editor,
  path,
  repos,
  gutterEnabled,
  blameEnabled
}: Options): void {
  const repo = path ? repoFor(repos, path) : undefined
  const root = repo?.root ?? null

  // HEAD's text for the active file, refetched whenever git reports a change
  // (a commit, a checkout, a pull all move HEAD) - `repos` is a new array on
  // every status push, which is exactly that signal.
  const baseRef = useRef<{ path: string; lines: string[] } | null>(null)
  const hunksRef = useRef<DiffHunk[]>([])

  useEffect(() => {
    if (!editor || !path || !root || !gutterEnabled) return
    let cancelled = false
    const decorations = editor.createDecorationsCollection()
    const container = editor.getContainerDomNode()
    let expanded: {
      zoneId: string
      widget: monaco.editor.IOverlayWidget
      hunk: DiffHunk
    } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const activeModel = (): monaco.editor.ITextModel | null => {
      const model = editor.getModel()
      return model && model.uri.toString() === modelUri(path).toString() ? model : null
    }

    const collapse = (): void => {
      if (!expanded) return
      const { zoneId, widget } = expanded
      editor.changeViewZones((acc) => acc.removeZone(zoneId))
      editor.removeOverlayWidget(widget)
      expanded = null
    }

    const expand = (hunk: DiffHunk): void => {
      const model = activeModel()
      if (!model) return
      collapse()
      const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo)
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)

      const dom = document.createElement('div')
      dom.className = 'aura-git-hunk'
      dom.dataset.testid = 'git-hunk'
      const bar = document.createElement('div')
      bar.className = 'aura-git-hunk-bar'
      const label = document.createElement('span')
      label.textContent =
        hunk.kind === 'added'
          ? `${hunk.endLine - hunk.startLine + 1} line(s) added since HEAD`
          : hunk.kind === 'deleted'
            ? `${hunk.oldLines.length} line(s) removed since HEAD`
            : `HEAD had ${hunk.oldLines.length} line(s) here`
      const revert = document.createElement('button')
      revert.textContent = 'Revert'
      revert.dataset.testid = 'git-hunk-revert'
      revert.onclick = (): void => {
        collapse()
        const m = activeModel()
        if (m) revertHunk(m, hunk)
        editor.focus()
      }
      const close = document.createElement('button')
      close.textContent = '✕'
      close.title = 'Close'
      close.onclick = (): void => collapse()
      bar.append(label, revert, close)
      dom.append(bar)
      if (hunk.oldLines.length > 0) {
        const old = document.createElement('pre')
        old.className = 'aura-git-hunk-old'
        old.style.fontFamily = fontInfo.fontFamily
        old.style.fontSize = `${fontInfo.fontSize}px`
        old.style.lineHeight = `${lineHeight}px`
        old.textContent = hunk.oldLines.join('\n')
        dom.append(old)
      }

      const shown = Math.min(hunk.oldLines.length, 20)
      const height = 26 + shown * lineHeight + (shown ? 6 : 0)
      // The view zone only makes room between the lines: its DOM sits in a
      // layer *under* the text, so a button inside it never gets the click.
      // The hunk itself is an overlay widget laid over that gap, moved along
      // as Monaco reports where the zone is - the same split Monaco's own
      // peek views (ZoneWidget) use.
      dom.style.position = 'absolute'
      dom.style.height = `${height}px`
      dom.style.top = '-1000px'
      const place = (top: number): void => {
        const layout = editor.getLayoutInfo()
        dom.style.top = `${top}px`
        dom.style.left = `${layout.contentLeft}px`
        dom.style.width = `${layout.contentWidth - layout.verticalScrollbarWidth}px`
      }
      const widget: monaco.editor.IOverlayWidget = {
        getId: () => 'aurapad.git-hunk',
        getDomNode: () => dom,
        getPosition: () => null
      }
      editor.addOverlayWidget(widget)
      editor.changeViewZones((acc) => {
        const zoneId = acc.addZone({
          // Above the changed lines, so the old text reads before the new;
          // a deletion's old text goes where it used to be.
          afterLineNumber: hunk.kind === 'deleted' ? hunk.startLine : hunk.startLine - 1,
          heightInPx: height,
          domNode: document.createElement('div'),
          onDomNodeTop: place
        })
        expanded = { zoneId, widget, hunk }
      })
    }

    const recompute = (): void => {
      const model = activeModel()
      const base = baseRef.current
      if (!model || !base || base.path !== path) {
        decorations.clear()
        hunksRef.current = []
        delete container.dataset.gitHunks
        return
      }
      const hunks = diffLines(base.lines, model.getLinesContent())
      hunksRef.current = hunks
      // Ground truth for the smoke suite, which can't trust Monaco's own DOM
      // (see AGENTS.md) - "added:3-4,deleted:7-7".
      container.dataset.gitHunks = hunks
        .map((h) => `${h.kind}:${h.startLine}-${h.endLine}`)
        .join(',')
      decorations.set(
        hunks.map((h) => {
          const line = Math.max(1, h.startLine)
          return {
            range: new monaco.Range(line, 1, h.kind === 'deleted' ? line : h.endLine, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName:
                HUNK_CLASS[h.kind] +
                (h.kind === 'deleted' && h.startLine === 0 ? ' aura-git-deleted-top' : ''),
              overviewRuler: {
                color: RULER_COLOR[h.kind],
                position: monaco.editor.OverviewRulerLane.Left
              }
            }
          }
        })
      )
      // The buffer moved under an open hunk: it no longer describes what is
      // there, so close it rather than leave stale text on screen.
      if (expanded && !hunks.some((h) => JSON.stringify(h) === JSON.stringify(expanded!.hunk))) {
        collapse()
      }
    }

    const schedule = (): void => {
      clearTimeout(timer)
      timer = setTimeout(recompute, DIFF_DELAY_MS)
    }

    window.api.getGitHeadContent(root, path.slice(root.length + 1)).then((text) => {
      if (cancelled) return
      baseRef.current = text === null ? null : { path, lines: splitLines(text) }
      recompute()
    })

    const subs = [
      editor.onDidChangeModelContent(schedule),
      editor.onDidChangeModel(() => {
        collapse()
        recompute()
      }),
      editor.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return
        const line = e.target.position?.lineNumber
        if (!line) return
        const hunk = hunkAt(hunksRef.current, line)
        if (!hunk) return
        if (expanded && JSON.stringify(expanded.hunk) === JSON.stringify(hunk)) collapse()
        else expand(hunk)
      }),
      editor.onKeyDown((e) => {
        if (e.keyCode === monaco.KeyCode.Escape && expanded) collapse()
      })
    ]

    return () => {
      cancelled = true
      clearTimeout(timer)
      subs.forEach((s) => s.dispose())
      collapse()
      decorations.clear()
      hunksRef.current = []
      delete container.dataset.gitHunks
    }
    // `repos` is a dependency on purpose: see baseRef above.
  }, [editor, path, root, repos, gutterEnabled])

  // Inline blame for the cursor line.
  useEffect(() => {
    if (!editor || !path || !root || !blameEnabled) return
    const decorations = editor.createDecorationsCollection()
    const container = editor.getContainerDomNode()
    const relPath = path.slice(root.length + 1)
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0

    const update = (): void => {
      clearTimeout(timer)
      decorations.clear()
      delete container.dataset.blame
      timer = setTimeout(async () => {
        const model = editor.getModel()
        const position = editor.getPosition()
        if (!model || !position || model.uri.toString() !== modelUri(path).toString()) return
        const line = position.lineNumber
        const id = ++request
        const blame = await window.api.gitBlameLine(root, relPath, line, model.getValue())
        if (id !== request || !blame || editor.getModel() !== model) return
        if (editor.getPosition()?.lineNumber !== line) return
        const col = model.getLineMaxColumn(line)
        container.dataset.blame = `${line}:${blameText(blame)}`
        decorations.set([
          {
            range: new monaco.Range(line, col, line, col),
            options: {
              after: { content: ' ' + blameText(blame), inlineClassName: 'aura-blame' },
              showIfCollapsed: true
            }
          }
        ])
      }, BLAME_DELAY_MS)
    }

    update()
    const subs = [
      editor.onDidChangeCursorPosition((e) => {
        if (e.reason !== monaco.editor.CursorChangeReason.ContentFlush) update()
      }),
      editor.onDidChangeModelContent(update),
      editor.onDidChangeModel(update)
    ]
    return () => {
      clearTimeout(timer)
      request++
      subs.forEach((s) => s.dispose())
      decorations.clear()
      delete container.dataset.blame
    }
  }, [editor, path, root, blameEnabled])
}
