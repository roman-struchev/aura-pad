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
import { FileActions } from './components/FileActions'
import { TerminalPanel } from './components/TerminalPanel'
import { UpdateToast } from './components/UpdateToast'
import { NameInputModal } from './components/NameInputModal'
import { HttpSaveRequestModal } from './components/HttpSaveRequestModal'
import { PortsTab } from './components/PortsTab'
import { AiModals } from './components/AiModals'
import { GoogleTasksTab } from './components/GoogleTasksTab'
import { HttpClientTab } from './components/HttpClientTab'
import { GoogleTasksConfigModal } from './components/GoogleTasksConfigModal'
import { WorkTogetherConfigModal } from './components/WorkTogetherConfigModal'
import { ShareDialog } from './components/ShareDialog'
import { isExtensionPath, makeExtensionPath, parseExtensionPath } from '../../shared/extensionTab'
import type { WindowInit } from '../../shared/ipc'
import { EXTENSIONS } from './lib/extensions'
import { TreeContextMenu } from './components/TreeContextMenu'
import { LocalHistoryModal } from './components/LocalHistoryModal'
import { SpellcheckConfigModal } from './components/SpellcheckConfigModal'
import { DENSITY } from './density'
import { useTheme } from './hooks/useTheme'
import { useSettings } from './hooks/useSettings'
import { useTerminals } from './hooks/useTerminals'
import { useTabs } from './hooks/useTabs'
import { useWorkspaceTree } from './hooks/useWorkspaceTree'
import { useGitStatus } from './hooks/useGitStatus'
import { useDiagnostics } from './hooks/useDiagnostics'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { usePaneWidth } from './hooks/usePaneWidth'
import { useHttpClient } from './hooks/useHttpClient'
import { useRecentExternalFiles } from './hooks/useRecentExternalFiles'
import { useVoiceInput } from './hooks/useVoiceInput'
import { useReadAloud } from './hooks/useReadAloud'
import { useTranslate } from './hooks/useTranslate'
import { useWorkTogether } from './hooks/useWorkTogether'
import { useSpellcheck } from './hooks/useSpellcheck'
import { useMenuActions } from './hooks/useMenuActions'
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys'
import type { UpdateNotification, UpdateProgress } from '../../shared/updateNotification'
import type { HttpEnvironments, HttpRequestSpec } from '../../shared/http'
import { TranslatePopup } from './components/TranslatePopup'
import { DialogHost } from './components/DialogHost'
import { alertDialog, confirmDialog } from './lib/dialogs'
import { useStableCallback } from './lib/useStableCallback'
import { findRepoForRoot } from './lib/repoForRoot'
import {
  isHtmlPath,
  isHttpPath,
  isPreviewablePath,
  isProsePath,
  isMarkdownPath
} from './lib/fileType'
import { HttpResponsePane } from './components/HttpResponsePane'
import { curlCommandAt, toCurl } from './lib/http/curl'
import {
  blockAtLine,
  buildRequest,
  buildRequestFromText,
  parseHttpFile,
  defaultRequestName,
  specToHttpBlock,
  type BuildResult
} from './lib/http/httpFile'
import { setHttpBlockHandlers } from './lib/http/monacoHttp'
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
  const { settings, settingsLoaded, updateSetting } = useSettings()
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
  const http = useHttpClient()
  const workTogether = useWorkTogether({
    enabled: settings.extensions.workTogether.enabled,
    settingsLoaded,
    backendUrl: settings.extensions.workTogether.backendUrl,
    displayName: settings.extensions.workTogether.displayName || 'Host'
  })
  // Lets tab close/cleanup skip disposing the Monaco model for a path that's
  // still being shared (see the isPathShared guard in removeTabFromState).
  // `settingsLoaded` holds the session restore back until `tabsEnabled` is
  // the user's real choice rather than the default.
  // Whether this window owns the persisted session: a window torn off a tab
  // leaves openTabs.json alone (see createWindow in src/main/index.ts), and
  // the file it was torn off with arrives as an open-file-request below. The
  // restore inside useTabs is held back until this answer lands, so a
  // detached window never restores the primary window's list on its way to
  // being told not to.
  const [windowInit, setWindowInit] = useState<WindowInit | null>(null)
  useEffect(() => {
    window.api.getWindowInit().then(setWindowInit)
  }, [])
  // A torn-off window shows the tab and its editor, nothing else - no file
  // tree, no git panel, no terminal. Those all belong to the main window,
  // which is also where the tab goes when it is pushed back.
  const isLeanWindow = windowInit !== null && !windowInit.primary
  // The menu-action handler subscribes once, so it reads this through a ref
  // like it does the tabs themselves.
  const isLeanWindowRef = useRef(isLeanWindow)
  isLeanWindowRef.current = isLeanWindow
  const tabs = useTabs(
    settings.tabsEnabled,
    settingsLoaded && windowInit !== null,
    workTogether.isSharing,
    workTogether.stop,
    windowInit?.primary ?? true
  )
  // Lets a resumed session whose model didn't exist yet at reconnect time
  // (the tab wasn't open, or wasn't the active one) bind to it once it
  // actually becomes the active tab.
  const { notifyActivePath } = workTogether
  useEffect(() => {
    if (tabs.selectedPath) notifyActivePath(tabs.selectedPath)
  }, [tabs.selectedPath, notifyActivePath])
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

  // Fold-all / unfold-all toggle for the toolbar. Monaco ships both commands
  // (editor.foldAll / editor.unfoldAll) but wires no UI to them; a single
  // button flips between the two. Monaco has no "is everything folded" query,
  // so we track which file we last folded and derive the toggle state from
  // that - switching files naturally shows "fold" again (folds are per-model
  // view state and don't carry a shared "all folded" flag).
  const [foldedPath, setFoldedPath] = useState<string | null>(null)
  const foldedAll = !!tabs.selectedPath && foldedPath === tabs.selectedPath
  const toggleFold = (): void => {
    const editor = editorInstanceRef.current
    if (!editor) return
    const next = !foldedAll
    editor.getAction(next ? 'editor.foldAll' : 'editor.unfoldAll')?.run()
    setFoldedPath(next ? tabs.selectedPath : null)
  }

  const handleEditorMount = (editor: monaco.editor.IStandaloneCodeEditor): void => {
    tabs.handleEditorDidMount(editor)
    workTogether.registerEditor(editor)
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
    // Right-click -> Run HTTP Request, plus the Cmd+Enter that fires while
    // the editor has focus (the Edit-menu accelerator covers the rest). Not
    // limited to .http files on purpose: a curl command in a README or a
    // shell script is exactly the case this started from.
    editor.addAction({
      id: 'aurapad.run-http',
      label: 'Run HTTP Request',
      contextMenuGroupId: '9_aurapad',
      contextMenuOrder: 0,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => runHttpRequest()
    })
  }
  const git = useGitStatus(settings.extensions.git.enabled, tabs.saveAllDirtyFileTabs)
  useDiagnostics(tabs.selectedPath, tabs.isSaved, tree.rootNodes)
  const recentExternalFiles = useRecentExternalFiles()

  // Record every open tab that falls outside all workspace roots, so it
  // shows up in the sidebar's "Recently Opened" list even after the tab
  // closes. Keyed on the path lists (not the object references) so this
  // only re-runs when a tab or workspace root actually changes. Gated on
  // rootsLoaded because on startup the tab-restore effect resolves before
  // the workspace tree finishes its (slower, filesystem-walking) initial
  // scan - running this against a still-empty root list would wrongly
  // flag every restored workspace tab as "outside".
  const openTabPathsKey = tabs.tabs.map((t) => t.path).join('\n')
  const rootPathsKey = tree.rootNodes.map((r) => r.path).join('\n')
  useEffect(() => {
    if (!tree.rootsLoaded) return
    const rootPaths = tree.rootNodes.map((r) => r.path)
    for (const tabPath of tabs.tabs.map((t) => t.path)) {
      // Extension tabs (ext://...) are synthetic, not real files, so they
      // never belong in the "Recently Opened (Outside)" list.
      if (isExtensionPath(tabPath)) continue
      if (!isUnderAnyRoot(tabPath, rootPaths)) recentExternalFiles.touch(tabPath)
    }
    // Undo any past mis-touches (e.g. from this same race before this fix,
    // or a workspace added after a file was opened externally) - an entry
    // that now resolves under a root, or a synthetic extension path that
    // slipped in from an older version, doesn't belong in the outside list.
    for (const entry of recentExternalFiles.entries) {
      if (isExtensionPath(entry.path) || isUnderAnyRoot(entry.path, rootPaths))
        recentExternalFiles.remove(entry.path)
    }
  }, [openTabPathsKey, rootPathsKey, tree.rootsLoaded])
  const sidebarWidth = useSidebarWidth(settings.sidebarWidth, settings.sidebarPosition, (w) =>
    updateSetting('sidebarWidth', w)
  )
  const httpPaneWidth = usePaneWidth(settings.httpPaneWidth, (w) =>
    updateSetting('httpPaneWidth', w)
  )

  // A response belongs to the tab it was run from; when that tab goes away
  // (closed, or its file deleted) the response - possibly megabytes of body -
  // has nowhere left to be shown, so it is dropped and any request still in
  // flight for it is cancelled.
  useEffect(() => {
    http.prune(openTabPathsKey ? openTabPathsKey.split('\n') : [])
  }, [openTabPathsKey, http])

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
  // "Replace in Files" is the same overlay, opened with its replace row out.
  const [searchStartsInReplace, setSearchStartsInReplace] = useState(false)
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [showSpellcheckConfig, setShowSpellcheckConfig] = useState(false)
  // The tab whose local history is open (null = closed).
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  // The environments the active .http file can run against, and the request
  // waiting to be written to a .http file (from the HTTP Client tab).
  const [httpEnvironments, setHttpEnvironments] = useState<{
    path: string
    envs: HttpEnvironments
  } | null>(null)
  const [httpSaveSpec, setHttpSaveSpec] = useState<HttpRequestSpec | null>(null)
  // Quick open's live query, so switching to search-in-files carries it over.
  // Same reasoning as lastSearchQueryRef: it changes on every keystroke.
  const fileSearchQueryRef = useRef('')
  const [fileSearchInitialQuery, setFileSearchInitialQuery] = useState('')
  // IDEA-style: opening search with text selected in the editor prefills the
  // query with that selection; otherwise the previous query is shown again.
  // Either way the overlay pre-selects it, so typing starts a fresh query.
  //
  // The two overlays are mutually exclusive - realising halfway through a
  // quick open that the file is better found by its contents switches this
  // one dialog over, query and all, instead of stacking a second one behind
  // it (and vice versa, below).
  const openGlobalSearch = (openWithReplace = false): void => {
    setSearchStartsInReplace(openWithReplace)
    if (showFileSearch) {
      lastSearchQueryRef.current = fileSearchQueryRef.current
      setShowFileSearch(false)
    } else {
      const selected = tabsRef.current.getSelectedText()
      if (selected && !selected.includes('\n')) lastSearchQueryRef.current = selected
    }
    setSearchInitialQuery(lastSearchQueryRef.current)
    setShowSearch(true)
  }
  // Double-Shift / "Go to File…": a toggle, except while search-in-files is
  // up - then it's the same switch in the other direction.
  const toggleFileSearch = (): void => {
    if (showSearch) {
      setShowSearch(false)
      setFileSearchInitialQuery(lastSearchQueryRef.current)
      fileSearchQueryRef.current = lastSearchQueryRef.current
      setShowFileSearch(true)
      return
    }
    if (!showFileSearch) {
      // Quick open always starts empty - only a switch seeds it.
      setFileSearchInitialQuery('')
      fileSearchQueryRef.current = ''
    }
    setShowFileSearch(!showFileSearch)
  }
  const [showSettings, setShowSettings] = useState(false)
  // The dictation/read-aloud dialogs double as their Settings pages -
  // "Configure…" opens them on top of the Settings modal.
  const [showDictationConfig, setShowDictationConfig] = useState(false)
  const [showReadAloudConfig, setShowReadAloudConfig] = useState(false)
  const [showTranslateConfig, setShowTranslateConfig] = useState(false)
  const [showGoogleTasksConfig, setShowGoogleTasksConfig] = useState(false)
  const [showWorkTogetherConfig, setShowWorkTogetherConfig] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  // The file tree's share badge can point at a shared file that isn't the
  // active tab (or isn't open at all, if it was closed while still shared) -
  // open it first so ShareDialog's `tabs.selectedPath` lookup resolves to
  // the right session.
  const openShareDialogFor = async (path: string): Promise<void> => {
    await tabs.openTab(path)
    setShowShareDialog(true)
  }
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
  // How far the macOS install script has got, so the spinner can carry a
  // percentage instead of nothing. Null until the script reports its first
  // step (and on the other platforms, which install without a script).
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(
    () =>
      window.api.onUpdateNotification((update) => {
        setUpdateNotification(update)
        setUpdateInstalling(false)
        setUpdateProgress(null)
      }),
    []
  )

  // Progress is only ever emitted while an install is actually running, so it
  // also (re)asserts the installing state - the toast can't be showing its
  // buttons while the script is already replacing the app underneath it.
  useEffect(
    () =>
      window.api.onUpdateProgress((progress) => {
        setUpdateProgress(progress)
        setUpdateInstalling(true)
      }),
    []
  )

  // 'manual' just opens the releases page - nothing to wait for. The
  // self-applying modes keep the toast up as a progress indicator until the
  // app restarts itself. Shared by the update toast and the Settings modal.
  const handleApplyUpdate = (): void => {
    window.api.applyUpdate()
    setUpdateProgress(null)
    if (updateNotification?.mode === 'manual') setUpdateNotification(null)
    else setUpdateInstalling(true)
  }

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
      if (treeRef.current.contextMenu) {
        treeRef.current.setContextMenu(null)
        return true
      }
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
    onToggleQuickOpen: toggleFileSearch,
    hasTreeSelection: tree.selectedPaths.length > 0,
    onCopySelection: tree.copySelection,
    onPasteIntoSelection: tree.pasteIntoSelection,
    onDeleteSelection: tree.deleteSelection
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
    'go-to-file': toggleFileSearch,
    'find-in-files': () => openGlobalSearch(),
    'replace-in-files': () => openGlobalSearch(true),
    'detach-tab': () => {
      const path = tabsRef.current.activeTabPath
      if (!path) return
      // Same command, mirrored: out of the main window, back into it from a
      // torn-off one.
      if (isLeanWindowRef.current) tabsRef.current.returnTab(path)
      else tabsRef.current.detachTab(path)
    },
    // Context-sensitive like close-tab above: with focus inside the terminal
    // panel Cmd+K clears that terminal (iTerm2/VS Code muscle memory) rather
    // than toggling the git panel behind it.
    'toggle-git-panel': () => {
      if (document.activeElement?.closest('.xterm')) {
        terminalRef.current.clearActiveTerminal()
      } else {
        setSidebarView((prev) => (prev === 'git' ? 'files' : 'git'))
      }
    },
    'toggle-sidebar': toggleSidebar,
    'toggle-dictation': toggleDictation,
    'translate-selection': startTranslate,
    'format-document': formatActiveDocument,
    'toggle-preview': () => {
      const t = tabsRef.current
      if (t.activeTabPath && isPreviewablePath(t.selectedPath)) t.togglePreview(t.activeTabPath)
    },
    'toggle-terminal': toggleTerminal,
    'run-http-request': () => runHttpRequest(),
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

  // The .http file's environments (http-client.env.json next to it, or at the
  // project root). Read per file rather than kept in sync with a watcher: it
  // is one small JSON read on tab switch, and the selector is only looked at
  // when a request is about to run.
  useEffect(() => {
    const path = tabs.selectedPath
    if (!path || !isHttpPath(path)) return
    let alive = true
    void window.api.httpEnvironments(path).then((envs) => {
      if (alive) setHttpEnvironments({ path, envs })
    })
    return () => {
      alive = false
    }
  }, [tabs.selectedPath])

  // Only the answer that belongs to the file on screen; anything else is a
  // stale read for a tab that has already been switched away from.
  const httpEnv =
    httpEnvironments && httpEnvironments.path === tabs.selectedPath ? httpEnvironments.envs : null
  const httpEnvironmentName = settings.extensions.httpClient.environment
  const httpEnvVariables = (httpEnvironmentName && httpEnv?.variables[httpEnvironmentName]) || {}

  // "Save as .http" from the HTTP Client form: which file, under which
  // heading (HttpSaveRequestModal), then append it there.
  const startHttpSave = (spec: HttpRequestSpec): void => setHttpSaveSpec(spec)

  const confirmHttpSave = async (target: string, name: string): Promise<void> => {
    const spec = httpSaveSpec
    if (!spec || !target) return
    setHttpSaveSpec(null)
    const result = await window.api.httpSaveRequest(target, specToHttpBlock(spec, name))
    if (!result.success) {
      await alertDialog(result.error ?? 'The request could not be saved.')
      return
    }
    // Opened right away: seeing the block land in the file is what tells the
    // user what was saved, and where.
    await tabs.openTab(target)
  }

  const selectHttpEnvironment = (name: string): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...settings.extensions.httpClient, environment: name }
    })

  // Spell checking for the active prose file. The words the user adds go into
  // settings like any other preference, so they survive a restart and follow
  // the rest of the app's state.
  const addSpellWord = useStableCallback((word: string): void => {
    const existing = settings.spellUserWords
    if (existing.some((w) => w.toLowerCase() === word.toLowerCase())) return
    updateSetting('spellUserWords', [...existing, word])
  })
  const spell = useSpellcheck({
    enabled: settings.spellcheckEnabled,
    languages: settings.spellLanguages,
    userWords: settings.spellUserWords,
    path: tabs.selectedPath,
    content: tabs.fileContent,
    onAddWord: addSpellWord
  })

  // "Run" for the HTTP client. Every trigger (the ▶ Run CodeLens, Cmd+Enter,
  // the toolbar button, the Edit menu) lands here; they differ only in how
  // the request is located. An explicit selection always wins, then the
  // .http block - or the curl command - the cursor sits in.
  const runHttpRequest = useStableCallback((atLine?: number): void => {
    const path = tabs.selectedPath
    if (!path) return
    const editor = editorInstanceRef.current
    const model = editor?.getModel()
    const text = model?.getValue() ?? tabs.fileContent
    // Relative paths inside a request (-d @body.json, `< ./payload.json`)
    // resolve against the file's own directory, the way its author meant.
    const cwd = dirname(path)
    const selection = editor?.getSelection()
    const selected =
      selection && !selection.isEmpty() ? (model?.getValueInRange(selection) ?? '') : ''
    const cursorLine = atLine ?? (selection ? selection.positionLineNumber - 1 : 0)

    let built: BuildResult
    if (selected.trim()) {
      built = buildRequestFromText(selected, cwd, httpEnvVariables)
    } else if (isHttpPath(path)) {
      const block = blockAtLine(parseHttpFile(text, httpEnvVariables), cursorLine)
      built = block ? buildRequest(block, cwd) : { ok: false, error: 'No request in this file' }
    } else {
      // Any other file: a curl command the cursor is inside of, so a snippet
      // pasted into a README or a shell script is runnable where it lives.
      const command = curlCommandAt(text.split('\n'), cursorLine)
      built = command
        ? buildRequestFromText(command, cwd)
        : { ok: false, error: 'Put the cursor on a curl command, or select one, to run it' }
    }

    if (!built.ok) {
      http.showError(path, 'Request', built.error)
      return
    }
    http.send(path, built.spec)
  })

  const copyHttpBlockAsCurl = useStableCallback((line: number): void => {
    const path = tabs.selectedPath
    if (!path) return
    const text = editorInstanceRef.current?.getModel()?.getValue() ?? tabs.fileContent
    const block = blockAtLine(parseHttpFile(text, httpEnvVariables), line)
    const built = block ? buildRequest(block, dirname(path)) : null
    if (!built) return
    if (!built.ok) {
      http.showError(path, 'Request', built.error)
      return
    }
    navigator.clipboard.writeText(toCurl(built.spec))
  })

  // Monaco commands are registered once per process (there is no per-component
  // command scope), so the CodeLens calls through to whatever these stable
  // callbacks currently do.
  useEffect(() => {
    setHttpBlockHandlers({
      run: (_uri, line) => runHttpRequest(line),
      copyAsCurl: (_uri, line) => copyHttpBlockAsCurl(line)
    })
  }, [runHttpRequest, copyHttpBlockAsCurl])

  const runPythonFile = (path: string): void => {
    const quotedPath = quoteForShell(path, window.api.platform)
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
  const hasFileActions = !!tabs.selectedPath && !activeExt
  // The response pane belongs to the tab the request was run from, so it
  // follows tab switches instead of showing another file's response.
  const activeExchange = tabs.selectedPath ? http.exchanges[tabs.selectedPath] : undefined

  // Enabled built-in extensions that open as tabs, listed in the sidebar's
  // Extensions section (hidden when the list is empty).
  const enabledExtensions = (
    [
      ['http-client', settings.extensions.httpClient.enabled],
      ['ports', settings.extensions.ports.enabled],
      ['google-tasks', settings.extensions.googleTasks.enabled]
    ] as const
  )
    .filter(([, enabled]) => enabled)
    .map(([id]) => ({ id, icon: EXTENSIONS[id].icon, label: EXTENSIONS[id].title(null) }))

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
  const handleTreeRowClick = useStableCallback(tree.handleRowClick)
  const handleTreeRunPython = useStableCallback((node: FileNode) => runPythonFile(node.path))
  const handleTreePreview = useStableCallback(previewMarkdown)
  const handleRemoveRecent = useStableCallback(handleRemoveRecentExternalFile)
  const handleTabClose = useStableCallback(tabs.closeTab)
  const handleTabCloseOthers = useStableCallback(tabs.closeOtherTabs)
  const handleTabCloseAll = useStableCallback(tabs.closeAllTabs)
  const handleTabTogglePin = useStableCallback(tabs.togglePin)
  const handleTabDetach = useStableCallback(tabs.detachTab)
  const handleTabReturn = useStableCallback(tabs.returnTab)
  const handleTabReorder = useStableCallback(tabs.reorderTab)
  // Replace-in-files must not touch a file whose tab still holds unsaved
  // edits: that tab's next autosave would write the pre-replacement buffer
  // straight back over it.
  const unsavedTabPaths = useMemo(
    () => tabs.tabs.filter((t) => !t.isSaved).map((t) => t.path),
    [tabs.tabs]
  )
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
        lean={isLeanWindow}
        sidebarVisible={settings.sidebarVisible}
        sidebarPosition={settings.sidebarPosition}
        terminalShown={terminal.showTerminal}
        onToggleSidebar={toggleSidebar}
        onOpenGlobalSearch={() => openGlobalSearch()}
        onToggleTerminal={toggleTerminal}
        onOpenSettings={() => setShowSettings(true)}
        tabBar={
          <TabBar
            tabs={tabs.tabs}
            activeTabPath={tabs.activeTabPath}
            setActiveTabPath={tabs.setActiveTabPath}
            closeTab={handleTabClose}
            closeOtherTabs={handleTabCloseOthers}
            closeAllTabs={handleTabCloseAll}
            togglePin={handleTabTogglePin}
            detachTab={isLeanWindow ? handleTabReturn : handleTabDetach}
            isPrimaryWindow={!isLeanWindow}
            showHistory={setHistoryPath}
            rootPaths={tree.rootNodes.map((r) => r.path)}
            reorderTab={handleTabReorder}
            isPathShared={workTogether.isSharing}
          />
        }
      />

      <div className="flex flex-1 overflow-hidden relative">
        <div
          className={clsx(
            'flex-1 flex flex-col min-w-0 relative',
            settings.sidebarPosition === 'left' && 'order-2'
          )}
        >
          {/* The active file's actions float over the editor's top-right
              corner, Obsidian-style, rather than living in the title bar.
              The external-change banner is in-flow above the editor, so the
              actions drop below it instead of overlapping its buttons. */}
          {hasFileActions && (
            <div
              className={clsx(
                'absolute right-2 z-20',
                tabs.externalChangeAvailable ? 'top-9' : 'top-1'
              )}
            >
              <FileActions
                selectedPath={tabs.selectedPath}
                isFileInWorkspace={
                  !!tabs.selectedPath &&
                  isUnderAnyRoot(
                    tabs.selectedPath,
                    tree.rootNodes.map((r) => r.path)
                  )
                }
                showPreview={tabs.showMarkdownPreview}
                isPreviewable={isPreviewablePath(tabs.selectedPath)}
                canFold={isMarkdownPath(tabs.selectedPath) && !tabs.showMarkdownPreview}
                foldedAll={foldedAll}
                canDictate={canDictate}
                isProse={settings.readAloudEnabled && isProsePath(tabs.selectedPath)}
                workTogetherEnabled={settings.extensions.workTogether.enabled}
                workTogetherSharing={
                  !!tabs.selectedPath && workTogether.isSharing(tabs.selectedPath)
                }
                workTogetherParticipantCount={
                  (tabs.selectedPath &&
                    workTogether.sessions[tabs.selectedPath]?.participants.length) ||
                  0
                }
                spellcheckOn={settings.spellcheckEnabled && settings.spellLanguages.length > 0}
                spellIssueCount={spell.issues.length}
                onNextSpellingIssue={() => spell.revealNextIssue(editorInstanceRef.current)}
                httpEnvironmentNames={httpEnv?.names ?? []}
                httpEnvironment={httpEnvironmentName}
                onSelectHttpEnvironment={selectHttpEnvironment}
                voice={voice}
                readAloud={readAloud}
                onRevealActiveFile={() => {
                  if (!settings.sidebarVisible) updateSetting('sidebarVisible', true)
                  setSidebarView('files')
                  if (tabs.selectedPath) tree.setRevealPath(tabs.selectedPath)
                }}
                onRunPython={() => tabs.selectedPath && runPythonFile(tabs.selectedPath)}
                onRunHttp={() => runHttpRequest()}
                onFormatDocument={formatActiveDocument}
                onToggleFold={toggleFold}
                onTogglePreview={() => tabs.activeTabPath && tabs.togglePreview(tabs.activeTabPath)}
                onToggleDictation={toggleDictation}
                onStartReadAloud={startReadAloud}
                onOpenShare={() => setShowShareDialog(true)}
              />
            </div>
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

          <div className="flex-1 overflow-hidden flex">
            <div className="flex-1 min-w-0 overflow-hidden">
              {activeExt ? (
                activeExt.id === 'google-tasks' ? (
                  <GoogleTasksTab settings={settings} updateSetting={updateSetting} />
                ) : activeExt.id === 'ports' ? (
                  <PortsTab />
                ) : activeExt.id === 'http-client' ? (
                  <HttpClientTab
                    settings={settings}
                    updateSetting={updateSetting}
                    exchange={activeExchange}
                    onSend={(spec) => tabs.selectedPath && http.send(tabs.selectedPath, spec)}
                    onCancel={() => tabs.selectedPath && http.cancel(tabs.selectedPath)}
                    onSaveToFile={startHttpSave}
                    rootNodes={tree.rootNodes}
                    onOpenRequest={(filePath, line) => tabs.openTab(filePath, line)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                    Unknown extension: {activeExt.id}
                  </div>
                )
              ) : tabs.selectedPath ? (
                tabs.showMarkdownPreview && isMarkdownPath(tabs.selectedPath) ? (
                  <MarkdownPreview content={tabs.fileContent} documentPath={tabs.selectedPath} />
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

            {activeExchange && tabs.selectedPath && !activeExt && (
              <HttpResponsePane
                exchange={activeExchange}
                width={httpPaneWidth.width}
                onStartResize={httpPaneWidth.startResizing}
                onCancel={() => tabs.selectedPath && http.cancel(tabs.selectedPath)}
                onClose={() => tabs.selectedPath && http.close(tabs.selectedPath)}
              />
            )}
          </div>
        </div>

        {settings.sidebarVisible && !isLeanWindow && (
          <div
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
              onAddFolder={tree.handleAddFolder}
              extensions={enabledExtensions}
              activeExtensionId={activeExt?.id ?? null}
              onOpenExtension={(id) => tabs.openTab(makeExtensionPath(id))}
              recentExternalFiles={recentExternalPaths}
              onRemoveRecentExternalFile={handleRemoveRecent}
              selectedPath={tabs.selectedPath}
              selectedPaths={tree.selectedPathSet}
              revealRequest={tree.revealRequest}
              onSelect={handleTreeSelect}
              onContextMenu={handleTreeContextMenu}
              onCreateNew={handleTreeCreateNew}
              onMove={handleTreeMove}
              onRowClick={handleTreeRowClick}
              onRunPython={handleTreeRunPython}
              onPreviewMarkdown={handleTreePreview}
              git={git}
              gitPanelRoot={gitPanelRoot}
              onSelectGitRoot={setGitPanelRoot}
              onOpenGit={openGitPanel}
              isPathShared={workTogether.isSharing}
              onOpenShare={openShareDialogFor}
            />
          </div>
        )}
      </div>

      {/* Below everything, the full width of the window: the sidebar stops
          where the terminal starts rather than the terminal living inside the
          editor column, which left it a narrow sliver on a narrow window. In
          the layout rather than floating over the editor, so the editor gets
          the height that's left - a long file scrolls to its last line
          instead of ending underneath the panel. */}
      {terminal.showTerminal && terminal.terminals.length > 0 && !isLeanWindow && (
        <TerminalPanel
          terminal={terminal}
          fontSize={density.terminalFontSize}
          onOpenNew={openDefaultTerminal}
        />
      )}

      {showSearch && (
        <GlobalSearch
          onClose={() => setShowSearch(false)}
          initialQuery={searchInitialQuery}
          initialShowReplace={searchStartsInReplace}
          unsavedPaths={unsavedTabPaths}
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
          progress={updateProgress}
          onApply={handleApplyUpdate}
          onDismiss={() => setUpdateNotification(null)}
        />
      )}

      {showFileSearch && (
        <FileSearch
          onClose={() => setShowFileSearch(false)}
          initialQuery={fileSearchInitialQuery}
          onQueryChange={(q) => {
            fileSearchQueryRef.current = q
          }}
          onSelect={(path, type) => {
            if (type === 'directory') tree.setRevealPath(path)
            else tabs.openTab(path)
            setShowFileSearch(false)
          }}
          rootNodes={tree.rootNodes}
        />
      )}

      {httpSaveSpec && (
        <HttpSaveRequestModal
          rootNodes={tree.rootNodes}
          defaultName={defaultRequestName(httpSaveSpec)}
          onSave={confirmHttpSave}
          onCancel={() => setHttpSaveSpec(null)}
        />
      )}

      {historyPath && (
        <LocalHistoryModal
          filePath={historyPath}
          currentContent={tabs.tabs.find((t) => t.path === historyPath)?.content ?? ''}
          monacoTheme={monacoTheme}
          // Restored into the tab, not onto disk: one undoable edit, and the
          // ordinary save path takes it from there.
          onRestore={(content) => tabs.setFileContent(historyPath, content)}
          onClose={() => setHistoryPath(null)}
        />
      )}

      {tree.contextMenu && (
        <TreeContextMenu
          x={tree.contextMenu.x}
          y={tree.contextMenu.y}
          node={tree.contextMenu.node}
          selectedNodes={tree.selectedNodes}
          clipboardCount={tree.clipboardCount}
          rootPaths={tree.rootNodes.map((r) => r.path)}
          onClose={() => tree.setContextMenu(null)}
          onOpenTerminalHere={openTerminalHere}
          onCreateNew={tree.startCreate}
          onRename={tree.startRename}
          onCopy={tree.copySelection}
          onPaste={tree.pasteIntoNode}
          onDelete={tree.deleteSelection}
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
          updateProgress={updateProgress}
          onUpdateAction={handleApplyUpdate}
          onConfigureDictation={() => setShowDictationConfig(true)}
          onConfigureReadAloud={() => setShowReadAloudConfig(true)}
          onConfigureTranslate={() => setShowTranslateConfig(true)}
          onConfigureSpellcheck={() => setShowSpellcheckConfig(true)}
          onConfigureGoogleTasks={() => setShowGoogleTasksConfig(true)}
          onConfigureWorkTogether={() => setShowWorkTogetherConfig(true)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showSpellcheckConfig && (
        <SpellcheckConfigModal
          settings={settings}
          updateSetting={updateSetting}
          density={density}
          onClose={() => setShowSpellcheckConfig(false)}
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

      {showWorkTogetherConfig && (
        <WorkTogetherConfigModal
          settings={settings}
          updateSetting={updateSetting}
          density={density}
          onClose={() => setShowWorkTogetherConfig(false)}
        />
      )}

      {showShareDialog && tabs.selectedPath && (
        <ShareDialog
          fileName={tabs.selectedPath.split('/').pop() ?? tabs.selectedPath}
          session={workTogether.sessions[tabs.selectedPath]}
          onShare={(role, ttlSeconds) =>
            workTogether.share(
              tabs.selectedPath!,
              tabs.fileContent,
              getLanguage(tabs.selectedPath!),
              role,
              ttlSeconds
            )
          }
          onRevokeLink={(linkId) => workTogether.revokeLink(tabs.selectedPath!, linkId)}
          onStop={() => workTogether.stop(tabs.selectedPath!)}
          onClose={() => setShowShareDialog(false)}
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
