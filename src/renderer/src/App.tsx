import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileTree, FileNode } from './components/FileTree'
import { Terminal } from './components/Terminal'
import { GlobalSearch } from './components/GlobalSearch'
import { FileSearch } from './components/FileSearch'
import { MarkdownPreview } from './components/MarkdownPreview'
import { SettingToggle } from './components/SettingToggle'
import { SettingSelect } from './components/SettingSelect'
import { GitPanel } from './components/GitPanel'
import { DENSITY, UI_MODES } from './density'
import { SIDEBAR_POSITIONS } from '../../shared/settings'
import { useTheme } from './hooks/useTheme'
import { useSettings } from './hooks/useSettings'
import { useTerminals } from './hooks/useTerminals'
import { useTabs } from './hooks/useTabs'
import { useWorkspaceTree } from './hooks/useWorkspaceTree'
import { useGitStatus } from './hooks/useGitStatus'
import { Modal } from './components/Modal'
import { DialogHost } from './components/DialogHost'
import { ToolbarButton } from './components/ToolbarButton'
import { alertDialog, confirmDialog } from './lib/dialogs'
import { getLanguage } from './lib/language'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
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
  Settings as SettingsIcon,
  Pin,
  PinOff,
  GitBranch,
  Files
} from 'lucide-react'

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '⌘S', description: 'Save file' },
  { keys: '⌘W', description: 'Close tab' },
  { keys: '⇧⌘T', description: 'Reopen closed tab' },
  { keys: '⇧⌘F', description: 'Search in workspace' },
  { keys: 'Shift Shift', description: 'Quick open a file or folder' },
  { keys: '⌘C / ⌘V', description: 'Copy/paste in the file tree (row focused)' },
  { keys: 'Delete', description: 'Delete in the file tree (row focused)' },
  { keys: 'Esc', description: 'Close a dialog' }
]

