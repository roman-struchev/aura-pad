import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { alertDialog, confirmDialog } from '../lib/dialogs'
import { isExtensionPath } from '../../../shared/extensionTab'

export type OpenTab = {
  path: string
  content: string
  isSaved: boolean
  externalChangeAvailable: boolean
  showPreview: boolean
  pinned?: boolean
}

const CLOSED_STACK_LIMIT = 10

// A jump target inside a file: a bare line (cursor goes to its start), or -
// when coming from search - the exact matched range, which gets selected so
// the user sees what they searched for.
export type JumpTarget = { line: number; col?: number; matchLen?: number }

// Manages the set of open files (tab-bar style): opening/closing/saving,
// autosave, reacting to external changes on disk, and keeping tab paths in
// sync when a file is renamed/moved/deleted elsewhere (the file tree).
export function useTabs(tabsEnabled: boolean) {
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const tabsRef = useRef<OpenTab[]>([])
  const pendingJump = useRef<JumpTarget | null>(null)
  const closedStackRef = useRef<string[]>([])
  // Guards the persistence effect below from firing (and overwriting the
  // saved session with an empty one) before the restore-on-mount effect has
  // had a chance to run.
  const hasRestoredRef = useRef(false)
  // Guards the restore effect itself from running twice - React 18
  // StrictMode (dev only) double-invokes mount effects, and since this one
  // is async, a second run can start before the first has committed its
  // tabs, both passing the "not already open" check and adding a duplicate.
  const restoreStartedRef = useRef(false)

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null
  const selectedPath = activeTab?.path ?? null
  const fileContent = activeTab?.content ?? ''
  const isSaved = activeTab?.isSaved ?? true
  const externalChangeAvailable = activeTab?.externalChangeAvailable ?? false
  const showMarkdownPreview = activeTab?.showPreview ?? false

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const updateTab = (path: string, patch: Partial<OpenTab>): void => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, ...patch } : t)))
  }

  const scrollToTarget = (target: JumpTarget): void => {
    const editor = editorRef.current
    if (!editor) return
    const { line, col, matchLen } = target
    if (col && matchLen) {
      const range = new monaco.Range(line, col, line, col + matchLen)
      editor.setSelection(range)
      editor.revealRangeInCenter(range)
    } else {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: 1 })
    }
    editor.focus()
  }

  // Jump to a specific line once the editor is showing the right content,
  // whether that's from opening a search result or switching tabs. Uses a
  // ref (not state) for the pending target so consuming it doesn't itself
  // trigger a state update from inside this effect.
  useEffect(() => {
    if (pendingJump.current !== null) {
      scrollToTarget(pendingJump.current)
      pendingJump.current = null
    }
  }, [fileContent])

  const openTab = async (
    filePath: string,
    line?: number,
    highlight?: { col: number; matchLen: number }
  ): Promise<void> => {
    // Checked against the ref (not the `tabs` state closure) so a second
    // concurrent call - e.g. dropping several files from Finder at once, or
    // two open-file requests arriving back to back - sees any tab the first
    // call has already committed, not a stale snapshot from render time.
    if (tabsRef.current.some((t) => t.path === filePath)) {
      setActiveTabPath(filePath)
      if (line) {
        const target = { line, ...highlight }
        // If the editor is already showing this very file, `fileContent`
        // won't change and the pending-jump effect above would never fire -
        // jump right away instead.
        if (editorRef.current?.getModel()?.uri.toString() === monaco.Uri.parse(filePath).toString())
          scrollToTarget(target)
        else pendingJump.current = target
      }
      return
    }

    // Single-tab mode swaps out whatever is currently open, which is a close
    // in disguise: it must go through the same pinned/unsaved confirmation as
    // closeTab, or opening a file would silently throw away unsaved edits.
    if (!tabsEnabled) {
      for (const tab of tabsRef.current) {
        if (tab.path !== filePath && !(await confirmCanClose(tab))) return
      }
    }

    // Extension tabs (ext://...) have no file behind them - nothing to read
    // from disk. Everything downstream is already safe for them: autosave is
    // gated on isSaved (always true here), the watcher only ever reports real
    // paths, and disposing a monaco model for an ext:// URI is a no-op.
    let content = ''
    if (!isExtensionPath(filePath)) {
      const result = await window.api.readFile(filePath)
      if (!result.success) {
        await alertDialog(result.error || 'Failed to open file.')
        return
      }
      content = result.content || ''
    }

    // Only once the new file has actually been read: the replaced tab also
    // needs the full close path (closed-tabs stack, Monaco model disposal),
    // not just being dropped by the [newTab] overwrite below.
    if (!tabsEnabled) {
      for (const tab of tabsRef.current) {
        if (tab.path !== filePath) removeTabFromState(tab.path)
      }
    }

    const newTab: OpenTab = {
      path: filePath,
      content,
      isSaved: true,
      externalChangeAvailable: false,
      showPreview: false
    }

    // Final dedup inside the functional update itself: two concurrent calls
    // can both pass the check above before either's readFile resolves, so
    // whichever's setTabs runs second must still see the first one's tab and
    // back off, rather than adding a second tab for the same path.
    setTabs((prev) => {
      if (prev.some((t) => t.path === filePath)) return prev
      return tabsEnabled ? [...prev, newTab] : [newTab]
    })
    setActiveTabPath(filePath)
    if (line) pendingJump.current = { line, ...highlight }
  }

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor): void => {
    editorRef.current = editor
  }

  // What's currently selected in the editor, '' when nothing is. Feeds the
  // IDEA-style "open search prefilled with the selection" behavior.
  const getSelectedText = (): string => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!model || !selection || selection.isEmpty()) return ''
    return model.getValueInRange(selection)
  }

  // Voice dictation lands here: replace the current selection (or insert at
  // the cursor) via executeEdits, which flows through the normal onChange
  // path (so tab state updates) and stays a single undo step. Adds a leading
  // space when gluing onto a word, since transcribed text arrives trimmed.
  const insertTextAtCursor = (text: string): void => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!editor || !model || !selection || !text) return
    const { startLineNumber, startColumn } = selection
    const charBefore =
      startColumn > 1
        ? model.getValueInRange(
            new monaco.Range(startLineNumber, startColumn - 1, startLineNumber, startColumn)
          )
        : ''
    const needsSpace = charBefore !== '' && !/\s/.test(charBefore)
    editor.executeEdits('voice-dictation', [
      { range: selection, text: needsSpace ? ` ${text}` : text, forceMoveMarkers: true }
    ])
    editor.focus()
  }

  const handleEditorChange = (value: string | undefined): void => {
    if (value !== undefined && activeTabPath) {
      updateTab(activeTabPath, { content: value, isSaved: false })
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!activeTab || activeTab.isSaved) return
    const { path, content } = activeTab
    const result = await window.api.saveFile(path, content)
    // Marked saved only if the buffer still holds exactly what was written -
    // edits typed while the (possibly slow) write was in flight must keep the
    // tab dirty, or closing it would skip the unsaved-changes prompt and lose
    // them.
    if (result.success) {
      setTabs((prev) =>
        prev.map((t) => (t.path === path && t.content === content ? { ...t, isSaved: true } : t))
      )
    }
  }

  // Shared pinned/unsaved confirmation for any close path (single or bulk).
  const confirmCanClose = async (tab: OpenTab): Promise<boolean> => {
    if (tab.pinned && !(await confirmDialog('This tab is pinned. Close anyway?'))) return false
    if (!tab.isSaved && !(await confirmDialog('You have unsaved changes. Close without saving?')))
      return false
    return true
  }

  // Always a functional update, so bulk closes (which call this in a loop,
  // each iteration awaiting a possible confirm dialog first) can't clobber
  // each other by acting on a stale `tabs` snapshot from render time.
  const removeTabFromState = (path: string): void => {
    setTabs((prev) => prev.filter((t) => t.path !== path))
    closedStackRef.current = closedStackRef.current.filter((p) => p !== path)
    closedStackRef.current.push(path)
    if (closedStackRef.current.length > CLOSED_STACK_LIMIT) closedStackRef.current.shift()

    // Monaco keeps every path's model alive for the life of the app (so
    // switching back to a still-open tab preserves its undo history) - once
    // a tab is actually closed there's no way back to it except reopening
    // fresh from disk, so free the model rather than leaking its full text
    // and edit history for the rest of the session. `Uri.parse` (not
    // `Uri.file`) to match the URI @monaco-editor/react itself builds from
    // the `path` prop internally.
    monaco.editor.getModel(monaco.Uri.parse(path))?.dispose()
  }

  const closeTab = async (path: string): Promise<void> => {
    const tab = tabsRef.current.find((t) => t.path === path)
    if (!tab) return
    if (!(await confirmCanClose(tab))) return

    const currentTabs = tabsRef.current
    const idx = currentTabs.findIndex((t) => t.path === path)
    removeTabFromState(path)

    if (activeTabPath === path) {
      const filtered = currentTabs.filter((t) => t.path !== path)
      const next = filtered[idx] ?? filtered[idx - 1] ?? null
      setActiveTabPath(next ? next.path : null)
    }
    pendingJump.current = null
  }

  const handleCloseFile = (): void => {
    if (!activeTabPath) return
    closeTab(activeTabPath)
  }

  // Closes every open tab except keepPath, activating keepPath once done.
  // Respects each tab's own pinned/unsaved confirmation, same as closeTab.
  const closeOtherTabs = async (keepPath: string): Promise<void> => {
    for (const tab of tabsRef.current.filter((t) => t.path !== keepPath)) {
      if (await confirmCanClose(tab)) removeTabFromState(tab.path)
    }
    setActiveTabPath(keepPath)
    pendingJump.current = null
  }

  const closeAllTabs = async (): Promise<void> => {
    // Tracks declined-to-close tabs directly, rather than re-checking
    // tabsRef afterwards - the ref only catches up with removals once React
    // has re-rendered and the sync effect below has run, which isn't
    // guaranteed yet at this point if nothing needed a confirm dialog.
    const survivors: string[] = []
    for (const tab of tabsRef.current) {
      if (await confirmCanClose(tab)) removeTabFromState(tab.path)
      else survivors.push(tab.path)
    }
    setActiveTabPath(survivors.length > 0 ? survivors[survivors.length - 1] : null)
    pendingJump.current = null
  }

  // Cmd+Shift+T: reopen the most recently closed tab, browser-style.
  const reopenClosedTab = (): void => {
    const path = closedStackRef.current.pop()
    if (path) openTab(path)
  }

  // Reads from the ref (not `tabs` state) so callers registered once (e.g. an
  // effect with empty deps) always see the current tab list, not a stale
  // closure from whenever they subscribed.
  const getUnsavedCount = (): number => tabsRef.current.filter((t) => !t.isSaved).length

  const togglePin = (path: string): void => {
    const tab = tabs.find((t) => t.path === path)
    if (tab) updateTab(path, { pinned: !tab.pinned })
  }

  // Reorders tabs by moving sourcePath to targetPath's index (drag & drop in the tab bar).
  const reorderTab = (sourcePath: string, targetPath: string): void => {
    if (sourcePath === targetPath) return
    setTabs((prev) => {
      const sourceIdx = prev.findIndex((t) => t.path === sourcePath)
      const targetIdx = prev.findIndex((t) => t.path === targetPath)
      if (sourceIdx === -1 || targetIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(sourceIdx, 1)
      next.splice(targetIdx, 0, moved)
      return next
    })
  }

  const reloadFromDisk = async (): Promise<void> => {
    if (!activeTabPath) return
    const result = await window.api.readFile(activeTabPath)
    if (result.success) {
      updateTab(activeTabPath, {
        content: result.content || '',
        isSaved: true,
        externalChangeAvailable: false
      })
    } else {
      updateTab(activeTabPath, { externalChangeAvailable: false })
    }
  }

  // Keep open tab paths in sync when a file/folder is renamed or moved in
  // the tree - otherwise the tab would keep pointing at the old path.
  const remapTabPaths = (oldPath: string, newPath: string): void => {
    // Read before the state update (not computed inside setTabs' updater,
    // which must stay side-effect free) so the old paths' now-orphaned
    // Monaco models - nothing points at them anymore once the tab's path
    // changes below - can be freed instead of leaking for the rest of the
    // session, same as closing a tab outright does.
    const affectedOldPaths = tabsRef.current
      .filter((t) => t.path === oldPath || t.path.startsWith(oldPath + '/'))
      .map((t) => t.path)

    setTabs((prev) =>
      prev.map((t) => {
        if (t.path === oldPath) return { ...t, path: newPath }
        if (t.path.startsWith(oldPath + '/'))
          return { ...t, path: newPath + t.path.slice(oldPath.length) }
        return t
      })
    )
    for (const oldTabPath of affectedOldPaths) {
      monaco.editor.getModel(monaco.Uri.parse(oldTabPath))?.dispose()
    }
    setActiveTabPath((prev) => {
      if (!prev) return prev
      if (prev === oldPath) return newPath
      if (prev.startsWith(oldPath + '/')) return newPath + prev.slice(oldPath.length)
      return prev
    })
  }

  // Close any tabs pointing at a path (or, for a deleted folder, any path
  // underneath it) that was deleted in the tree.
  const closeTabsUnder = (deletedPath: string, isDirectory: boolean): void => {
    const isAffected = (p: string) =>
      p === deletedPath || (isDirectory && p.startsWith(deletedPath + '/'))
    // Ref + functional updates, like every other bulk close: the tree's
    // deletion callback can fire from a stale render's closure, and acting on
    // that snapshot would resurrect tabs closed (or drop ones opened) since.
    const closing = tabsRef.current.filter((t) => isAffected(t.path))
    setTabs((prev) => prev.filter((t) => !isAffected(t.path)))
    // The paths are gone from disk: free their Monaco models (same policy as
    // removeTabFromState) and drop them from the reopen stack, where they
    // could only fail to reopen.
    for (const tab of closing) {
      monaco.editor.getModel(monaco.Uri.parse(tab.path))?.dispose()
    }
    closedStackRef.current = closedStackRef.current.filter((p) => !isAffected(p))
    setActiveTabPath((prev) => {
      if (!prev || !isAffected(prev)) return prev
      const remaining = tabsRef.current.filter((t) => !isAffected(t.path))
      return remaining.length > 0 ? remaining[remaining.length - 1].path : null
    })
  }

  // Autosave: after a short pause in typing, save automatically.
  useEffect(() => {
    if (!activeTabPath || isSaved || externalChangeAvailable) return
    const timer = setTimeout(() => {
      handleSave()
    }, 1200)
    return () => clearTimeout(timer)
  }, [fileContent, activeTabPath, isSaved, externalChangeAvailable])

  // React to a file changing on disk from outside the app (another editor,
  // git, another window of this app). If we have no local edits it's safe to
  // just reload; otherwise flag it and surface a banner instead of clobbering
  // the user's in-progress changes.
  useEffect(() => {
    const unsubscribe = window.api.onFileChangedExternally(async (changedPath) => {
      const tab = tabsRef.current.find((t) => t.path === changedPath)
      if (!tab) return
      if (tab.isSaved) {
        const result = await window.api.readFile(changedPath)
        if (result.success) updateTab(changedPath, { content: result.content || '', isSaved: true })
      } else {
        updateTab(changedPath, { externalChangeAvailable: true })
      }
    })
    return unsubscribe
  }, [])

  // Restore last session's open tabs on launch. Only paths (not content) are
  // persisted, so each is re-read from disk here; ones that no longer exist
  // (deleted/moved since last run) are silently skipped rather than showing
  // an error, since this isn't a user-initiated open. In single-tab mode
  // (tabsEnabled off) only the previously active file is restored.
  useEffect(() => {
    if (restoreStartedRef.current) return
    restoreStartedRef.current = true
    ;(async () => {
      const state = await window.api.getOpenTabs()
      const pathsToRestore = tabsEnabled
        ? state.paths
        : state.activeTabPath
          ? [state.activeTabPath]
          : []

      const restored: OpenTab[] = []
      for (const p of pathsToRestore) {
        if (tabsRef.current.some((t) => t.path === p)) continue
        // Extension tabs are recreated as-is; whether the extension id still
        // resolves to anything is the renderer's problem (unknown ids just
        // render an empty state), same spirit as silently skipping deleted
        // files below.
        let content = ''
        if (!isExtensionPath(p)) {
          const result = await window.api.readFile(p)
          if (!result.success) continue
          content = result.content || ''
        }
        restored.push({
          path: p,
          content,
          isSaved: true,
          externalChangeAvailable: false,
          showPreview: false,
          pinned: state.pinnedPaths.includes(p)
        })
      }

      if (restored.length > 0) {
        // Re-checked against `prev` (not just the pre-restore tabsRef
        // snapshot above) so a tab opened concurrently while these files
        // were being read from disk - e.g. the OS/CLI delivering the same
        // path as the one being restored - can't end up duplicated.
        setTabs((prev) => {
          const existing = new Set(prev.map((t) => t.path))
          const toAdd = restored.filter((t) => !existing.has(t.path))
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev
        })
        const activePath =
          state.activeTabPath && restored.some((t) => t.path === state.activeTabPath)
            ? state.activeTabPath
            : restored[restored.length - 1].path
        setActiveTabPath((prev) => prev ?? activePath)
      }
      hasRestoredRef.current = true
    })()
  }, [tabsEnabled])

  // Persist the open tab list (paths, active tab, pinned state - not
  // content, which is re-read from disk on restore) so it survives an app
  // restart. Debounced since tab/content changes can fire in quick bursts.
  useEffect(() => {
    if (!hasRestoredRef.current) return
    const timer = setTimeout(() => {
      window.api.saveOpenTabs({
        paths: tabsRef.current.map((t) => t.path),
        activeTabPath,
        pinnedPaths: tabsRef.current.filter((t) => t.pinned).map((t) => t.path)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [tabs, activeTabPath])

  return {
    tabs,
    activeTabPath,
    setActiveTabPath,
    activeTab,
    selectedPath,
    fileContent,
    isSaved,
    externalChangeAvailable,
    showMarkdownPreview,
    updateTab,
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    handleCloseFile,
    reopenClosedTab,
    getUnsavedCount,
    togglePin,
    reorderTab,
    handleSave,
    handleEditorChange,
    insertTextAtCursor,
    handleEditorDidMount,
    getSelectedText,
    reloadFromDisk,
    remapTabPaths,
    closeTabsUnder
  }
}
