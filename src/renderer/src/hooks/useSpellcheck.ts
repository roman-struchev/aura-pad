import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import SpellWorker from '../lib/spell/spellWorker?worker'
import type { SpellIssue, SpellWorkerResponse } from '../lib/spell/spellWorker'
import { useModelWorker } from './useModelWorker'
import { useStableCallback } from '../lib/useStableCallback'
import { isProsePath } from '../lib/fileType'
import type { SpellLanguage } from '../../../shared/spellcheck'

// Spell checking for prose files: unknown words become Monaco markers, which
// gives the squiggle, the hover, and the quick-fix menu (replacements plus
// "Add to Dictionary") without inventing any of them.
//
// Only prose - .md/.txt, the same files read-aloud and dictation work on.
// Running it over source would underline every identifier that isn't an
// English word, which is most of them.

const MARKER_OWNER = 'spellcheck'
const MARKER_SOURCE = 'Spelling'
// Long enough for any note; a novel-sized file would spend more time being
// checked than it is worth, and the squiggles past this point are not what
// anyone is looking at.
const MAX_CHECKED_CHARS = 200_000
// Long enough that typing a sentence produces one check, short enough that
// the squiggle appears while the thought is still fresh.
const DEBOUNCE_MS = 600

interface SpellcheckOptions {
  enabled: boolean
  languages: SpellLanguage[]
  // Words the user added from the editor; checked case-insensitively.
  userWords: string[]
  path: string | null
  content: string
  onAddWord: (word: string) => void
}

export interface Spellcheck {
  issues: SpellIssue[]
  // Moves the cursor to the next unknown word after the caret (wrapping), and
  // selects it - the toolbar's issue count is a button, not a badge.
  revealNextIssue: (editor: monaco.editor.IStandaloneCodeEditor | null) => void
}

// Monaco commands and providers are registered once per process, while the
// React state they need is not - so the quick-fix provider calls through
// these, the same trick the .http CodeLens uses.
let suggestHandler: ((word: string) => Promise<string[]>) | null = null
let addWordHandler: ((word: string) => void) | null = null
let providerRegistered = false

const ADD_WORD_COMMAND = 'aurapad.spell.addWord'

function registerQuickFixes(): void {
  if (providerRegistered) return
  providerRegistered = true

  monaco.editor.registerCommand(ADD_WORD_COMMAND, (_accessor, word: string) =>
    addWordHandler?.(word)
  )

  monaco.languages.registerCodeActionProvider(
    { scheme: '*', pattern: '**' },
    {
      provideCodeActions: async (model, _range, context) => {
        const markers = context.markers.filter((m) => m.source === MARKER_SOURCE)
        if (markers.length === 0 || !suggestHandler)
          return { actions: [], dispose: () => undefined }

        const actions: monaco.languages.CodeAction[] = []
        for (const marker of markers) {
          const range = new monaco.Range(
            marker.startLineNumber,
            marker.startColumn,
            marker.endLineNumber,
            marker.endColumn
          )
          const word = model.getValueInRange(range)
          for (const suggestion of await suggestHandler(word)) {
            actions.push({
              title: suggestion,
              kind: 'quickfix',
              diagnostics: [marker],
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: undefined,
                    textEdit: { range, text: suggestion }
                  }
                ]
              }
            })
          }
          actions.push({
            title: `Add "${word}" to Dictionary`,
            kind: 'quickfix',
            diagnostics: [marker],
            command: { id: ADD_WORD_COMMAND, title: 'Add to Dictionary', arguments: [word] }
          })
        }
        return { actions, dispose: () => undefined }
      }
    }
  )
}