function App() {
  const isDark = useTheme()
  const { settings, updateSetting } = useSettings()
  const density = DENSITY[settings.uiMode]

  const terminal = useTerminals()
  const tabs = useTabs(settings.tabsEnabled, settings.autosaveEnabled)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const tree = useWorkspaceTree({
    onFileCreated: tabs.openTab,
    onPathChanged: tabs.remapTabPaths,
    onPathDeleted: tabs.closeTabsUnder,
    renameInputRef,
    createInputRef
  })
  const git = useGitStatus(settings.gitEnabled)

  // Search / settings overlay state
  const [showSearch, setShowSearch] = useState(false)
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarView, setSidebarView] = useState<'files' | 'git'>('files')

  const lastShiftTime = useRef<number>(0)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)

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
      // Double Shift detection
      if (e.key === 'Shift') {
        const now = Date.now()
        if (now - lastShiftTime.current < 300) {
          setShowFileSearch(true)
          lastShiftTime.current = 0
        } else {
          lastShiftTime.current = now
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        tabs.handleSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        tabs.handleCloseFile()
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault()
        tabs.reopenClosedTab()
      }
      if (
        (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') ||
        (e.shiftKey &&
          e.key === 'F' &&
          !e.metaKey &&
          !e.ctrlKey &&
          document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA')
      ) {
        // Only trigger Shift+F if not in an input field (to avoid interference with typing)
        // Standard IDEs use Shift+Cmd+F for global search.
        if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          setShowSearch(true)
        }
      }

      // Copy/paste/delete for the file tree - only when a tree row actually
      // has focus, so this never steals Cmd+C/V from the editor or terminal.
      const isTreeFocused = !!sidebarRef.current?.contains(document.activeElement)
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
  }, [tabs, tree.focusedNode, tree.clipboard])

  useEffect(() => {
    const handleClickOutside = () => tree.setContextMenu(null)
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  // TS/JS diagnostics are Monaco's own bundled worker - free once each file
  // has a stable path-based model (see the Editor's `path` prop below).
  // Toggle it globally through the setting rather than per-model.
  useEffect(() => {
    const diagnosticsOptions = {
      noSyntaxValidation: !settings.diagnosticsEnabled,
      noSemanticValidation: !settings.diagnosticsEnabled
    }
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
    monaco.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
  }, [settings.diagnosticsEnabled])

  // Python (via ast.parse) and ESLint (via the opened project's own local
  // install, if any) aren't live like Monaco's TS worker, so re-check once a
  // tab becomes active and again whenever a save completes.
  useEffect(() => {
    if (!settings.diagnosticsEnabled || !tabs.selectedPath || !tabs.isSaved) return
    const path = tabs.selectedPath
    const model = monaco.editor.getModel(monaco.Uri.parse(path))
    if (!model) return

    const run = async () => {
      if (path.endsWith('.py')) {
        const marker = await window.api.lintPython(path)
        monaco.editor.setModelMarkers(
          model,
          'aura-python',
          marker
            ? [
                {
                  severity: monaco.MarkerSeverity.Error,
                  startLineNumber: marker.line,
                  startColumn: marker.column,
                  endLineNumber: marker.line,
                  endColumn: marker.column + 1,
                  message: marker.message
                }
              ]
            : []
        )
      } else if (/\.(ts|tsx|js|jsx)$/.test(path)) {
        const root = tree.rootNodes.find((r) => path.startsWith(r.path + '/'))
        if (!root) return
        const markers = await window.api.lintEslint(path, root.path)
        monaco.editor.setModelMarkers(
          model,
          'aura-eslint',
          markers.map((m) => ({
            severity:
              m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            startLineNumber: m.line,
            startColumn: m.column,
            endLineNumber: m.endLine || m.line,
            endColumn: m.endColumn || m.column + 1,
            message: m.message
          }))
        )
      }
    }
    run()
  }, [settings.diagnosticsEnabled, tabs.selectedPath, tabs.isSaved, tree.rootNodes])

  const runPython = (node: FileNode) => {
    const cwd = node.path.substring(0, node.path.lastIndexOf('/'))
    terminal.openNewTerminal(cwd, `python3 "${node.path}"`)
    tree.setContextMenu(null)
  }

  const previewMarkdown = async (node: FileNode): Promise<void> => {
    await tabs.openTab(node.path)
    tabs.updateTab(node.path, { showPreview: true })
  }

  const openTerminalHere = (node: FileNode) => {
    const cwd =
      node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    terminal.openNewTerminal(cwd)
    tree.setContextMenu(null)
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

  const handleRunCurrentPython = () => {
    if (tabs.selectedPath) {
      const cwd = tabs.selectedPath.substring(0, tabs.selectedPath.lastIndexOf('/'))
      terminal.openNewTerminal(cwd, `python3 "${tabs.selectedPath}"`)
    }
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

  return (
    <div
      className="flex h-screen bg-fleet-bg text-fleet-text flex-col relative overflow-hidden"
      onDragOver={handleWindowDragOver}
      onDrop={handleWindowDrop}
    >
      <div className="h-10 border-b border-fleet-border flex items-center justify-between px-4 bg-fleet-header select-none drag-region shrink-0">
        <div className="ml-24 font-medium text-xs text-gray-400 flex items-center gap-2 truncate max-w-[50%]">
          {tabs.selectedPath ? tabs.selectedPath.split('/').pop() : 'Aura Editor'}
          {!tabs.isSaved && tabs.selectedPath && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          )}
        </div>
        <div className="flex items-center gap-1 no-drag-region">
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
          {tabs.selectedPath?.endsWith('.py') && (
            <ToolbarButton
              onClick={handleRunCurrentPython}
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
          <ToolbarButton
            onClick={tabs.handleSave}
            disabled={tabs.isSaved || !tabs.selectedPath}
            colorClassName={!tabs.isSaved ? 'text-blue-400' : 'text-gray-500'}
            title="Save (Cmd+S)"
          >
            <Save size={16} />
          </ToolbarButton>
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
          {settings.tabsEnabled && tabs.tabs.length > 0 && (
            <div
              className={clsx(
                'flex items-stretch border-b border-fleet-border overflow-x-auto shrink-0 bg-fleet-header',
                density.tabBarHeight
              )}
            >
              {tabs.tabs.map((tab) => (
                <div
                  key={tab.path}
                  draggable
                  onClick={() => tabs.setActiveTabPath(tab.path)}
                  onDragStart={() => setDraggedTab(tab.path)}
                  onDragEnd={() => {
                    setDraggedTab(null)
                    setDragOverTab(null)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (draggedTab && draggedTab !== tab.path) setDragOverTab(tab.path)
                  }}
                  onDragLeave={() => setDragOverTab(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOverTab(null)
                    if (draggedTab) tabs.reorderTab(draggedTab, tab.path)
                  }}
                  className={clsx(
                    'group flex items-center gap-2 px-3 text-xs cursor-pointer border-r border-fleet-border shrink-0 max-w-[200px]',
                    tabs.activeTabPath === tab.path
                      ? 'bg-fleet-bg text-fleet-textHover'
                      : 'text-gray-400 hover:bg-fleet-active hover:text-gray-200',
                    dragOverTab === tab.path && 'bg-blue-500/20',
                    draggedTab === tab.path && 'opacity-40'
                  )}
                >
                  <span className="truncate">{tab.path.split('/').pop()}</span>
                  {!tab.isSaved && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  )}
                  {tab.pinned ? (
                    <Pin
                      size={12}
                      className="opacity-70 hover:opacity-100 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        tabs.togglePin(tab.path)
                      }}
                    />
                  ) : (
                    <PinOff
                      size={12}
                      className="opacity-0 group-hover:opacity-50 hover:!opacity-100 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        tabs.togglePin(tab.path)
                      }}
                    />
                  )}
                  <X
                    size={12}
                    className="opacity-50 hover:opacity-100 shrink-0"
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (tab.pinned && !(await confirmDialog('This tab is pinned. Close anyway?')))
                        return
                      tabs.closeTab(tab.path)
                    }}
                  />
                </div>
              ))}
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

          <div className="flex-1 overflow-hidden">
            {tabs.selectedPath ? (
              tabs.showMarkdownPreview && tabs.selectedPath.endsWith('.md') ? (
                <MarkdownPreview content={tabs.fileContent} />
              ) : (
                <Editor
                  height="100%"
                  path={tabs.selectedPath}
                  language={getLanguage(tabs.selectedPath)}
                  theme={isDark ? 'vs-dark' : 'vs'}
                  value={tabs.fileContent}
                  onChange={tabs.handleEditorChange}
                  onMount={tabs.handleEditorDidMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: density.editorFontSize,
                    wordWrap: 'on',
                    padding: { top: 16 },
                    scrollBeyondLastLine: false
                  }}
                />
              )
            ) : (
              <div className="flex-1 h-full flex items-center justify-center text-gray-500 flex-col gap-4">
                <span className="text-4xl text-gray-700">Aura Editor</span>
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
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          className={clsx(
            'w-64 bg-fleet-sidebar flex flex-col shrink-0 border-fleet-border',
            settings.sidebarPosition === 'left' ? 'order-1 border-r' : 'border-l'
          )}
        >
          {git.repos.length > 0 && (
            <div className="flex border-b border-fleet-border shrink-0 text-xs">
              <button
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5',
                  sidebarView === 'files'
                    ? 'text-fleet-textHover bg-fleet-active'
                    : 'text-gray-400 hover:text-gray-200'
                )}
                onClick={() => setSidebarView('files')}
              >
                <Files size={12} /> Files
              </button>
              <button
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5',
                  sidebarView === 'git'
                    ? 'text-fleet-textHover bg-fleet-active'
                    : 'text-gray-400 hover:text-gray-200'
                )}
                onClick={() => setSidebarView('git')}
              >
                <GitBranch size={12} /> Git
              </button>
            </div>
          )}
          <div ref={sidebarRef} className="flex-1 overflow-y-auto overflow-x-hidden p-2 pt-3">
            {sidebarView === 'git' && git.repos.length > 0 ? (
              <GitPanel
                repos={git.repos}
                isDark={isDark}
                onStage={git.stage}
                onUnstage={git.unstage}
                onCommit={git.commit}
                onPush={git.push}
                onPull={git.pull}
                onDiff={git.diff}
              />
            ) : tree.rootNodes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {tree.rootNodes.map((rootNode) => (
                  <FileTree
                    key={rootNode.path}
                    node={rootNode}
                    onSelect={tabs.openTab}
                    onContextMenu={tree.handleContextMenu}
                    onCreateNew={tree.startCreate}
                    onMove={tree.handleMove}
                    onFocusNode={tree.handleFocusNode}
                    onRunPython={runPython}
                    onPreviewMarkdown={previewMarkdown}
                    selectedPath={tabs.selectedPath}
                    revealPath={tree.revealPath}
                    rowPadding={density.treeRowPadding}
                    gitStatus={git.fileStates}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center mt-10 text-gray-500 text-sm p-4">No folder opened.</div>
            )}
          </div>
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
        <div
          className="fixed bg-fleet-sidebar border border-fleet-border shadow-lg rounded py-1 z-50 text-sm text-gray-300 flex flex-col min-w-[160px]"
          style={{ top: tree.contextMenu.y, left: tree.contextMenu.x }}
        >
          {tree.contextMenu.node.path.endsWith('.py') && (
            <button
              className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
              onClick={() => runPython(tree.contextMenu!.node)}
            >
              Run Script
            </button>
          )}
          <button
            className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
            onClick={() => openTerminalHere(tree.contextMenu!.node)}
          >
            Open Terminal
          </button>
          <button
            className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
            onClick={() => tree.startCreate(tree.contextMenu!.node, 'file')}
          >
            New File
          </button>
          <button
            className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
            onClick={() => tree.startCreate(tree.contextMenu!.node, 'directory')}
          >
            New Folder
          </button>
          <button
            className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
            onClick={() => tree.startRename(tree.contextMenu!.node)}
          >
            Rename
          </button>
          <div className="h-px bg-fleet-border my-1" />
          <button
            className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
            onClick={() => {
              tree.setClipboard({ path: tree.contextMenu!.node.path })
              tree.setContextMenu(null)
            }}
          >
            Copy
          </button>
          {tree.clipboard && (
            <button
              className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
              onClick={() => tree.pasteIntoNode(tree.contextMenu!.node)}
            >
              Paste
            </button>
          )}
          {!tree.contextMenu.node.isRoot && (
            <button
              className="px-4 py-1.5 text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors"
              onClick={() => tree.deleteNode(tree.contextMenu!.node)}
            >
              Delete
            </button>
          )}
          {tree.contextMenu.node.isRoot && (
            <>
              <div className="h-px bg-fleet-border my-1" />
              <button
                className="px-4 py-1.5 text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                onClick={() => tree.handleRemoveFolder(tree.contextMenu!.node.path)}
              >
                Remove from Workspace
              </button>
            </>
          )}
        </div>
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
        <Modal onClose={() => setShowSettings(false)} width="w-[30rem]">
          <div
            className={clsx(density.settingsLabelClass, 'font-medium text-fleet-textHover mb-3')}
          >
            Settings
          </div>
          <div className="flex flex-col gap-4">
            <SettingToggle
              label="Tabs"
              description="Keep multiple files open at once"
              checked={settings.tabsEnabled}
              onChange={(v) => updateSetting('tabsEnabled', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingToggle
              label="Autosave"
              description="Save automatically a moment after you stop typing"
              checked={settings.autosaveEnabled}
              onChange={(v) => updateSetting('autosaveEnabled', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingSelect
              label="Mode"
              description="UI density - editor font size, row height, spacing"
              value={settings.uiMode}
              options={UI_MODES}
              onChange={(v) => updateSetting('uiMode', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingSelect
              label="Sidebar"
              description="Which side the file tree/git panel sits on"
              value={settings.sidebarPosition}
              options={SIDEBAR_POSITIONS}
              onChange={(v) => updateSetting('sidebarPosition', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingToggle
              label="Git"
              description="Show git status badges and the Git panel for repositories"
              checked={settings.gitEnabled}
              onChange={(v) => updateSetting('gitEnabled', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
            <SettingToggle
              label="Diagnostics"
              description="Inline error checking for TypeScript, JavaScript and Python"
              checked={settings.diagnosticsEnabled}
              onChange={(v) => updateSetting('diagnosticsEnabled', v)}
              labelClassName={density.settingsLabelClass}
              descriptionClassName={density.settingsDescriptionClass}
            />
          </div>

          <div className="border-t border-fleet-border mt-4 pt-3">
            <div
              className={clsx(density.settingsLabelClass, 'font-medium text-fleet-textHover mb-2')}
            >
              Shortcuts
            </div>
            <div className="flex flex-col gap-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.description} className="flex items-center justify-between gap-3">
                  <span className={clsx(density.settingsDescriptionClass, 'text-gray-400')}>
                    {s.description}
                  </span>
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-fleet-bg border border-fleet-border text-gray-300 font-mono shrink-0">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <button
              className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
              onClick={() => setShowSettings(false)}
            >
              Done
            </button>
          </div>
        </Modal>
      )}

      <DialogHost />
    </div>
  )
}

export default App
