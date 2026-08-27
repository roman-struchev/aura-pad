import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { alertDialog, confirmDialog } from '../lib/dialogs'
import { isExtensionPath } from '../../../shared/extensionTab'
import { isMarkdownPath } from '../lib/fileType'

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
//
// `isPathShared` lets a still-active Work Together session veto the usual
// dispose-on-close: that session's MonacoBinding was constructed against the
// specific model instance live at share time and never re-resolves it later,
// so disposing that model out from under it (and letting the tab reopen spin
// up a fresh one) silently breaks sync until the user re-shares.
//
// `stopSharing` covers the cases where the model *must* go away regardless -
// the shared file is renamed/moved or deleted in the tree, so the path it was
// shared under no longer exists. Ending the session first (synchronously
// destroys its MonacoBinding) means the model can then be disposed safely,
// instead of leaving a live binding pointing at a disposed model (whose next
// remote update throws) and a session orphaned under a path nothing maps to.
//
// `settingsLoaded` gates the once-only session restore below: `tabsEnabled`
// starts out as its DEFAULT_SETTINGS value and only becomes the user's own
// choice once main answers with the persisted settings, so restoring before
// that would restore the whole tab list for someone who turned tabs off.
// `ownsSession` is false in a window torn off a tab: it opens with the files
// it was given, and must neither restore the saved list nor write its own over
// it - only the primary window is the session of record (see createWindow in
// src/main/index.ts).
export function useTabs(
  tabsEnabled: boolean,
  settingsLoaded: boolean,
  isPathShared?: (path: string) => boolean,
  stopSharing?: (path: string) => void,
  ownsSession = true
) {
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const tabsRef = useRef<OpenTab[]>([])
  const pendingJump = useRef<JumpTarget | null>(null)
  const closedStackRef = useRef<string[]>([])
  // Bumped at the start of every openTab. Opening two files in quick
  // succession runs their reads concurrently, and the slower one used to
  // resolve last and steal the active tab back to the earlier file. Each
  // call captures its number and only claims the active tab / pending jump if
  // it's still the most recent open request - so the last file the user
  // actually opened wins, regardless of which read finishes first.
  const openSeqRef = useRef(0)
  // Guards the persistence effect below from firing (and overwriting the
  // saved session with an empty one) before the restore-on-mount effect has
  // had a chance to run.
  const hasRestoredRef = useRef(false)
  // Guards the restore effect itself from running twice - React 18
  // StrictMode (dev only) double-invokes mount effects, and since this one
  // is async, a second run can start before the first has committed its
  // tabs, both passing the "not already open" check and adding a duplicate.
  const restoreStartedRef = useRef(false)
  // Read by the paste handler below, which subscribes once and would otherwise
  // close over whichever tab was active when it did.
  const activeTabPathRef = useRef<string | null>(null)

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

  // The editor runs uncontrolled (defaultValue, not value) so typing doesn't
  // round-trip the whole file through React on every keystroke. The flip
  // side: state changes that don't originate from typing - external reload,
  // the Reload banner, Format Document - must be pushed into the Monaco
  // model explicitly. A full-range edit (not setValue) so the change lands
  // on the undo stack: Cmd+Z after a reload brings the previous buffer back.
  const applyContentToModel = (path: string, content: string): void => {
    const model = monaco.editor.getModel(monaco.Uri.parse(path))
    if (!model || model.getValue() === content) return
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
  }

  // Programmatic content replacement (Format Document, etc.): one undoable
  // edit that updates both the tab state and the live Monaco model.
  const setFileContent = (path: string, content: string): void => {
    applyContentToModel(path, content)
    updateTab(path, { content, isSaved: false })
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
    const seq = ++openSeqRef.current
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
    // In multi-tab mode both concurrently-opened files end up as tabs, so the
    // active tab / jump belong to the most recent open request only - a slower
    // read for an earlier file must not yank focus off the file opened after
    // it. In single-tab mode there's only ever one tab (setTabs replaces it),
    // so the active path must track whichever call's setTabs ran last, or it
    // could point at a file no longer open (blank editor); there the guard is
    // skipped and the last-resolved call wins, matching the tab it just set.
    if (tabsEnabled && openSeqRef.current !== seq) return
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

  // Pasting an image into a Markdown file writes it next to the document and
  // leaves a relative link behind, instead of Monaco pasting the clipboard's
  // text fallback (a file name, or nothing at all).
  //
  // On the document in the capture phase, not on the editor's own node: the
  // paste that reaches Monaco's hidden input is Monaco's to handle, and the
  // editor is remounted often enough (preview toggle, last tab closed) that
  // hanging a listener off each mount would stack them up.
  //
  // What is on the clipboard is read in main - the event only says whether
  // this paste carries an image at all (a screenshot as image data, or a file
  // copied in Finder/Explorer).
  useEffect(() => {
    activeTabPathRef.current = activeTabPath
  }, [activeTabPath])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.monaco-editor')) return
      const data = event.clipboardData
      const documentPath = activeTabPathRef.current
      if (!data || !documentPath || !isMarkdownPath(documentPath)) return
      const carriesImage =
        [...data.items].some((item) => item.type.startsWith('image/')) ||
        [...data.files].some((file) => file.type.startsWith('image/'))
      if (!carriesImage) return
      event.preventDefault()
      event.stopPropagation()
      void (async () => {
        const result = await window.api.savePastedImage(documentPath)
        if (!result.success || !result.relativePath) {
          if (result.error) alertDialog(result.error)
          return
        }
        const alt = decodeURIComponent(result.relativePath.split('/').pop() ?? 'image').replace(
          /\.[^.]+$/,
          ''
        )
        insertTextAtCursor(`![${alt}](${result.relativePath})`)
      })()
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [])

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

  // Flushes every dirty file tab to disk - this is also what autosave runs
  // (see the effect below), so it deliberately covers background tabs, not
  // just the active one. Called right before a branch switch too: an armed
  // autosave timer firing *after* the checkout would write the old branch's
  // buffer over the new branch's file - and the watcher would then suppress
  // that write's echo as a self-write, making the clobber completely silent.
  //
  // Tabs flagged with externalChangeAvailable are skipped: the file changed
  // on disk under them and the user hasn't decided yet (Reload/Ignore
  // banner), so writing our buffer over it would silently discard the other
  // side's change.
  const saveAllDirtyFileTabs = async (): Promise<void> => {
    for (const tab of tabsRef.current) {
      if (tab.isSaved || tab.externalChangeAvailable || isExtensionPath(tab.path)) continue
      const { path, content } = tab
      const result = await window.api.saveFile(path, content)
      // Same guard as handleSave: only mark saved if the buffer still holds
      // exactly what was written.
      if (result.success) {
        setTabs((prev) =>
          prev.map((t) => (t.path === path && t.content === content ? { ...t, isSaved: true } : t))
        )
      }
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
    //
    // Unless the path is still shared: a live Work Together session's
    // MonacoBinding is wired to this exact model object, not to whatever
    // `getModel(uri)` returns later. Disposing it here would silently
    // detach the session from the tab a reopen would spin up next - the
    // model has to keep living for as long as the session does.
    if (!isPathShared?.(path)) monaco.editor.getModel(monaco.Uri.parse(path))?.dispose()
  }

  // The part of closing that isn't the question: drop the tab and move the
  // selection to a sensible neighbour. Shared with detachTab, which has
  // nothing to confirm - the file is written and reopened, not discarded.
  const dropTab = (path: string): void => {
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

  const closeTab = async (path: string): Promise<void> => {
    const tab = tabsRef.current.find((t) => t.path === path)
    if (!tab) return
    if (!(await confirmCanClose(tab))) return
    dropTab(path)
  }

  // Move a tab between windows: out into one of its own, or back to the main
  // window. Either way the receiving window reads the file from disk, so an
  // unsaved buffer is flushed first - otherwise the edits would still be here,
  // in a tab that is about to disappear. A failed write leaves everything
  // where it is rather than losing them.
  const moveTabToWindow = async (path: string, back: boolean): Promise<boolean> => {
    const tab = tabsRef.current.find((t) => t.path === path)
    if (!tab) return false
    if (!tab.isSaved && !isExtensionPath(path)) {
      const result = await window.api.saveFile(path, tab.content)
      if (!result.success) return false
      updateTab(path, { isSaved: true })
    }
    if (back) {
      // The last tab going home takes the window with it: a torn-off window
      // with nothing in it is just an empty frame.
      window.api.moveTabToPrimary(path, tabsRef.current.length <= 1)
    } else {
      window.api.openInNewWindow([path])
    }
    dropTab(path)
    return true
  }

  const detachTab = (path: string): Promise<boolean> => moveTabToWindow(path, false)
  const returnTab = (path: string): Promise<boolean> => moveTabToWindow(path, true)

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

  // Pinning clusters tabs at the front of the strip: a freshly pinned tab
  // slides in right after the last already-pinned tab (so it becomes the last
  // of the pinned group), and unpinning drops it back to the same spot - i.e.
  // the first unpinned position. Both cases insert right after the last pinned
  // tab, so the pinned cluster always stays contiguous and leftmost.
  const togglePin = (path: string): void => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path)
      if (idx === -1) return prev
      const moved = { ...prev[idx], pinned: !prev[idx].pinned }
      const rest = prev.filter((_, i) => i !== idx)
      let lastPinned = -1
      rest.forEach((t, i) => {
        if (t.pinned) lastPinned = i
      })
      const next = [...rest]
      next.splice(lastPinned + 1, 0, moved)
      return next
    })
  }

  // Flip a tab's preview mode, reading its current state inside the functional
  // update rather than from a render-time closure. The tree's eye icon calls
  // this right after openTab: computing "was it previewing?" from a captured
  // `tabs` snapshot raced with rapid clicks (and the stable-callback ref lag),
  // so clicking the eye on a *different* file was sometimes mis-read as a
  // repeat toggle and dropped the user back to source.
  const togglePreview = (path: string): void => {
    setTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, showPreview: !t.showPreview } : t))
    )
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
      const content = result.content || ''
      applyContentToModel(activeTabPath, content)
      updateTab(activeTabPath, {
        content,
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
      // A live share under the old path can't follow the rename (its session
      // is keyed to that path on the backend), so end it before freeing the
      // model its binding holds.
      if (isPathShared?.(oldTabPath)) stopSharing?.(oldTabPath)
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
      // The file is gone from disk, so a share under it can't continue - end
      // the session before disposing the model its binding holds.
      if (isPathShared?.(tab.path)) stopSharing?.(tab.path)
      monaco.editor.getModel(monaco.Uri.parse(tab.path))?.dispose()
    }
    closedStackRef.current = closedStackRef.current.filter((p) => !isAffected(p))
    setActiveTabPath((prev) => {
      if (!prev || !isAffected(prev)) return prev
      const remaining = tabsRef.current.filter((t) => !isAffected(t.path))
      return remaining.length > 0 ? remaining[remaining.length - 1].path : null
    })
  }

  // Autosave: after a short pause in typing, save automatically - every dirty
  // tab, not just the active one. Keyed on `tabs` (a new array on every
  // keystroke, since updateTab replaces it) so typing keeps pushing the
  // deadline out; switching tabs doesn't touch `tabs`, so the armed timer
  // survives it and still flushes the tab that was just left behind. Before,
  // the timer was cleared by the activeTabPath dep and a dirty tab could sit
  // unsaved indefinitely, with only the on-quit prompt catching it.
  const hasDirtyFileTabs = tabs.some(
    (t) => !t.isSaved && !t.externalChangeAvailable && !isExtensionPath(t.path)
  )
  useEffect(() => {
    if (!hasDirtyFileTabs) return
    const timer = setTimeout(() => {
      saveAllDirtyFileTabs()
    }, 1200)
    return () => clearTimeout(timer)
  }, [tabs, hasDirtyFileTabs])

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
        if (!result.success) return
        const content = result.content || ''
        // Re-checked after the await: the user may have started typing while
        // the file was being read - a branch switch changes many files at
        // once, so this window is very real. Their buffer wins; surface the
        // banner instead of clobbering it. (The same check runs again inside
        // the functional update below, against the definitively-current
        // state; and the model edit is undoable either way.)
        if (!tabsRef.current.find((t) => t.path === changedPath)?.isSaved) {
          updateTab(changedPath, { externalChangeAvailable: true })
          return
        }
        applyContentToModel(changedPath, content)
        setTabs((prev) =>
          prev.map((t) => {
            if (t.path !== changedPath) return t
            if (!t.isSaved) return { ...t, externalChangeAvailable: true }
            return { ...t, content, isSaved: true }
          })
        )
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
    // Waits for the real `tabsEnabled`: this effect runs once and then never
    // again, so starting it while settings are still the defaults would
    // permanently pick the wrong restore mode (see the hook's doc comment).
    if (!settingsLoaded) return
    if (restoreStartedRef.current) return
    restoreStartedRef.current = true
    if (!ownsSession) {
      // Nothing to restore, and nothing to guard the persistence effect from:
      // it is disabled outright below.
      hasRestoredRef.current = true
      return
    }
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
  }, [tabsEnabled, settingsLoaded, ownsSession])

  // Persist the open tab list (paths, active tab, pinned state - not
  // content, which is re-read from disk on restore) so it survives an app
  // restart. Debounced since tab/content changes can fire in quick bursts.
  useEffect(() => {
    if (!hasRestoredRef.current || !ownsSession) return
    const timer = setTimeout(() => {
      window.api.saveOpenTabs({
        paths: tabsRef.current.map((t) => t.path),
        activeTabPath,
        pinnedPaths: tabsRef.current.filter((t) => t.pinned).map((t) => t.path)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [tabs, activeTabPath, ownsSession])

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
    setFileContent,
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    handleCloseFile,
    reopenClosedTab,
    getUnsavedCount,
    togglePin,
    togglePreview,
    reorderTab,
    detachTab,
    returnTab,
    handleSave,
    saveAllDirtyFileTabs,
    handleEditorChange,
    insertTextAtCursor,
    handleEditorDidMount,
    getSelectedText,
    reloadFromDisk,
    remapTabPaths,
    closeTabsUnder
  }
}