export function useSpellcheck({
  enabled,
  languages,
  userWords,
  path,
  content,
  onAddWord
}: SpellcheckOptions): Spellcheck {
  // Keyed by path so a stale answer for the previous tab is never shown
  // against the current one.
  const [result, setResult] = useState<{ path: string; issues: SpellIssue[] } | null>(null)
  const loadedRef = useRef<Set<SpellLanguage>>(new Set())
  const requestRef = useRef({ id: 0, path: '' })
  const suggestId = useRef(0)
  const pendingSuggestions = useRef(new Map<number, (words: string[]) => void>())
  const userWordsRef = useRef(userWords)
  // Written in an effect, not during render: the check request and the
  // suggestion handler both read it from outside React's own flow.
  useEffect(() => {
    userWordsRef.current = userWords
  }, [userWords])

  const applyMarkers = (targetPath: string, issues: SpellIssue[]): void => {
    const model = monaco.editor.getModel(monaco.Uri.parse(targetPath))
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      issues.map((issue) => {
        const start = model.getPositionAt(issue.offset)
        const end = model.getPositionAt(issue.offset + issue.word.length)
        return {
          severity: monaco.MarkerSeverity.Info,
          source: MARKER_SOURCE,
          message: `"${issue.word}" is not in the dictionary`,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column
        }
      })
    )
  }

  const handleMessage = useStableCallback((message: SpellWorkerResponse): void => {
    if (message.type === 'checked') {
      if (message.id !== requestRef.current.id) return
      const target = requestRef.current.path
      applyMarkers(target, message.issues)
      setResult({ path: target, issues: message.issues })
      return
    }
    if (message.type === 'suggestions') {
      pendingSuggestions.current.get(message.id)?.(message.words)
      pendingSuggestions.current.delete(message.id)
      return
    }
    if (message.type === 'error') console.warn('Spell checker:', message.message)
  })

  const worker = useModelWorker<SpellWorkerResponse>({
    create: () => new SpellWorker(),
    onMessage: handleMessage,
    onStartupError: (message) => console.warn('Spell checker failed to start:', message),
    // Nothing is ever mid-flight for long enough to matter; the dictionaries
    // are what the idle timer is here to reclaim.
    isIdle: () => true,
    onIdleUnload: () => loadedRef.current.clear(),
    onProgress: () => undefined
  })

  // Dictionaries are read from main (they live in userData) and handed over
  // as text once per language per worker.
  const ensureLoaded = useStableCallback(async (): Promise<void> => {
    for (const lang of languages) {
      if (loadedRef.current.has(lang)) continue
      const files = await window.api.spellReadDictionary(lang)
      if (!files.success || !files.aff || !files.dic) continue
      loadedRef.current.add(lang)
      worker.getWorker().postMessage({ type: 'load', lang, aff: files.aff, dic: files.dic })
    }
    for (const lang of [...loadedRef.current]) {
      if (languages.includes(lang)) continue
      loadedRef.current.delete(lang)
      worker.getWorker().postMessage({ type: 'unload', lang })
    }
  })

  const off = !enabled || languages.length === 0 || !isProsePath(path)
  // Arrays out of settings: their contents are what a re-check depends on,
  // not the identity of the array React handed us this render.
  const languageKey = languages.join(',')
  const userWordKey = userWords.join(',')

  useEffect(() => {
    if (off || !path) {
      // Turning it off (or opening a source file) has to take the squiggles
      // with it, in every model that still carries them.
      for (const model of monaco.editor.getModels()) {
        if (monaco.editor.getModelMarkers({ owner: MARKER_OWNER, resource: model.uri }).length) {
          monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
        }
      }
      return
    }
    const timer = setTimeout(() => {
      void (async () => {
        await ensureLoaded()
        const id = requestRef.current.id + 1
        requestRef.current = { id, path }
        worker.getWorker().postMessage({
          type: 'check',
          id,
          text: content.slice(0, MAX_CHECKED_CHARS),
          ignore: userWordsRef.current
        })
      })()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [off, path, content, languageKey, userWordKey, ensureLoaded, worker])

  // The quick-fix menu's two sides: replacements come from the worker, and
  // "Add to Dictionary" goes back into settings.
  useEffect(() => {
    registerQuickFixes()
    suggestHandler = (word) =>
      new Promise((resolve) => {
        if (off) {
          resolve([])
          return
        }
        const id = ++suggestId.current
        pendingSuggestions.current.set(id, resolve)
        worker.getWorker().postMessage({ type: 'suggest', id, word, ignore: userWordsRef.current })
        // A worker that never answers must not leave the menu hanging.
        setTimeout(() => {
          if (pendingSuggestions.current.delete(id)) resolve([])
        }, 3000)
      })
    addWordHandler = onAddWord
  }, [off, onAddWord, worker])

  const issues = !off && result?.path === path ? result.issues : []

  const revealNextIssue = (editor: monaco.editor.IStandaloneCodeEditor | null): void => {
    const model = editor?.getModel()
    if (!editor || !model || issues.length === 0) return
    const caret = model.getOffsetAt(editor.getPosition() ?? { lineNumber: 1, column: 1 })
    const next = issues.find((issue) => issue.offset > caret) ?? issues[0]
    const start = model.getPositionAt(next.offset)
    const end = model.getPositionAt(next.offset + next.word.length)
    editor.setSelection(monaco.Range.fromPositions(start, end))
    editor.revealPositionInCenterIfOutsideViewport(start)
    editor.focus()
  }

  return { issues, revealNextIssue }
}
