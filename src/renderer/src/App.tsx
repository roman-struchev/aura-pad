import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { FileNode } from './components/FileTree'
import { GlobalSearch } from './components/GlobalSearch'
import { FileSearch } from './components/FileSearch'
import { MarkdownPreview } from './components/MarkdownPreview'
import { HtmlPreview } from './components/HtmlPreview'
import { SettingsModal } from './components/SettingsModal'
import { TabBar } from './components/TabBar'
import { Sidebar } from './components/Sidebar'
import { AppHeader } from './components/AppHeader'
import { TerminalPanel } from './components/TerminalPanel'
import { UpdateToast } from './components/UpdateToast'
import { NameInputModal } from './components/NameInputModal'
import { AiModals } from './components/AiModals'
import { GoogleTasksTab } from './components/GoogleTasksTab'
import { GoogleTasksConfigModal } from './components/GoogleTasksConfigModal'
import { makeExtensionPath, parseExtensionPath } from '../../shared/extensionTab'
import { TreeContextMenu } from './components/TreeContextMenu'
import { DENSITY } from './density'
import { useTheme } from './hooks/useTheme'
import { useSettings } from './hooks/useSettings'
import { useTerminals } from './hooks/useTerminals'
import { useTabs } from './hooks/useTabs'
import { useWorkspaceTree } from './hooks/useWorkspaceTree'
import { useGitStatus } from './hooks/useGitStatus'
import { useDiagnostics } from './hooks/useDiagnostics'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { useRecentExternalFiles } from './hooks/useRecentExternalFiles'
import { useVoiceInput } from './hooks/useVoiceInput'
import { useReadAloud } from './hooks/useReadAloud'
import { useTranslate } from './hooks/useTranslate'
import { useMenuActions } from './hooks/useMenuActions'
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys'
import type { UpdateNotification } from '../../shared/updateNotification'
import { TranslatePopup } from './components/TranslatePopup'
import { DialogHost } from './components/DialogHost'
import { alertDialog, confirmDialog } from './lib/dialogs'
import { useStableCallback } from './lib/useStableCallback'
import { findRepoForRoot } from './lib/repoForRoot'
import { isHtmlPath, isPreviewablePath, isProsePath, isMarkdownPath } from './lib/fileType'
import { getLanguage } from './lib/language'
import { getMonacoTheme } from './lib/editorTheme'
import { dirname, isUnderAnyRoot } from './lib/path'
import { prettyPrintMarkup } from './lib/formatMarkup'
import { quoteForShell } from './lib/shellQuote'
import { MONO_FONT_FAMILY } from './lib/fonts'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import clsx from 'clsx'

