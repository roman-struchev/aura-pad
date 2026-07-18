import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { FileNode } from './components/FileTree'
import { Terminal } from './components/Terminal'
import { GlobalSearch } from './components/GlobalSearch'
import { FileSearch } from './components/FileSearch'
import { MarkdownPreview } from './components/MarkdownPreview'
import { HtmlPreview } from './components/HtmlPreview'
import { SettingsModal } from './components/SettingsModal'
import { TabBar } from './components/TabBar'
import { Sidebar } from './components/Sidebar'
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
import { useReadAloud, VOICE_CATALOG, downloadedVoices } from './hooks/useReadAloud'
import { useTranslate } from './hooks/useTranslate'
import { READ_LANGS } from '../../shared/settings'
import type { UpdateNotification } from '../../shared/updateNotification'
import { VoiceModelModal } from './components/VoiceModelModal'
import { ReadAloudModal } from './components/ReadAloudModal'
import { TranslateModal } from './components/TranslateModal'
import { TranslatePopup } from './components/TranslatePopup'
import { VoiceLevelMeter } from './components/VoiceLevelMeter'
import { Modal } from './components/Modal'
import { DialogHost } from './components/DialogHost'
import { ToolbarButton } from './components/ToolbarButton'
import { alertDialog, confirmDialog } from './lib/dialogs'
import { getLanguage } from './lib/language'
import { getMonacoTheme } from './lib/editorTheme'
import { dirname, isUnderAnyRoot } from './lib/path'
import { prettyPrintMarkup } from './lib/formatMarkup'
import { quoteForShell } from './lib/shellQuote'
import { MONO_FONT_FAMILY } from './lib/fonts'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import clsx from 'clsx'
import {
  FolderOpen,
  X,
  Terminal as TerminalIcon,
  Plus,
  Play,
  AlignLeft,
  Search,
  Crosshair,
  Eye,
  Code2,
  GitBranch,
  Settings as SettingsIcon,
  Mic,
  Loader2,
  Square,
  Volume2
} from 'lucide-react'

// File types with a rendered preview mode (the toolbar's Show Preview toggle
// and the tree's hover eye icon): Markdown, plus raw HTML in a sandboxed
// iframe.
const isHtmlPath = (path: string | null): boolean =>
  !!path && (path.endsWith('.html') || path.endsWith('.htm'))
const isPreviewablePath = (path: string | null): boolean =>
  !!path && (path.endsWith('.md') || isHtmlPath(path))
// Voice features target prose, not code: dictation inserts into (and the
// read-aloud button reads from) Markdown and plain-text files only.
const isProsePath = (path: string | null): boolean =>
  !!path && (path.endsWith('.md') || path.endsWith('.markdown') || path.endsWith('.txt'))

