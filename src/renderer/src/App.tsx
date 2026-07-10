import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { FileNode } from './components/FileTree'
import { Terminal } from './components/Terminal'
import { GlobalSearch } from './components/GlobalSearch'
import { FileSearch } from './components/FileSearch'
import { MarkdownPreview } from './components/MarkdownPreview'
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
import { Modal } from './components/Modal'
import { DialogHost } from './components/DialogHost'
import { ToolbarButton } from './components/ToolbarButton'
import { alertDialog, confirmDialog } from './lib/dialogs'
import { getLanguage } from './lib/language'
import { getMonacoTheme } from './lib/editorTheme'
import { dirname, isUnderAnyRoot } from './lib/path'
import { prettyPrintMarkup } from './lib/formatMarkup'
import { quoteForShell } from './lib/shellQuote'
import Editor from '@monaco-editor/react'
import clsx from 'clsx'
import {
  FolderOpen,
  X,
  Terminal as TerminalIcon,
  Save,
  Plus,
  Play,
  AlignLeft,
  Search,
  Eye,
  Code2,
  GitBranch,
  Settings as SettingsIcon
} from 'lucide-react'

function App() {
  const { settings, updateSetting } = useSettings()
  const resolvedTheme = useTheme(settings.theme)
  const monacoTheme = getMonacoTheme(resolvedTheme)
  const density = DENSITY[settings.uiMode]

  const terminal = useTerminals()
  const tabs = useTabs(settings.tabsEnabled, settings.autosaveEnabled)
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
  const git = useGitStatus(settings.gitEnabled)
  useDiagnostics(settings.diagnosticsEnabled, tabs.selectedPath, tabs.isSaved, tree.rootNodes)
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
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarView, setSidebarView] = useState<'files' | 'git'>('files')

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          tabsRef.current.handleCloseFile()
          break
        case 'reopen-tab':
          tabsRef.current.reopenClosedTab()
          break
        case 'go-to-file':
          setShowFileSearch((prev) => !prev)
          break
        case 'find-in-files':
          setShowSearch(true)
          break
        case 'toggle-git-panel':
          setSidebarView((prev) => (prev === 'git' ? 'files' : 'git'))
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

  const handleFormatJson = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(tabs.fileContent), null, 2)
      if (tabs.activeTabPath)
        tabs.updateTab(tabs.activeTabPath, { content: formatted, isSaved: false })
    } catch (e) {
      alertDialog('Invalid JSON format.')
    }
  }

  const handleFormatMarkup = (): void => {
    if (!tabs.activeTabPath) return
    tabs.updateTab(tabs.activeTabPath, {
      content: prettyPrintMarkup(tabs.fileContent),
      isSaved: false
    })
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
              <ToolbarButton
                onClick={tabs.handleSave}
                disabled={tabs.isSaved}
                colorClassName={!tabs.isSaved ? 'text-blue-400' : 'text-gray-500'}
                title="Save (Cmd+S)"
              >
                <Save size={16} />
              </ToolbarButton>
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
                  onClick={handleFormatJson}
                  title="Format JSON"
                  colorClassName="text-yellow-500"
                >
                  <AlignLeft size={16} />
                </ToolbarButton>
              )}
              {(tabs.selectedPath?.endsWith('.html') ||
                tabs.selectedPath?.endsWith('.htm') ||
                tabs.selectedPath?.endsWith('.xml')) && (
                <ToolbarButton
                  onClick={handleFormatMarkup}
                  title="Format Document"
                  colorClassName="text-yellow-500"
                >
                  <AlignLeft size={16} />
                </ToolbarButton>
              )}
              {tabs.selectedPath?.endsWith('.md') && (
                <ToolbarButton
                  onClick={() =>
                    tabs.activeTabPath &&
                    tabs.updateTab(tabs.activeTabPath, { showPreview: !tabs.showMarkdownPreview })
                  }
                  active={tabs.showMarkdownPreview}
                  title={tabs.showMarkdownPreview ? 'Show Source' : 'Show Preview'}
                >
                  {tabs.showMarkdownPreview ? <Code2 size={16} /> : <Eye size={16} />}
                </ToolbarButton>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 no-drag-region shrink-0">
          <ToolbarButton
            onClick={() => setShowSearch(true)}
            ariaLabel="Global Search (Shift+Cmd+F)"
            colorClassName="text-gray-400 hover:text-white"
          >
            <Search size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={tree.handleAddFolder}
            title="Add Folder"
            colorClassName="text-gray-400 hover:text-white"
          >
            <FolderOpen size={16} />
          </ToolbarButton>
          <div className="w-px h-4 bg-fleet-border mx-1" />
          <ToolbarButton
            onClick={() => {
              if (!terminal.showTerminal && terminal.terminals.length === 0)
                terminal.openNewTerminal()
              else terminal.setShowTerminal(!terminal.showTerminal)
            }}
            active={terminal.showTerminal}
            title="Toggle Terminal"
          >
            <TerminalIcon size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setShowSettings(true)}
            title="Settings"
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
              ) : (
                <Editor
                  height="100%"
                  path={tabs.selectedPath}
                  language={getLanguage(tabs.selectedPath)}
                  theme={monacoTheme}
                  value={tabs.fileContent}
                  onChange={tabs.handleEditorChange}
                  onMount={tabs.handleEditorDidMount}
                  options={{
                    minimap: { enabled: false },
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
                  onClick={() => terminal.openNewTerminal()}
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
          style={{ width: `${sidebarWidth.width}px` }}
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
            revealPath={tree.revealPath}
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
            onGitPush={git.push}
            onGitPull={git.pull}
            onGitDiff={git.diff}
          />
        </div>
      </div>

      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} onSelect={tabs.openTab} />}
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
          onClose={() => setShowSettings(false)}
        />
      )}

      <DialogHost />
    </div>
  )
}

export default App