function App(): React.JSX.Element {
  const { settings, updateSetting } = useSettings()
  // Read through a ref by the once-subscribed handlers (menu accelerators,
  // Monaco actions) so their guards see the live enabled flags, not a stale
  // mount-time snapshot.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  })
  const resolvedTheme = useTheme(settings.theme)
  const monacoTheme = getMonacoTheme(resolvedTheme)
  const density = DENSITY[settings.uiMode]

  // Stable identity unless the settings that feed it change - a fresh object
  // literal per render makes the editor re-apply updateOptions() on every
  // App render (i.e. on every keystroke).
  const editorOptions = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: false },
      fontFamily: MONO_FONT_FAMILY,
      fontSize: density.editorFontSize,
      wordWrap: 'on',
      padding: { top: 6 },
      scrollBeyondLastLine: false,
      lineNumbers: settings.lineNumbersEnabled ? 'on' : 'off',
      // Tighter gutter than Monaco's defaults; 0 when line numbers are off
      // so text isn't indented for no reason.
      lineNumbersMinChars: settings.lineNumbersEnabled ? 4 : 0,
      lineDecorationsWidth: settings.lineNumbersEnabled ? 4 : 0,
      scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 }
    }),
    [density.editorFontSize, settings.lineNumbersEnabled]
  )

  const terminal = useTerminals()
  const tabs = useTabs(settings.tabsEnabled)
  // useTabs (like most of this file's hooks) returns a fresh object literal
  // every render, so effects that only need to *call* something on it (not
  // react to one of its values changing) read it through this ref instead of
  // depending on `tabs` itself - otherwise they'd tear down and re-attach
  // their listener on every single render. Written from an effect (not
  // inline during render) since refs aren't safe to mutate while rendering.
  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  })
  const terminalRef = useRef(terminal)
  useEffect(() => {
    terminalRef.current = terminal
  })
  const renameInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const tree = useWorkspaceTree({
    onFileCreated: tabs.openTab,
    onPathChanged: tabs.remapTabPaths,
    onPathDeleted: tabs.closeTabsUnder,
    renameInputRef,
    createInputRef
  })
  const treeRef = useRef(tree)
  useEffect(() => {
    treeRef.current = tree
  })
  const voice = useVoiceInput(settings.voiceModel, settings.voiceLanguage, (text) =>
    tabsRef.current.insertTextAtCursor(text)
  )
  // Same ref pattern as tabsRef: the menu-action hook subscribes once but
  // must always call the current render's toggle (which sees live status).
  const voiceRef = useRef(voice)
  useEffect(() => {
    voiceRef.current = voice
  })
  // Dictation needs an open file to insert into. If that file is showing the
  // Markdown/HTML preview, starting dictation flips it back to source first -
  // the text lands in the editor, which must be mounted. Everything reads
  // through refs so the menu accelerator (subscribed once) stays correct.
  const toggleDictation = (): void => {
    const t = tabsRef.current
    const v = voiceRef.current
    if (v.status !== 'idle') {
      // Stop/ignore paths don't care about the editor.
      v.toggle()
      return
    }
    if (!settingsRef.current.dictationEnabled) return
    if (!isProsePath(t.selectedPath)) return
    if (t.showMarkdownPreview && t.activeTabPath)
      t.updateTab(t.activeTabPath, { showPreview: false })
    v.toggle()
  }
  const canDictate = settings.dictationEnabled && isProsePath(tabs.selectedPath)

  // One entry point for both the toolbar buttons and the Option+Cmd+L menu
  // accelerator: picks the formatter by the active file's extension. Reads
  // through tabsRef so the menu handler (subscribed once) never acts on a
  // stale tab snapshot.
  const formatActiveDocument = (): void => {
    const t = tabsRef.current
    const path = t.activeTabPath
    if (!path) return
    if (path.endsWith('.json')) {
      try {
        t.setFileContent(path, JSON.stringify(JSON.parse(t.fileContent), null, 2))
      } catch {
        alertDialog('Invalid JSON format.')
      }
    } else if (path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('.xml')) {
      t.setFileContent(path, prettyPrintMarkup(t.fileContent))
    }
  }

  // Where a terminal opened without explicit context (toolbar button, Ctrl+`)
  // should start: the workspace root the active file belongs to, else the
  // first open workspace, else undefined (falls back to the user's home).
  const defaultTerminalCwd = (): string | undefined => {
    const roots = treeRef.current.rootNodes
    const active = tabsRef.current.selectedPath
    const activeRoot = active
      ? roots.find((r) => active === r.path || active.startsWith(r.path + '/'))
      : undefined
    return (activeRoot ?? roots[0])?.path
  }

  const openDefaultTerminal = (): void => {
    terminalRef.current.openNewTerminal(defaultTerminalCwd())
  }

  // Shared by the toolbar button and the Ctrl+` menu accelerator.
  const toggleTerminal = (): void => {
    const term = terminalRef.current
    if (!term.showTerminal && term.terminals.length === 0) openDefaultTerminal()
    else term.setShowTerminal(!term.showTerminal)
  }

  // Hide/show the whole file-tree sidebar (button + Cmd+B); persisted in
  // settings so it survives a restart.
  const toggleSidebar = (): void => updateSetting('sidebarVisible', !settings.sidebarVisible)

  const readAloud = useReadAloud(settings.readVoices)
  const readAloudRef = useRef(readAloud)
  useEffect(() => {
    readAloudRef.current = readAloud
  })
  // The live Monaco instance, captured on mount - needed here (not just
  // inside useTabs) so read-aloud can start from the selection/cursor.
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // The same instance mirrored into state, so the translation popup (which
  // must be conditionally *rendered* with it) doesn't read a ref mid-render.
  const [mountedEditor, setMountedEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(
    null
  )

  const translate = useTranslate(settings.translateModel, settings.translatePair)
  const translateRef = useRef(translate)
  useEffect(() => {
    translateRef.current = translate
  })
  // Translation acts on the editor selection, so preview mode (no editor
  // mounted, nothing selected) is a no-op - unlike dictation, there's no
  // sensible fallback to flip to.
  const startTranslate = (): void => {
    if (!settingsRef.current.translateEnabled) return
    if (tabsRef.current.showMarkdownPreview) return
    const editor = editorInstanceRef.current
    if (!editor) return
    translateRef.current.translateSelection(editor)
  }

  // Reads the selection if there is one; otherwise from the cursor to the end
  // of the file, falling back to the whole file if the cursor is already at
  // (or past) the end and that range is empty; in Markdown/HTML preview mode
  // (no editor mounted) the whole file. Markdown is flattened to prose before
  // speaking.
  const startReadAloud = (): void => {
    if (!settingsRef.current.readAloudEnabled) return
    const t = tabsRef.current
    if (!t.selectedPath) return
    const markdown = isMarkdownPath(t.selectedPath)
    let text = t.fileContent
    const editor = editorInstanceRef.current
    const model = editor?.getModel()
    if (!t.showMarkdownPreview && editor && model) {
      const selection = editor.getSelection()
      const position = editor.getPosition()
      if (selection && !selection.isEmpty()) {
        text = model.getValueInRange(selection)
      } else if (position) {
        const full = model.getFullModelRange()
        const fromCursor = model.getValueInRange(
          new monaco.Range(position.lineNumber, position.column, full.endLineNumber, full.endColumn)
        )
        text = fromCursor.trim().length > 0 ? fromCursor : model.getValue()
      }
    }
    readAloudRef.current.speak(text, { markdown })
  }

  const handleEditorMount = (editor: monaco.editor.IStandaloneCodeEditor): void => {
    tabs.handleEditorDidMount(editor)
    editorInstanceRef.current = editor
    setMountedEditor(editor)
    // The editor unmounts (and is disposed) when the last tab closes or the
    // preview takes over; drop the state mirror so nothing renders against a
    // disposed instance.
    editor.onDidDispose(() => setMountedEditor((cur) => (cur === editor ? null : cur)))
    // Right-click -> Read Aloud, for the selection (or from the cursor).
    editor.addAction({
      id: 'aurapad.read-aloud',
      label: 'Read Aloud',
      contextMenuGroupId: '9_aurapad',
      contextMenuOrder: 1,
      run: () => startReadAloud()
    })
    // Right-click -> Translate Selection; grayed out with nothing selected.
    // The keybinding here handles Option+Cmd+T while the editor has focus
    // (focused web content sees the key before the native menu on macOS);
    // the Edit-menu accelerator (menu.ts) covers every other focus state.
    editor.addAction({
      id: 'aurapad.translate',
      label: 'Translate Selection',
      contextMenuGroupId: '9_aurapad',
      contextMenuOrder: 2,
      precondition: 'editorHasSelection',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT],
      run: () => startTranslate()
    })
  }
  const git = useGitStatus(settings.extensions.git.enabled, tabs.saveAllDirtyFileTabs)
  useDiagnostics(tabs.selectedPath, tabs.isSaved, tree.rootNodes)
  const recentExternalFiles = useRecentExternalFiles()

  // Record every open tab that falls outside all workspace roots, so it
  // shows up in the sidebar's "Recently Opened" list even after the tab
  // closes. Keyed on the path lists (not the object references) so this
  // only re-runs when a tab or workspace root actually changes.
  const openTabPathsKey = tabs.tabs.map((t) => t.path).join('\n')
  const rootPathsKey = tree.rootNodes.map((r) => r.path).join('\n')
  useEffect(() => {
    const rootPaths = tree.rootNodes.map((r) => r.path)
    for (const tabPath of tabs.tabs.map((t) => t.path)) {
      if (!isUnderAnyRoot(tabPath, rootPaths)) recentExternalFiles.touch(tabPath)
    }
  }, [openTabPathsKey, rootPathsKey])
  const sidebarWidth = useSidebarWidth(settings.sidebarWidth, settings.sidebarPosition, (w) =>
    updateSetting('sidebarWidth', w)
  )

  // Removing an entry from the "Recently Opened" list also closes its tab,
  // if it's still open - otherwise the tab would keep dangling with no way
  // to get back to it from the sidebar.
  const handleRemoveRecentExternalFile = async (path: string): Promise<void> => {
    if (tabs.tabs.some((t) => t.path === path)) await tabs.closeTab(path)
    recentExternalFiles.remove(path)
  }

  // Search / settings overlay state
  const [showSearch, setShowSearch] = useState(false)
  // Survives the overlay unmounting so reopening Cmd+Shift+F restores the
  // last query. A ref (not state): it changes on every keystroke in the
  // overlay and nothing should re-render on that. Its value is snapshotted
  // into searchInitialQuery state at open time (refs can't be read during
  // render).
  const lastSearchQueryRef = useRef('')
  const [searchInitialQuery, setSearchInitialQuery] = useState('')
  // IDEA-style: opening search with text selected in the editor prefills the
  // query with that selection; otherwise the previous query is shown again.
  // Either way the overlay pre-selects it, so typing starts a fresh query.
  const openGlobalSearch = (): void => {
    const selected = tabsRef.current.getSelectedText()
    if (selected && !selected.includes('\n')) lastSearchQueryRef.current = selected
    setSearchInitialQuery(lastSearchQueryRef.current)
    setShowSearch(true)
  }
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // The dictation/read-aloud dialogs double as their Settings pages -
  // "Configure…" opens them on top of the Settings modal.
  const [showDictationConfig, setShowDictationConfig] = useState(false)
  const [showReadAloudConfig, setShowReadAloudConfig] = useState(false)
  const [showTranslateConfig, setShowTranslateConfig] = useState(false)
  const [showGoogleTasksConfig, setShowGoogleTasksConfig] = useState(false)
  const [sidebarView, setSidebarView] = useState<'files' | 'git'>('files')
  // Which repo the git panel shows; set by the file tree's per-root badge.
  const [gitPanelRoot, setGitPanelRoot] = useState<string | null>(null)
  // A new app version: either downloaded and ready to install (restart), or -
  // where this build can't self-update - available for manual download.
  const [updateNotification, setUpdateNotification] = useState<UpdateNotification | null>(null)
  // True from clicking Install/Restart until the app restarts itself - or
  // until main reports a failed attempt (a fresh notification with `failed`
  // set), which must drop the spinner and show the retry state instead.
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(
    () =>
      window.api.onUpdateNotification((update) => {
        setUpdateNotification(update)
        setUpdateInstalling(false)
      }),
    []
  )

  // 'manual' just opens the releases page - nothing to wait for. The
  // self-applying modes keep the toast up as a progress indicator until the
  // app restarts itself. Shared by the update toast and the Settings modal.
  const handleApplyUpdate = (): void => {
    window.api.applyUpdate()
    if (updateNotification?.mode === 'manual') setUpdateNotification(null)
    else setUpdateInstalling(true)
  }

  const sidebarRef = useRef<HTMLDivElement>(null)

  // Monaco's built-in widgets (e.g. the Find/Replace bar's icon buttons) use
  // native title="" attributes, which pop up an OS-style tooltip that clashes
  // with the app's look. Some of those widgets render in an overlay layer
  // outside the specific editor instance's own DOM node, so watch the whole
  // document - but scope the selector to Monaco's own elements only, so this
  // never touches our own toolbar buttons' tooltips. Keep an aria-label so
  // screen readers still get the same text.
  useEffect(() => {
    const strip = (el: Element): void => {
      const title = el.getAttribute('title')
      if (!title) return
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', title)
      el.removeAttribute('title')
    }
    // Only elements inside a Monaco editor - and only the mutated subtrees,
    // not a document-wide querySelectorAll per mutation batch: Monaco emits
    // mutations continuously while typing/scrolling, and the full-document
    // scan burned CPU on every one of them.
    const stripWithin = (el: Element): void => {
      if (!el.closest('.monaco-editor')) return
      strip(el)
      el.querySelectorAll('[title]').forEach(strip)
    }
    document.querySelectorAll('.monaco-editor[title], .monaco-editor [title]').forEach(strip)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof Element) stripWithin(mutation.target)
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) stripWithin(node)
          })
        }
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title']
    })
    return () => observer.disconnect()
  }, [])

  // The Find/Replace widget's own buttons (close, next/previous match,
  // replace, case-sensitive/whole-word/regex toggles) don't use a native
  // title="" at all - they use Monaco's custom IHoverService overlay, whose
  // "(Escape)"-style label is what actually clashes visually (the
  // title-stripping observer above never touched it, since there's no title
  // to strip). That overlay is a real, absolutely-positioned DOM node
  // appended outside the widget, and it can end up rendering on top of the
  // close button itself, swallowing clicks meant for it. Monaco shows the
  // hover from a plain (non-capturing) mouseover listener on each button, so
  // a capture-phase listener higher up the tree that stops the event before
  // it reaches the button prevents the hover from ever appearing.
  useEffect(() => {
    const suppressFindWidgetHover = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest?.('.find-widget')) {
        e.stopPropagation()
      }
    }
    document.addEventListener('mouseover', suppressFindWidgetHover, true)
    return () => document.removeEventListener('mouseover', suppressFindWidgetHover, true)
  }, [])

  useGlobalHotkeys({
    // Escape priority chain: the translation popup sits on top of whatever
    // else is going on; then dictation (stop recording, throw the take away);
    // then read-aloud (stop speaking).
    onEscape: () => {
      if (translateRef.current.popup) {
        translateRef.current.closePopup()
        return true
      }
      if (voiceRef.current.status === 'recording') {
        voiceRef.current.cancelRecording()
        return true
      }
      if (readAloudRef.current.speaking) {
        readAloudRef.current.stop()
        return true
      }
      return false
    },
    onToggleQuickOpen: () => setShowFileSearch((prev) => !prev),
    sidebarRef,
    focusedNode: tree.focusedNode,
    hasClipboard: !!tree.clipboard,
    onCopyNode: (node) => tree.setClipboard({ path: node.path }),
    onPasteIntoNode: tree.pasteIntoNode,
    onDeleteNode: tree.deleteNode
  })

  useEffect(() => {
    const handleClickOutside = (): void => tree.setContextMenu(null)
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  // Opening a file via the OS ("Open With AuraPad", double-click once
  // registered as a handler, or a second launch attempt while already
  // running) arrives here as a plain path - just open it like any other file.
  useEffect(() => {
    const unsubscribe = window.api.onOpenFileRequest((filePath) => {
      tabsRef.current.openTab(filePath)
    })
    return unsubscribe
  }, [])

  useMenuActions({
    'open-folder': () => treeRef.current.handleAddFolder(),
    save: () => tabsRef.current.handleSave(),
    // Context-sensitive: with focus inside the terminal panel (xterm keeps it
    // on a textarea within .xterm) Cmd+W closes the active terminal, not the
    // file tab hidden underneath it.
    'close-tab': () => {
      if (document.activeElement?.closest('.xterm')) {
        terminalRef.current.closeActiveTerminal()
      } else {
        tabsRef.current.handleCloseFile()
      }
    },
    'reopen-tab': () => tabsRef.current.reopenClosedTab(),
    'go-to-file': () => setShowFileSearch((prev) => !prev),
    'find-in-files': openGlobalSearch,
    'toggle-git-panel': () => setSidebarView((prev) => (prev === 'git' ? 'files' : 'git')),
    'toggle-sidebar': toggleSidebar,
    'toggle-dictation': toggleDictation,
    'translate-selection': startTranslate,
    'format-document': formatActiveDocument,
    'toggle-preview': () => {
      const t = tabsRef.current
      if (t.activeTabPath && isPreviewablePath(t.selectedPath)) t.togglePreview(t.activeTabPath)
    },
    'toggle-terminal': toggleTerminal,
    preferences: () => setShowSettings(true)
  })

  // Tells main it's now safe to deliver a file-open request directly instead
  // of queuing it - must run only once, after the subscription above is in
  // place, so a file open that raced the app's startup (macOS "Open With",
  // or a plain CLI arg on first launch) never fires before anything is
  // listening for it.
  useEffect(() => {
    window.api.notifyRendererReady()
  }, [])

  // The window is about to close (titlebar close button, Cmd+Q, or the app
  // quitting) - main paused the close and is waiting for this to either let
  // it through immediately (nothing unsaved) or confirm after asking the
  // user, so unsaved edits are never silently discarded.
  useEffect(() => {
    const unsubscribe = window.api.onRequestClose(async () => {
      const unsavedCount = tabsRef.current.getUnsavedCount()
      if (
        unsavedCount === 0 ||
        (await confirmDialog(
          unsavedCount === 1
            ? 'You have unsaved changes in 1 tab. Quit without saving?'
            : `You have unsaved changes in ${unsavedCount} tabs. Quit without saving?`
        ))
      ) {
        window.api.confirmClose()
      } else {
        // Declined: main must forget a pending Cmd+Q, or the next plain
        // window close would quit the whole app with it.
        window.api.declineClose()
      }
    })
    return unsubscribe
  }, [])

  const runPythonFile = (path: string): void => {
    const quotedPath = quoteForShell(path, window.electron.process.platform)
    terminal.openNewTerminal(dirname(path), `python3 ${quotedPath}`)
  }

  // The tree's eye icon: open the file and flip its preview. togglePreview
  // reads the tab's current showPreview inside its own state updater, so a
  // freshly opened file (showPreview:false) always turns preview on, and
  // re-clicking the eye on an already-previewing file flips back to source -
  // without racing a stale snapshot on rapid clicks across files.
  const previewMarkdown = async (node: FileNode): Promise<void> => {
    await tabs.openTab(node.path)
    tabs.togglePreview(node.path)
  }

  const openTerminalHere = (node: FileNode): void => {
    const cwd = node.type === 'directory' ? node.path : dirname(node.path)
    terminal.openNewTerminal(cwd)
  }

  const handleWindowDragOver = (e: DragEvent): void => {
    e.preventDefault()
  }

  // Open files dropped in from Finder/Explorer. webUtils.getPathForFile
  // resolves a dropped File's absolute filesystem path; directories are
  // silently skipped (openTab's readFile call just fails quietly for them,
  // same as any other unreadable path).
  const handleWindowDrop = (e: DragEvent): void => {
    e.preventDefault()
    for (const file of Array.from(e.dataTransfer.files)) {
      const filePath = window.api.getPathForFile(file)
      if (filePath) tabs.openTab(filePath)
    }
  }

  // An extension tab's synthetic path never matches a workspace root, so for
  // the breadcrumb/branch logic below its bound project (if any) stands in
  // for the "selected file". Google Tasks has no root - it falls through to
  // the no-selection defaults.
  const activeExt = tabs.selectedPath ? parseExtensionPath(tabs.selectedPath) : null
  const breadcrumbPath = activeExt ? activeExt.root : tabs.selectedPath
  // Show just the workspace the active file belongs to, not every open
  // workspace - the breadcrumb should say where you are, not list everything
  // that happens to be open.
  const activeRoot = breadcrumbPath
    ? tree.rootNodes.find(
        (r) => breadcrumbPath === r.path || breadcrumbPath.startsWith(r.path + '/')
      )
    : null
  // A file open from outside every workspace (the "Recently Opened" list)
  // isn't part of any of them, so it should show neither - not fall back to
  // listing every open workspace, which was just as misleading.
  const projectLabel = breadcrumbPath
    ? (activeRoot?.name ?? 'AuraPad')
    : tree.rootNodes.length > 0
      ? tree.rootNodes.map((r) => r.name).join(', ')
      : 'AuraPad'
  const headerRepo = breadcrumbPath
    ? activeRoot && findRepoForRoot(git.repos, activeRoot.path)
    : git.repos[0]
  const hasFileActions = !!tabs.selectedPath && !activeExt

  // Entry point from the file tree's per-root branch badge: focus that
  // root's repo in the git panel and reveal the panel. Also un-hides the
  // sidebar, since the git panel lives inside it.
  const openGitPanel = useStableCallback((rootPath: string): void => {
    setGitPanelRoot(findRepoForRoot(git.repos, rootPath)?.root ?? rootPath)
    setSidebarView('git')
    if (!settings.sidebarVisible) updateSetting('sidebarVisible', true)
  })

  // Identity-stable wrappers for everything the memoized FileTree rows (via
  // Sidebar) receive - the hooks recreate their functions every render, and
  // a single fresh callback would re-render the whole expanded forest on
  // each keystroke.
  const handleTreeSelect = useStableCallback((path: string) => {
    tabs.openTab(path)
  })
  const handleTreeContextMenu = useStableCallback(tree.handleContextMenu)
  const handleTreeCreateNew = useStableCallback(tree.startCreate)
  const handleTreeMove = useStableCallback(tree.handleMove)
  const handleTreeFocusNode = useStableCallback(tree.handleFocusNode)
  const handleTreeRunPython = useStableCallback((node: FileNode) => runPythonFile(node.path))
  const handleTreePreview = useStableCallback(previewMarkdown)
  const handleRemoveRecent = useStableCallback(handleRemoveRecentExternalFile)
  const handleTabClose = useStableCallback(tabs.closeTab)
  const handleTabCloseOthers = useStableCallback(tabs.closeOtherTabs)
  const handleTabCloseAll = useStableCallback(tabs.closeAllTabs)
  const handleTabTogglePin = useStableCallback(tabs.togglePin)
  const handleTabReorder = useStableCallback(tabs.reorderTab)
  // Plain .map in the JSX would hand Sidebar a fresh array every render.
  const recentExternalPaths = useMemo(
    () => recentExternalFiles.entries.map((e) => e.path),
    [recentExternalFiles.entries]
  )

  return (
    <div
      className="flex h-screen bg-fleet-bg text-fleet-text flex-col relative overflow-hidden"
      onDragOver={handleWindowDragOver}
      onDrop={handleWindowDrop}
    >
      <AppHeader
        projectLabel={projectLabel}
        headerRepo={headerRepo}
        git={git}
        selectedPath={tabs.selectedPath}
        isFileInWorkspace={
          !!tabs.selectedPath &&
          isUnderAnyRoot(
            tabs.selectedPath,
            tree.rootNodes.map((r) => r.path)
          )
        }
        hasFileActions={hasFileActions}
        showPreview={tabs.showMarkdownPreview}
        isPreviewable={isPreviewablePath(tabs.selectedPath)}
        canDictate={canDictate}
        isProse={settings.readAloudEnabled && isProsePath(tabs.selectedPath)}
        googleTasksEnabled={settings.extensions.googleTasks.enabled}
        googleTasksActive={activeExt?.id === 'google-tasks'}
        terminalShown={terminal.showTerminal}
        sidebarVisible={settings.sidebarVisible}
        voice={voice}
        readAloud={readAloud}
        onRevealActiveFile={() => {
          if (!settings.sidebarVisible) updateSetting('sidebarVisible', true)
          setSidebarView('files')
          if (tabs.selectedPath) tree.setRevealPath(tabs.selectedPath)
        }}
        onRunPython={() => tabs.selectedPath && runPythonFile(tabs.selectedPath)}
        onFormatDocument={formatActiveDocument}
        onTogglePreview={() => tabs.activeTabPath && tabs.togglePreview(tabs.activeTabPath)}
        onToggleDictation={toggleDictation}
        onStartReadAloud={startReadAloud}
        onOpenGlobalSearch={openGlobalSearch}
        onAddFolder={tree.handleAddFolder}
        onOpenGoogleTasks={() => tabs.openTab(makeExtensionPath('google-tasks'))}
        onToggleTerminal={toggleTerminal}
        onToggleSidebar={toggleSidebar}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <div
          className={clsx(
            'flex-1 flex flex-col min-w-0 relative',
            settings.sidebarPosition === 'left' && 'order-2'
          )}
        >
          {settings.tabsEnabled && (
            <TabBar
              tabs={tabs.tabs}
              activeTabPath={tabs.activeTabPath}
              setActiveTabPath={tabs.setActiveTabPath}
              closeTab={handleTabClose}
              closeOtherTabs={handleTabCloseOthers}
              closeAllTabs={handleTabCloseAll}
              togglePin={handleTabTogglePin}
              reorderTab={handleTabReorder}
              heightClassName={density.tabBarHeight}
            />
          )}

          {tabs.externalChangeAvailable && (
            <div className="flex items-center justify-between gap-2 bg-yellow-900/90 text-yellow-100 text-xs px-3 py-1.5 shrink-0">
              <span>This file changed on disk.</span>
              <div className="flex items-center gap-3">
                <button className="underline hover:text-white" onClick={tabs.reloadFromDisk}>
                  Reload
                </button>
                <button
                  className="underline hover:text-white"
                  onClick={() =>
                    tabs.activeTabPath &&
                    tabs.updateTab(tabs.activeTabPath, { externalChangeAvailable: false })
                  }
                >
                  Ignore
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {activeExt ? (
              activeExt.id === 'google-tasks' ? (
                <GoogleTasksTab settings={settings} updateSetting={updateSetting} />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                  Unknown extension: {activeExt.id}
                </div>
              )
            ) : tabs.selectedPath ? (
              tabs.showMarkdownPreview && isMarkdownPath(tabs.selectedPath) ? (
                <MarkdownPreview content={tabs.fileContent} />
              ) : tabs.showMarkdownPreview && isHtmlPath(tabs.selectedPath) ? (
                <HtmlPreview content={tabs.fileContent} />
              ) : (
                <Editor
                  height="100%"
                  path={tabs.selectedPath}
                  language={getLanguage(tabs.selectedPath)}
                  theme={monacoTheme}
                  // Uncontrolled: the model owns the text and only tab-state
                  // bookkeeping flows through React on each keystroke - a
                  // `value` prop makes the library diff the entire file
                  // against the model on every render. Programmatic content
                  // changes go through useTabs' applyContentToModel.
                  defaultValue={tabs.fileContent}
                  // Unmounting (preview toggle, extension tab, last tab
                  // closed) must not dispose the current model - closing a
                  // tab does that explicitly in useTabs. Without this, every
                  // trip to Preview and back silently wiped the undo stack.
                  keepCurrentModel
                  onChange={tabs.handleEditorChange}
                  onMount={handleEditorMount}
                  options={editorOptions}
                />
              )
            ) : (
              <div className="flex-1 h-full flex items-center justify-center text-gray-500 flex-col gap-4">
                <span className="text-4xl text-gray-700">AuraPad</span>
                <span>Double-Shift to search files</span>
              </div>
            )}
          </div>

          {terminal.showTerminal && terminal.terminals.length > 0 && (
            <TerminalPanel
              terminal={terminal}
              fontSize={density.terminalFontSize}
              onOpenNew={openDefaultTerminal}
            />
          )}
        </div>

        {settings.sidebarVisible && (
          <div
            ref={sidebarRef}
            className={clsx(
              'relative bg-fleet-sidebar flex flex-col shrink-0 border-fleet-border',
              settings.sidebarPosition === 'left' ? 'order-1 border-r' : 'border-l'
            )}
            style={{ width: `${sidebarWidth.width}px`, fontSize: density.uiFontSize }}
          >
            <div
              className={clsx(
                'absolute top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-blue-500/50 transition-colors z-10',
                settings.sidebarPosition === 'left'
                  ? 'right-0 translate-x-1/2'
                  : 'left-0 -translate-x-1/2'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                sidebarWidth.startResizing()
              }}
            />
            <Sidebar
              monacoTheme={monacoTheme}
              rowPadding={density.treeRowPadding}
              sidebarView={sidebarView}
              setSidebarView={setSidebarView}
              rootNodes={tree.rootNodes}
              recentExternalFiles={recentExternalPaths}
              onRemoveRecentExternalFile={handleRemoveRecent}
              selectedPath={tabs.selectedPath}
              revealRequest={tree.revealRequest}
              onSelect={handleTreeSelect}
              onContextMenu={handleTreeContextMenu}
              onCreateNew={handleTreeCreateNew}
              onMove={handleTreeMove}
              onFocusNode={handleTreeFocusNode}
              onRunPython={handleTreeRunPython}
              onPreviewMarkdown={handleTreePreview}
              git={git}
              gitPanelRoot={gitPanelRoot}
              onSelectGitRoot={setGitPanelRoot}
              onOpenGit={openGitPanel}
            />
          </div>
        )}
      </div>

      {showSearch && (
        <GlobalSearch
          onClose={() => setShowSearch(false)}
          initialQuery={searchInitialQuery}
          onQueryChange={(q) => {
            lastSearchQueryRef.current = q
          }}
          onSelect={(path, line, highlight) => {
            // Picking a result is a "go there" action: dismiss the overlay so
            // the editor (with the match selected) is immediately usable.
            setShowSearch(false)
            tabs.openTab(path, line, highlight)
          }}
        />
      )}

      {updateNotification && (
        <UpdateToast
          notification={updateNotification}
          installing={updateInstalling}
          onApply={handleApplyUpdate}
          onDismiss={() => setUpdateNotification(null)}
        />
      )}

      {showFileSearch && (
        <FileSearch
          onClose={() => setShowFileSearch(false)}
          onSelect={(path, type) => {
            if (type === 'directory') tree.setRevealPath(path)
            else tabs.openTab(path)
            setShowFileSearch(false)
          }}
          rootNodes={tree.rootNodes}
        />
      )}

      {tree.contextMenu && (
        <TreeContextMenu
          x={tree.contextMenu.x}
          y={tree.contextMenu.y}
          node={tree.contextMenu.node}
          hasClipboard={!!tree.clipboard}
          onClose={() => tree.setContextMenu(null)}
          onOpenTerminalHere={openTerminalHere}
          onCreateNew={tree.startCreate}
          onRename={tree.startRename}
          onCopy={(node) => tree.setClipboard({ path: node.path })}
          onPaste={tree.pasteIntoNode}
          onDelete={tree.deleteNode}
          onRemoveFolder={tree.handleRemoveFolder}
        />
      )}

      {tree.renameTarget && (
        <NameInputModal
          title={`Rename "${tree.renameTarget.name}"`}
          value={tree.renameValue}
          confirmLabel="Rename"
          inputRef={renameInputRef}
          onChange={tree.setRenameValue}
          onConfirm={tree.confirmRename}
          onCancel={() => tree.setRenameTarget(null)}
        />
      )}

      {tree.createTarget && (
        <NameInputModal
          title={`New ${tree.createTarget.type === 'directory' ? 'Folder' : 'File'} in "${tree.createTarget.parentPath.split('/').pop()}"`}
          value={tree.createValue}
          placeholder={tree.createTarget.type === 'directory' ? 'folder-name' : 'file-name.ts'}
          confirmLabel="Create"
          inputRef={createInputRef}
          onChange={tree.setCreateValue}
          onConfirm={tree.confirmCreate}
          onCancel={() => tree.setCreateTarget(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          updateSetting={updateSetting}
          density={density}
          appVersion={appVersion}
          updateNotification={updateNotification}
          updateInstalling={updateInstalling}
          onUpdateAction={handleApplyUpdate}
          onConfigureDictation={() => setShowDictationConfig(true)}
          onConfigureReadAloud={() => setShowReadAloudConfig(true)}
          onConfigureTranslate={() => setShowTranslateConfig(true)}
          onConfigureGoogleTasks={() => setShowGoogleTasksConfig(true)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showGoogleTasksConfig && (
        <GoogleTasksConfigModal
          settings={settings}
          updateSetting={updateSetting}
          density={density}
          onClose={() => setShowGoogleTasksConfig(false)}
        />
      )}

      {translate.popup && mountedEditor && (
        <TranslatePopup
          editor={mountedEditor}
          popup={translate.popup}
          onReplace={() => translateRef.current.replaceSelection(mountedEditor)}
          onClose={() => translateRef.current.closePopup()}
        />
      )}

      <AiModals
        settings={settings}
        updateSetting={updateSetting}
        translate={translate}
        voice={voice}
        readAloud={readAloud}
        showTranslateConfig={showTranslateConfig}
        setShowTranslateConfig={setShowTranslateConfig}
        showDictationConfig={showDictationConfig}
        setShowDictationConfig={setShowDictationConfig}
        showReadAloudConfig={showReadAloudConfig}
        setShowReadAloudConfig={setShowReadAloudConfig}
      />

      <DialogHost />
    </div>
  )
}

export default App