function App() {
  const { settings, updateSetting } = useSettings()
  const resolvedTheme = useTheme(settings.theme)
  const monacoTheme = getMonacoTheme(resolvedTheme)
  const density = DENSITY[settings.uiMode]

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
  // Same ref pattern as tabsRef: the menu-action effect below subscribes once
  // but must always call the current render's toggle (which sees live status).
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
    if (!isProsePath(t.selectedPath)) return
    if (t.showMarkdownPreview && t.activeTabPath)
      t.updateTab(t.activeTabPath, { showPreview: false })
    v.toggle()
  }
  const canDictate = isProsePath(tabs.selectedPath)

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
        t.updateTab(path, {
          content: JSON.stringify(JSON.parse(t.fileContent), null, 2),
          isSaved: false
        })
      } catch {
        alertDialog('Invalid JSON format.')
      }
    } else if (path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('.xml')) {
      t.updateTab(path, { content: prettyPrintMarkup(t.fileContent), isSaved: false })
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

  // Shared by the toolbar button and the Ctrl+` menu accelerator.
  const toggleTerminal = (): void => {
    const term = terminalRef.current
    if (!term.showTerminal && term.terminals.length === 0)
      term.openNewTerminal(defaultTerminalCwd())
    else term.setShowTerminal(!term.showTerminal)
  }

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
    const t = tabsRef.current
    if (!t.selectedPath) return
    const markdown = t.selectedPath.endsWith('.md')
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
  const git = useGitStatus(settings.gitEnabled)
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
  const [sidebarView, setSidebarView] = useState<'files' | 'git'>('files')
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

  const lastShiftTime = useRef<number>(0)
  // Tracks whether some other key fired between the last lone Shift press and
  // now, so two Shift keydowns close together only count as "double-Shift"
  // when nothing happened in between - not e.g. two Shift+<letter> presses
  // from fast CamelCase typing, each of which also fires its own Shift
  // keydown right before the letter.
  const keyPressedSinceShift = useRef<boolean>(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Monaco's built-in widgets (e.g. the Find/Replace bar's icon buttons) use
  // native title="" attributes, which pop up an OS-style tooltip that clashes
  // with the app's look. Some of those widgets render in an overlay layer
  // outside the specific editor instance's own DOM node, so watch the whole
  // document - but scope the selector to Monaco's own elements only, so this
  // never touches our own toolbar buttons' tooltips. Keep an aria-label so
  // screen readers still get the same text.
  useEffect(() => {
    const MONACO_TITLE_SELECTOR = '.monaco-editor[title], .monaco-editor [title]'
    const stripTitles = () => {
      document.querySelectorAll(MONACO_TITLE_SELECTOR).forEach((el) => {
        const title = el.getAttribute('title')
        if (title && !el.getAttribute('aria-label')) el.setAttribute('aria-label', title)
        el.removeAttribute('title')
      })
    }
    stripTitles()
    const observer = new MutationObserver(stripTitles)
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
    const suppressFindWidgetHover = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('.find-widget')) {
        e.stopPropagation()
      }
    }
    document.addEventListener('mouseover', suppressFindWidgetHover, true)
    return () => document.removeEventListener('mouseover', suppressFindWidgetHover, true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape with the translation popup open: dismiss it. Checked first -
      // the popup sits on top of whatever else is going on.
      if (e.key === 'Escape' && translateRef.current.popup) {
        translateRef.current.closePopup()
        return
      }
      // Escape during dictation: stop recording and throw the take away
      // (nothing gets transcribed or inserted).
      if (e.key === 'Escape' && voiceRef.current.status === 'recording') {
        voiceRef.current.cancelRecording()
        return
      }
      // Escape during read-aloud: stop speaking.
      if (e.key === 'Escape' && readAloudRef.current.speaking) {
        readAloudRef.current.stop()
        return
      }

      // Double-Shift quick open, JetBrains-style - toggles rather than just
      // opening, so pressing it again closes the dialog too.
      if (e.key === 'Shift') {
        const now = Date.now()
        if (now - lastShiftTime.current < 300 && !keyPressedSinceShift.current) {
          setShowFileSearch((prev) => !prev)
          lastShiftTime.current = 0
        } else {
          lastShiftTime.current = now
        }
        keyPressedSinceShift.current = false
      } else {
        keyPressedSinceShift.current = true
      }

      // Copy/paste/delete for the file tree - only when a tree row actually
      // has focus, so this never steals Cmd+C/V from the editor or terminal,
      // and never fires while typing in an input/textarea inside the sidebar
      // (e.g. the Git panel's commit message box).
      const isTreeFocused =
        !!sidebarRef.current?.contains(document.activeElement) &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      if (isTreeFocused && tree.focusedNode) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault()
          tree.setClipboard({ path: tree.focusedNode.path })
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && tree.clipboard) {
          e.preventDefault()
          tree.pasteIntoNode(tree.focusedNode)
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !tree.focusedNode.isRoot) {
          e.preventDefault()
          tree.deleteNode(tree.focusedNode)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tree.focusedNode, tree.clipboard])

  useEffect(() => {
    const handleClickOutside = () => tree.setContextMenu(null)
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

  // The native macOS/Windows/Linux menu owns these accelerators (Cmd+S,
  // Cmd+W, etc.) instead of a renderer-side keydown handler, so each key
  // press only ever triggers one handler - see menu.ts.
  useEffect(() => {
    const unsubscribe = window.api.onMenuAction((action) => {
      switch (action) {
        case 'open-folder':
          treeRef.current.handleAddFolder()
          break
        case 'save':
          tabsRef.current.handleSave()
          break
        case 'close-tab':
          // Context-sensitive: with focus inside the terminal panel (xterm
          // keeps it on a textarea within .xterm) Cmd+W closes the active
          // terminal, not the file tab hidden underneath it.
          if (document.activeElement?.closest('.xterm')) {
            terminalRef.current.closeActiveTerminal()
          } else {
            tabsRef.current.handleCloseFile()
          }
          break
        case 'reopen-tab':
          tabsRef.current.reopenClosedTab()
          break
        case 'go-to-file':
          setShowFileSearch((prev) => !prev)
          break
        case 'find-in-files':
          openGlobalSearch()
          break
        case 'toggle-git-panel':
          setSidebarView((prev) => (prev === 'git' ? 'files' : 'git'))
          break
        case 'toggle-dictation':
          toggleDictation()
          break
        case 'translate-selection':
          startTranslate()
          break
        case 'format-document':
          formatActiveDocument()
          break
        case 'toggle-preview': {
          const t = tabsRef.current
          if (t.activeTabPath && isPreviewablePath(t.selectedPath))
            t.updateTab(t.activeTabPath, { showPreview: !t.showMarkdownPreview })
          break
        }
        case 'toggle-terminal':
          toggleTerminal()
          break
        case 'preferences':
          setShowSettings(true)
          break
      }
    })
    return unsubscribe
  }, [])

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

  // Toggles: clicking the hover icon again on an already-previewing tab flips
  // it back to source. Checked before opening, since an already-open tab's
  // showPreview is untouched by openTab (only a brand-new tab starts at false).
  const previewMarkdown = async (node: FileNode): Promise<void> => {
    const wasPreviewing = tabs.tabs.find((t) => t.path === node.path)?.showPreview ?? false
    await tabs.openTab(node.path)
    tabs.updateTab(node.path, { showPreview: !wasPreviewing })
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

  // Show just the workspace the active file belongs to, not every open
  // workspace - the breadcrumb should say where you are, not list everything
  // that happens to be open.
  const activeRoot = tabs.selectedPath
    ? tree.rootNodes.find(
        (r) => tabs.selectedPath === r.path || tabs.selectedPath!.startsWith(r.path + '/')
      )
    : null
  // A file open from outside every workspace (the "Recently Opened" list)
  // isn't part of any of them, so it should show neither - not fall back to
  // listing every open workspace, which was just as misleading.
  const projectLabel = tabs.selectedPath
    ? (activeRoot?.name ?? 'AuraPad')
    : tree.rootNodes.length > 0
      ? tree.rootNodes.map((r) => r.name).join(', ')
      : 'AuraPad'
  const branchLabel = tabs.selectedPath
    ? activeRoot &&
      git.repos.find((r) => activeRoot.path === r.root || r.root.startsWith(activeRoot.path + '/'))
        ?.branch
    : git.repos[0]?.branch
  const hasFileActions = !!tabs.selectedPath
  const voiceBusy = voice.status === 'downloading' || voice.status === 'transcribing'

  return (
    <div
      className="flex h-screen bg-fleet-bg text-fleet-text flex-col relative overflow-hidden"
      onDragOver={handleWindowDragOver}
      onDrop={handleWindowDrop}
    >
      <div className="h-9 border-b border-fleet-border flex items-center justify-between px-3 bg-fleet-header select-none drag-region shrink-0">
        <div className="ml-24 font-medium text-xs text-gray-400 flex items-center gap-2 min-w-0">
          <span className="truncate max-w-[40vw]">{projectLabel}</span>
          {branchLabel && (
            <span className="flex items-center gap-1 text-gray-500 shrink-0">
              <GitBranch size={12} />
              {branchLabel}
            </span>
          )}
          {hasFileActions && (
            <div className="flex items-center gap-1 no-drag-region shrink-0">
              <div className="w-px h-4 bg-fleet-border mx-1" />
              {tabs.selectedPath &&
                isUnderAnyRoot(
                  tabs.selectedPath,
                  tree.rootNodes.map((r) => r.path)
                ) && (
                  <ToolbarButton
                    onClick={() => {
                      setSidebarView('files')
                      if (tabs.selectedPath) tree.setRevealPath(tabs.selectedPath)
                    }}
                    title="Select Opened File in Tree"
                    colorClassName="text-gray-400 hover:text-white"
                  >
                    <Crosshair size={16} />
                  </ToolbarButton>
                )}
              {tabs.selectedPath?.endsWith('.py') && (
                <ToolbarButton
                  onClick={() => tabs.selectedPath && runPythonFile(tabs.selectedPath)}
                  title="Run Python"
                  colorClassName="text-green-500"
                >
                  <Play size={16} />
                </ToolbarButton>
              )}
              {tabs.selectedPath?.endsWith('.json') && (
                <ToolbarButton
                  onClick={formatActiveDocument}
                  title="Format JSON (Option+Cmd+L)"
                  colorClassName="text-yellow-500"
                >
                  <AlignLeft size={16} />
                </ToolbarButton>
              )}
              {(tabs.selectedPath?.endsWith('.html') ||
                tabs.selectedPath?.endsWith('.htm') ||
                tabs.selectedPath?.endsWith('.xml')) && (
                <ToolbarButton
                  onClick={formatActiveDocument}
                  title="Format Document (Option+Cmd+L)"
                  colorClassName="text-yellow-500"
                >
                  <AlignLeft size={16} />
                </ToolbarButton>
              )}
              {isPreviewablePath(tabs.selectedPath) && (
                <ToolbarButton
                  onClick={() =>
                    tabs.activeTabPath &&
                    tabs.updateTab(tabs.activeTabPath, { showPreview: !tabs.showMarkdownPreview })
                  }
                  active={tabs.showMarkdownPreview}
                  title={
                    tabs.showMarkdownPreview
                      ? 'Show Source (Cmd+Shift+P)'
                      : 'Show Preview (Cmd+Shift+P)'
                  }
                >
                  {tabs.showMarkdownPreview ? <Code2 size={16} /> : <Eye size={16} />}
                </ToolbarButton>
              )}
              {canDictate && (
                <>
                  <ToolbarButton
                    onClick={toggleDictation}
                    title={
                      voice.status === 'recording'
                        ? 'Stop Dictation (Cmd+D)'
                        : voice.status === 'transcribing'
                          ? 'Transcribing…'
                          : voiceBusy
                            ? 'Downloading speech model…'
                            : 'Voice Dictation (Cmd+D)'
                    }
                    colorClassName={
                      voice.status === 'recording'
                        ? 'text-blue-400 bg-fleet-active'
                        : 'text-gray-400 hover:text-white'
                    }
                  >
                    {voiceBusy ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : voice.status === 'recording' ? (
                      <Square size={16} className="fill-current" />
                    ) : (
                      <Mic size={16} />
                    )}
                  </ToolbarButton>
                  {voice.status === 'recording' && (
                    <span className="flex items-center px-2 py-0.5 rounded-full bg-fleet-active text-blue-400 select-none">
                      {voice.analyser ? (
                        <VoiceLevelMeter analyser={voice.analyser} />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      )}
                    </span>
                  )}
                </>
              )}
              {(isProsePath(tabs.selectedPath) || readAloud.speaking) && (
                <>
                  <ToolbarButton
                    onClick={readAloud.speaking ? readAloud.stop : startReadAloud}
                    title={readAloud.speaking ? 'Stop Reading (Esc)' : 'Read Aloud'}
                    colorClassName={
                      readAloud.speaking
                        ? 'text-blue-400 bg-fleet-active'
                        : 'text-gray-400 hover:text-white'
                    }
                  >
                    {readAloud.speaking ? (
                      <Square size={16} className="fill-current" />
                    ) : (
                      <Volume2 size={16} />
                    )}
                  </ToolbarButton>
                  {readAloud.speaking &&
                    (readAloud.downloadProgress !== null ? (
                      <span
                        className="px-1.5 py-0.5 rounded-full bg-fleet-active text-blue-400 text-[11px] font-medium select-none"
                        title="Downloading voice…"
                      >
                        {readAloud.downloadProgress}%
                      </span>
                    ) : (
                      <button
                        onClick={readAloud.cycleRate}
                        className="px-1.5 py-0.5 rounded-full bg-fleet-active text-blue-400 text-[11px] font-medium hover:text-white select-none"
                        title="Reading speed"
                      >
                        {readAloud.rate}×
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 no-drag-region shrink-0">
          <ToolbarButton
            onClick={openGlobalSearch}
            title="Global Search (Cmd+Shift+F)"
            tooltipAlign="right"
            colorClassName="text-gray-400 hover:text-white"
          >
            <Search size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={tree.handleAddFolder}
            title="Add Folder"
            tooltipAlign="right"
            colorClassName="text-gray-400 hover:text-white"
          >
            <FolderOpen size={16} />
          </ToolbarButton>
          <div className="w-px h-4 bg-fleet-border mx-1" />
          <ToolbarButton
            onClick={toggleTerminal}
            active={terminal.showTerminal}
            title="Toggle Terminal (Ctrl+`)"
            tooltipAlign="right"
          >
            <TerminalIcon size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setShowSettings(true)}
            title="Settings (Cmd+,)"
            tooltipAlign="right"
            colorClassName="text-gray-400 hover:text-white"
          >
            <SettingsIcon size={16} />
          </ToolbarButton>
        </div>
      </div>

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
              closeTab={tabs.closeTab}
              closeOtherTabs={tabs.closeOtherTabs}
              closeAllTabs={tabs.closeAllTabs}
              togglePin={tabs.togglePin}
              reorderTab={tabs.reorderTab}
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
            {tabs.selectedPath ? (
              tabs.showMarkdownPreview && tabs.selectedPath.endsWith('.md') ? (
                <MarkdownPreview content={tabs.fileContent} />
              ) : tabs.showMarkdownPreview && isHtmlPath(tabs.selectedPath) ? (
                <HtmlPreview content={tabs.fileContent} />
              ) : (
                <Editor
                  height="100%"
                  path={tabs.selectedPath}
                  language={getLanguage(tabs.selectedPath)}
                  theme={monacoTheme}
                  value={tabs.fileContent}
                  onChange={tabs.handleEditorChange}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontFamily: MONO_FONT_FAMILY,
                    fontSize: density.editorFontSize,
                    wordWrap: 'on',
                    padding: { top: 6 },
                    scrollBeyondLastLine: false,
                    lineNumbers: settings.lineNumbersEnabled ? 'on' : 'off',
                    // Tighter gutter than Monaco's defaults; 0 when line
                    // numbers are off so text isn't indented for no reason.
                    lineNumbersMinChars: settings.lineNumbersEnabled ? 4 : 0,
                    lineDecorationsWidth: settings.lineNumbersEnabled ? 4 : 0,
                    scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 }
                  }}
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
            <div
              className="absolute bottom-0 left-0 right-0 border-t border-[var(--terminal-border)] flex flex-col bg-[var(--terminal-panel)] z-30 shadow-2xl"
              style={{ height: `${terminal.terminalHeight}px` }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-blue-500/50 transition-colors z-40"
                onMouseDown={(e) => {
                  e.preventDefault()
                  terminal.setIsResizing(true)
                }}
              />
              <div className="flex items-center border-b border-[var(--terminal-border)] bg-[var(--terminal-header)] px-2 overflow-x-auto shrink-0">
                {terminal.terminals.map((term) => (
                  <div
                    key={term.id}
                    onClick={() => terminal.setActiveTermId(term.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--terminal-border)] ${terminal.activeTermId === term.id ? 'bg-[var(--terminal-active)] text-white' : 'text-gray-400 hover:bg-[var(--terminal-active)] hover:text-gray-200'}`}
                  >
                    <span>{term.name}</span>
                    <X
                      size={12}
                      className="opacity-50 hover:opacity-100"
                      onClick={(e) => terminal.closeTerminal(term.id, e)}
                    />
                  </div>
                ))}
                <button
                  onClick={() => terminal.openNewTerminal(defaultTerminalCwd())}
                  className="p-1.5 text-gray-400 hover:text-white mx-1"
                >
                  <Plus size={14} />
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => terminal.setShowTerminal(false)}
                  className="p-1.5 text-gray-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden relative bg-[var(--terminal-bg)]">
                {terminal.terminals.map((term) => (
                  <div
                    key={term.id}
                    className="absolute inset-0"
                    style={{
                      zIndex: terminal.activeTermId === term.id ? 10 : 1,
                      visibility: terminal.activeTermId === term.id ? 'visible' : 'hidden'
                    }}
                  >
                    <Terminal
                      termId={term.id}
                      isActive={terminal.activeTermId === term.id}
                      fontSize={density.terminalFontSize}
                      onExit={() => terminal.handleTerminalExit(term.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

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
            recentExternalFiles={recentExternalFiles.entries.map((e) => e.path)}
            onRemoveRecentExternalFile={handleRemoveRecentExternalFile}
            selectedPath={tabs.selectedPath}
            revealRequest={tree.revealRequest}
            onSelect={tabs.openTab}
            onContextMenu={tree.handleContextMenu}
            onCreateNew={tree.startCreate}
            onMove={tree.handleMove}
            onFocusNode={tree.handleFocusNode}
            onRunPython={(node) => runPythonFile(node.path)}
            onPreviewMarkdown={previewMarkdown}
            gitFileStates={git.fileStates}
            gitRepos={git.repos}
            onGitStage={git.stage}
            onGitUnstage={git.unstage}
            onGitDiscard={git.discard}
            onGitCommit={git.commit}
            onGitCommitAndPush={git.commitAndPush}
            onGitPush={git.push}
            onGitPull={git.pull}
            onGitDiff={git.diff}
            onGitLastCommitMessage={git.lastCommitMessage}
          />
        </div>
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
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-4 bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl px-4 py-3 text-xs text-fleet-text">
          {updateInstalling ? (
            <>
              <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
              <span>
                {updateNotification.mode === 'install'
                  ? 'Restarting to install the update…'
                  : `Installing AuraPad ${updateNotification.version}… the app will restart itself.`}
              </span>
            </>
          ) : (
            <>
              <span>
                {updateNotification.failed
                  ? 'Update failed — check your connection and try again.'
                  : updateNotification.mode === 'install'
                    ? `AuraPad ${updateNotification.version} is ready to install.`
                    : `AuraPad ${updateNotification.version} is available.`}
              </span>
              <button
                className="underline text-blue-400 hover:text-blue-300"
                onClick={() => {
                  window.api.applyUpdate()
                  // 'manual' just opens the releases page - nothing to wait
                  // for. The self-applying modes keep the toast up as a
                  // progress indicator until the app restarts itself.
                  if (updateNotification.mode === 'manual') setUpdateNotification(null)
                  else setUpdateInstalling(true)
                }}
              >
                {updateNotification.failed
                  ? 'Retry'
                  : updateNotification.mode === 'install'
                    ? 'Restart'
                    : updateNotification.mode === 'script'
                      ? 'Install'
                      : 'Download'}
              </button>
              <button
                className="underline text-gray-500 hover:text-gray-400"
                onClick={() => setUpdateNotification(null)}
              >
                Later
              </button>
            </>
          )}
        </div>
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
        <Modal onClose={() => tree.setRenameTarget(null)}>
          <div className="text-xs text-gray-400 mb-2 truncate">
            Rename &quot;{tree.renameTarget.name}&quot;
          </div>
          <input
            ref={renameInputRef}
            className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-sm text-fleet-text outline-none focus:border-blue-500"
            value={tree.renameValue}
            onChange={(e) => tree.setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tree.confirmRename()
            }}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400"
              onClick={() => tree.setRenameTarget(null)}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
              onClick={tree.confirmRename}
            >
              Rename
            </button>
          </div>
        </Modal>
      )}

      {tree.createTarget && (
        <Modal onClose={() => tree.setCreateTarget(null)}>
          <div className="text-xs text-gray-400 mb-2 truncate">
            New {tree.createTarget.type === 'directory' ? 'Folder' : 'File'} in &quot;
            {tree.createTarget.parentPath.split('/').pop()}&quot;
          </div>
          <input
            ref={createInputRef}
            className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-sm text-fleet-text outline-none focus:border-blue-500"
            value={tree.createValue}
            placeholder={tree.createTarget.type === 'directory' ? 'folder-name' : 'file-name.ts'}
            onChange={(e) => tree.setCreateValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tree.confirmCreate()
            }}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400"
              onClick={() => tree.setCreateTarget(null)}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
              onClick={tree.confirmCreate}
            >
              Create
            </button>
          </div>
        </Modal>
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          updateSetting={updateSetting}
          density={density}
          appVersion={appVersion}
          updateNotification={updateNotification}
          updateInstalling={updateInstalling}
          onUpdateAction={() => {
            window.api.applyUpdate()
            if (updateNotification?.mode === 'manual') setUpdateNotification(null)
            else setUpdateInstalling(true)
          }}
          onConfigureDictation={() => setShowDictationConfig(true)}
          onConfigureReadAloud={() => setShowReadAloudConfig(true)}
          onConfigureTranslate={() => setShowTranslateConfig(true)}
          onClose={() => setShowSettings(false)}
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

      {(translate.status === 'consent' ||
        translate.status === 'downloading' ||
        showTranslateConfig) && (
        <TranslateModal
          defaultModel={settings.translateModel}
          defaultPair={settings.translatePair}
          downloading={translate.status === 'downloading'}
          progress={translate.progress}
          onConfirm={(model, pair) => {
            updateSetting('translateModel', model)
            updateSetting('translatePair', pair)
            setShowTranslateConfig(false)
            // Also warms/downloads the model; harmless when opened from
            // Settings - the modal stays visible through 'downloading'.
            translate.confirmDownload(model, pair)
          }}
          onDeleteUnit={translate.deleteUnit}
          onClose={() => {
            setShowTranslateConfig(false)
            if (translate.status === 'downloading') translate.cancelDownload()
            else translate.dismissConsent()
          }}
        />
      )}

      {(voice.status === 'consent' || voice.status === 'downloading' || showDictationConfig) && (
        <VoiceModelModal
          defaultModel={settings.voiceModel}
          language={settings.voiceLanguage}
          onLanguageChange={(lang) => updateSetting('voiceLanguage', lang)}
          downloading={voice.status === 'downloading'}
          progress={voice.progress}
          onConfirm={(model) => {
            updateSetting('voiceModel', model)
            setShowDictationConfig(false)
            // Also warms/downloads the model; harmless when opened from
            // Settings - the modal stays visible through 'downloading'.
            voice.confirmDownload(model)
          }}
          onDeleteModel={voice.deleteModel}
          onClose={() => {
            setShowDictationConfig(false)
            if (voice.status === 'downloading') voice.cancelDownload()
            else voice.dismissConsent()
          }}
        />
      )}

      {(readAloud.modalPhase !== null || showReadAloudConfig) && (
        <ReadAloudModal
          langs={showReadAloudConfig ? READ_LANGS : readAloud.consentLangs}
          current={settings.readVoices}
          downloading={readAloud.modalPhase === 'downloading'}
          progress={readAloud.downloadProgress}
          mode={showReadAloudConfig ? 'settings' : 'consent'}
          onConfirm={(choices) => {
            updateSetting('readVoices', { ...settings.readVoices, ...choices })
            if (showReadAloudConfig) {
              // Settings flow: download anything newly selected, no reading.
              const missing = Object.entries(choices)
                .map(([lang, key]) =>
                  key && key !== 'system'
                    ? (
                        VOICE_CATALOG[lang as keyof typeof VOICE_CATALOG] as Record<
                          string,
                          { id: string }
                        >
                      )[key].id
                    : null
                )
                .filter((id): id is string => !!id && !downloadedVoices().includes(id))
              if (missing.length > 0) readAloud.predownloadVoices(missing)
              else setShowReadAloudConfig(false)
            } else {
              readAloud.confirmVoiceDownload(choices)
            }
          }}
          onDeleteVoice={readAloud.deleteVoice}
          onClose={() => {
            setShowReadAloudConfig(false)
            readAloud.closeVoiceModal()
          }}
        />
      )}

      <DialogHost />
    </div>
  )
}

export default App
