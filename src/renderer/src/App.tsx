import React, { useState, useEffect, useRef } from 'react';
import { FileTree, FileNode } from './components/FileTree';
import { Terminal } from './components/Terminal';
import { GlobalSearch } from './components/GlobalSearch';
import { FileSearch } from './components/FileSearch';
import { MarkdownPreview } from './components/MarkdownPreview';
import { SettingToggle } from './components/SettingToggle';
import { DENSITY, UI_MODES, UiMode } from './density';
import Editor from '@monaco-editor/react';
import clsx from 'clsx';
import { FolderOpen, X, Terminal as TerminalIcon, Save, Plus, Play, AlignLeft, Search, Eye, Code2, Settings as SettingsIcon } from 'lucide-react';

type TerminalTab = { id: string; name: string };

type OpenTab = {
  path: string;
  content: string;
  isSaved: boolean;
  externalChangeAvailable: boolean;
  showPreview: boolean;
};

type AppSettings = {
  tabsEnabled: boolean;
  autosaveEnabled: boolean;
  uiMode: UiMode;
};

const DEFAULT_SETTINGS: AppSettings = {
  tabsEnabled: true,
  autosaveEnabled: true,
  uiMode: 'compact'
};

function App() {
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(256);
  const [isResizing, setIsResizing] = useState(false);

  // Open files, tab-bar style
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // Settings (persisted, toggle features on/off)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);

  // Terminals state
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // New file/folder dialog state
  const [createTarget, setCreateTarget] = useState<{ parentPath: string; type: 'file' | 'directory' } | null>(null);
  const [createValue, setCreateValue] = useState('');
  const [revealPath, setRevealPath] = useState<string | null>(null);

  // Tree focus / copy-paste / delete state
  const [focusedNode, setFocusedNode] = useState<FileNode | null>(null);
  const [clipboard, setClipboard] = useState<{ path: string } | null>(null);

  // Theme (follows the OS light/dark setting)
  const [isDark, setIsDark] = useState(true);

  // Derived from the active tab
  const activeTab = tabs.find(t => t.path === activeTabPath) ?? null;
  const selectedPath = activeTab?.path ?? null;
  const fileContent = activeTab?.content ?? '';
  const isSaved = activeTab?.isSaved ?? true;
  const externalChangeAvailable = activeTab?.externalChangeAvailable ?? false;
  const showMarkdownPreview = activeTab?.showPreview ?? false;
  const density = DENSITY[settings.uiMode];

  const editorRef = useRef<any>(null);
  const lastShiftTime = useRef<number>(0);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<OpenTab[]>([]);
  const pendingJumpLine = useRef<number | null>(null);

  const updateTab = (path: string, patch: Partial<OpenTab>) => {
    setTabs(prev => prev.map(t => (t.path === path ? { ...t, ...patch } : t)));
  };

  useEffect(() => {
    // Load workspaces on mount
    window.api.getWorkspaces().then(trees => {
      setRootNodes(trees || []);
    });

    const unsubscribeWorkspaces = window.api.onWorkspacesChanged((trees) => {
      setRootNodes(trees || []);
    });

    window.api.getTheme().then(setIsDark);
    const unsubscribeTheme = window.api.onThemeUpdated(setIsDark);

    window.api.getSettings().then(setSettings);

    return () => {
      unsubscribeWorkspaces();
      unsubscribeTheme();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Monaco's built-in widgets (e.g. the Find/Replace bar's icon buttons) use
  // native title="" attributes, which pop up an OS-style tooltip that clashes
  // with the app's look. Some of those widgets render in an overlay layer
  // outside the specific editor instance's own DOM node, so watch the whole
  // document - but scope the selector to Monaco's own elements only, so this
  // never touches our own toolbar buttons' tooltips. Keep an aria-label so
  // screen readers still get the same text.
  useEffect(() => {
    const MONACO_TITLE_SELECTOR = '.monaco-editor[title], .monaco-editor [title]';
    const stripTitles = () => {
      document.querySelectorAll(MONACO_TITLE_SELECTOR).forEach((el) => {
        const title = el.getAttribute('title');
        if (title && !el.getAttribute('aria-label')) el.setAttribute('aria-label', title);
        el.removeAttribute('title');
      });
    };
    stripTitles();
    const observer = new MutationObserver(stripTitles);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    return () => observer.disconnect();
  }, []);

  const handleAddFolder = async () => {
    const trees = await window.api.addWorkspace();
    if (trees) setRootNodes(trees);
  };

  const handleRemoveFolder = async (path: string) => {
    const trees = await window.api.removeWorkspace(path);
    setRootNodes(trees || []);
    setContextMenu(null);
  };

  const scrollToLine = (line: number) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: 1 });
      editorRef.current.focus();
    }
  };

  const openTab = async (filePath: string, line?: number) => {
    const existing = tabs.find(t => t.path === filePath);

    if (existing) {
      setActiveTabPath(filePath);
      if (line) pendingJumpLine.current = line;
      setShowSearch(false);
      setShowFileSearch(false);
      return;
    }

    const result = await window.api.readFile(filePath);
    if (!result.success) {
      console.error(result.error);
      return;
    }

    const newTab: OpenTab = {
      path: filePath,
      content: result.content || '',
      isSaved: true,
      externalChangeAvailable: false,
      showPreview: false
    };

    setTabs(prev => (settings.tabsEnabled ? [...prev, newTab] : [newTab]));
    setActiveTabPath(filePath);
    if (line) pendingJumpLine.current = line;
    setShowSearch(false);
    setShowFileSearch(false);
  };

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeTabPath) {
      updateTab(activeTabPath, { content: value, isSaved: false });
    }
  };

  const handleSave = async () => {
    if (!activeTab || activeTab.isSaved) return;
    const result = await window.api.saveFile(activeTab.path, activeTab.content);
    if (result.success) updateTab(activeTab.path, { isSaved: true });
  };

  const closeTab = (path: string) => {
    const tab = tabs.find(t => t.path === path);
    if (!tab) return;
    if (!tab.isSaved && !window.confirm('You have unsaved changes. Close without saving?')) return;

    const idx = tabs.findIndex(t => t.path === path);
    const filtered = tabs.filter(t => t.path !== path);
    setTabs(filtered);

    if (activeTabPath === path) {
      const next = filtered[idx] ?? filtered[idx - 1] ?? null;
      setActiveTabPath(next ? next.path : null);
    }
    pendingJumpLine.current = null;
  };

  const handleCloseFile = () => {
    if (!activeTabPath) return;
    closeTab(activeTabPath);
  };

  const reloadFromDisk = async () => {
    if (!activeTabPath) return;
    const result = await window.api.readFile(activeTabPath);
    if (result.success) {
      updateTab(activeTabPath, { content: result.content || '', isSaved: true, externalChangeAvailable: false });
    } else {
      updateTab(activeTabPath, { externalChangeAvailable: false });
    }
  };

  const remapTabPaths = (oldPath: string, newPath: string) => {
    setTabs(prev => prev.map(t => {
      if (t.path === oldPath) return { ...t, path: newPath };
      if (t.path.startsWith(oldPath + '/')) return { ...t, path: newPath + t.path.slice(oldPath.length) };
      return t;
    }));
    setActiveTabPath(prev => {
      if (!prev) return prev;
      if (prev === oldPath) return newPath;
      if (prev.startsWith(oldPath + '/')) return newPath + prev.slice(oldPath.length);
      return prev;
    });
  };

  const pasteIntoNode = async (node: FileNode) => {
    if (!clipboard) return;
    const destDir = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    const result = await window.api.copyPath(clipboard.path, destDir);
    setContextMenu(null);
    if (!result.success || !result.newPath) {
      if (result.error) alert(result.error);
      return;
    }
    setRootNodes(result.trees || []);
    setRevealPath(destDir);
  };

  const deleteNode = async (node: FileNode) => {
    if (!window.confirm(`Move "${node.name}" to Trash?`)) return;
    const result = await window.api.deletePath(node.path);
    setContextMenu(null);
    if (!result.success) {
      if (result.error) alert(result.error);
      return;
    }
    setRootNodes(result.trees || []);

    const isAffected = (p: string) => p === node.path || (node.type === 'directory' && p.startsWith(node.path + '/'));
    const remaining = tabs.filter(t => !isAffected(t.path));
    setTabs(remaining);
    if (activeTabPath && isAffected(activeTabPath)) {
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }

    if (focusedNode?.path === node.path) setFocusedNode(null);
    if (clipboard?.path === node.path) setClipboard(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Double Shift detection
      if (e.key === 'Shift') {
        const now = Date.now();
        if (now - lastShiftTime.current < 300) {
          setShowFileSearch(true);
          lastShiftTime.current = 0;
        } else {
          lastShiftTime.current = now;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        handleCloseFile();
      }
      if ((e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') || (e.shiftKey && e.key === 'F' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')) {
        // Only trigger Shift+F if not in an input field (to avoid interference with typing)
        // Standard IDEs use Shift+Cmd+F for global search.
        if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          setShowSearch(true);
        }
      }

      // Copy/paste/delete for the file tree - only when a tree row actually
      // has focus, so this never steals Cmd+C/V from the editor or terminal.
      const isTreeFocused = !!sidebarRef.current?.contains(document.activeElement);
      if (isTreeFocused && focusedNode) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          setClipboard({ path: focusedNode.path });
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboard) {
          e.preventDefault();
          pasteIntoNode(focusedNode);
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !focusedNode.isRoot) {
          e.preventDefault();
          deleteNode(focusedNode);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabPath, focusedNode, clipboard]);

  // Autosave: after a short pause in typing, save automatically (unless disabled in Settings).
  useEffect(() => {
    if (!settings.autosaveEnabled) return;
    if (!activeTabPath || isSaved || externalChangeAvailable) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 1200);
    return () => clearTimeout(timer);
  }, [fileContent, activeTabPath, isSaved, externalChangeAvailable, settings.autosaveEnabled]);

  // React to a file changing on disk from outside the app (another editor,
  // git, another window of this app). If we have no local edits it's safe to
  // just reload; otherwise flag it and surface a banner instead of clobbering
  // the user's in-progress changes.
  useEffect(() => {
    const unsubscribe = window.api.onFileChangedExternally(async (changedPath) => {
      const tab = tabsRef.current.find(t => t.path === changedPath);
      if (!tab) return;
      if (tab.isSaved) {
        const result = await window.api.readFile(changedPath);
        if (result.success) updateTab(changedPath, { content: result.content || '', isSaved: true });
      } else {
        updateTab(changedPath, { externalChangeAvailable: true });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight > 150 && newHeight < window.innerHeight * 0.9) {
        setTerminalHeight(newHeight);
      }
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
    } else {
      document.body.style.cursor = '';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (renameTarget) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renameTarget]);

  useEffect(() => {
    if (createTarget) {
      createInputRef.current?.focus();
    }
  }, [createTarget]);

  // Jump to a specific line once the editor is showing the right content,
  // whether that's from opening a search result or switching tabs. Uses a
  // ref (not state) for the pending line so consuming it doesn't itself
  // trigger a state update from inside this effect.
  useEffect(() => {
    if (pendingJumpLine.current !== null) {
      scrollToLine(pendingJumpLine.current);
      pendingJumpLine.current = null;
    }
  }, [fileContent]);

  const openNewTerminal = async (cwd?: string, runCommand?: string) => {
    setShowTerminal(true);
    const termId = await window.api.createPty(cwd);
    setTerminals(prev => [...prev, { id: termId, name: `Terminal ${prev.length + 1}` }]);
    setActiveTermId(termId);
    if (runCommand) {
      setTimeout(() => {
        window.api.ptyWrite(termId, runCommand + '\r');
      }, 600);
    }
  };

  const closeTerminal = (termId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.api.destroyPty(termId);
    setTerminals(prev => {
      const filtered = prev.filter(t => t.id !== termId);
      if (activeTermId === termId) {
        setActiveTermId(filtered.length > 0 ? filtered[filtered.length - 1].id : null);
      }
      if (filtered.length === 0) setShowTerminal(false);
      return filtered;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    setContextMenu({ x: e.pageX, y: e.pageY, node });
  };

  const runPython = (node: FileNode) => {
    const cwd = node.path.substring(0, node.path.lastIndexOf('/'));
    openNewTerminal(cwd, `python3 "${node.path}"`);
    setContextMenu(null);
  };

  const openTerminalHere = (node: FileNode) => {
    const cwd = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    openNewTerminal(cwd);
    setContextMenu(null);
  };

  const startRename = (node: FileNode) => {
    setContextMenu(null);
    setRenameValue(node.name);
    setRenameTarget(node);
  };

  const confirmRename = async () => {
    const node = renameTarget;
    if (!node) return;
    const newName = renameValue.trim();
    setRenameTarget(null);
    if (!newName || newName === node.name) return;

    const result = await window.api.renamePath(node.path, newName);
    if (!result.success || !result.newPath) {
      alert(result.error || 'Failed to rename.');
      return;
    }
    setRootNodes(result.trees || []);
    remapTabPaths(node.path, result.newPath);
    setFocusedNode(null);
    setClipboard(null);
  };

  const startCreate = (node: FileNode, type: 'file' | 'directory') => {
    const parentPath = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    setContextMenu(null);
    setCreateValue('');
    setCreateTarget({ parentPath, type });
  };

  const confirmCreate = async () => {
    const target = createTarget;
    if (!target) return;
    const name = createValue.trim();
    setCreateTarget(null);
    if (!name) return;

    const result = await window.api.createPath(target.parentPath, name, target.type);
    if (!result.success || !result.newPath) {
      alert(result.error || 'Failed to create.');
      return;
    }
    setRootNodes(result.trees || []);
    setRevealPath(target.parentPath);
    if (target.type === 'file') {
      openTab(result.newPath);
    }
  };

  const handleMove = async (sourcePath: string, targetDirPath: string) => {
    if (sourcePath === targetDirPath) return;
    const result = await window.api.movePath(sourcePath, targetDirPath);
    if (!result.success || !result.newPath) {
      if (result.error) alert(result.error);
      return;
    }
    setRootNodes(result.trees || []);
    setRevealPath(targetDirPath);
    remapTabPaths(sourcePath, result.newPath);
    setFocusedNode(null);
    setClipboard(null);
  };

  const handleFocusNode = (node: FileNode) => {
    setFocusedNode(node);
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      window.api.saveSettings(next);
      return next;
    });
  };

  const handleFormatJson = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(fileContent), null, 2);
      if (activeTabPath) updateTab(activeTabPath, { content: formatted, isSaved: false });
    } catch (e) {
      alert('Invalid JSON format.');
    }
  };

  const handleRunCurrentPython = () => {
    if (selectedPath) {
      const cwd = selectedPath.substring(0, selectedPath.lastIndexOf('/'));
      openNewTerminal(cwd, `python3 "${selectedPath}"`);
    }
  };

  const getLanguage = (path: string) => {
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    return 'plaintext';
  };

  return (
    <div className="flex h-screen bg-fleet-bg text-fleet-text flex-col relative overflow-hidden">
      <div className="h-10 border-b border-fleet-border flex items-center justify-between px-4 bg-fleet-header select-none drag-region shrink-0">
        <div className="ml-24 font-medium text-xs text-gray-400 flex items-center gap-2 truncate max-w-[50%]">
          {selectedPath ? selectedPath.split('/').pop() : 'Aura Editor'}
          {!isSaved && selectedPath && <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>}
        </div>
        <div className="flex items-center gap-1 no-drag-region">
          <button onClick={() => setShowSearch(true)} className="p-1.5 rounded hover:bg-fleet-active transition-colors text-gray-400 hover:text-white" aria-label="Global Search (Shift+Cmd+F)">
            <Search size={16} />
          </button>
          <button onClick={handleAddFolder} className="p-1.5 rounded hover:bg-fleet-active transition-colors text-gray-400 hover:text-white" title="Add Folder">
            <FolderOpen size={16} />
          </button>
          <div className="w-px h-4 bg-fleet-border mx-1" />
          {selectedPath?.endsWith('.py') && (
            <button onClick={handleRunCurrentPython} className="p-1.5 rounded hover:bg-fleet-active transition-colors text-green-500" title="Run Python">
              <Play size={16} />
            </button>
          )}
          {selectedPath?.endsWith('.json') && (
            <button onClick={handleFormatJson} className="p-1.5 rounded hover:bg-fleet-active transition-colors text-yellow-500" title="Format JSON">
              <AlignLeft size={16} />
            </button>
          )}
          {selectedPath?.endsWith('.md') && (
            <button
              onClick={() => activeTabPath && updateTab(activeTabPath, { showPreview: !showMarkdownPreview })}
              className={`p-1.5 rounded hover:bg-fleet-active transition-colors ${showMarkdownPreview ? 'text-white bg-fleet-active' : 'text-gray-400'}`}
              title={showMarkdownPreview ? 'Show Source' : 'Show Preview'}
            >
              {showMarkdownPreview ? <Code2 size={16} /> : <Eye size={16} />}
            </button>
          )}
          <button onClick={handleSave} disabled={isSaved || !selectedPath} className={`p-1.5 rounded hover:bg-fleet-active transition-colors ${!isSaved ? 'text-blue-400' : 'text-gray-500'}`} title="Save (Cmd+S)">
            <Save size={16} />
          </button>
          <button
            onClick={() => { if (!showTerminal && terminals.length === 0) openNewTerminal(); else setShowTerminal(!showTerminal); }}
            className={`p-1.5 rounded hover:bg-fleet-active transition-colors ${showTerminal ? 'text-white bg-fleet-active' : 'text-gray-400'}`}
            title="Toggle Terminal"
          >
            <TerminalIcon size={16} />
          </button>
          <button onClick={() => setShowSettings(true)} className="p-1.5 rounded hover:bg-fleet-active transition-colors text-gray-400 hover:text-white" title="Settings">
            <SettingsIcon size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-w-0 relative">
          {settings.tabsEnabled && tabs.length > 0 && (
            <div className={clsx('flex items-stretch border-b border-fleet-border overflow-x-auto shrink-0 bg-fleet-header', density.tabBarHeight)}>
              {tabs.map(tab => (
                <div
                  key={tab.path}
                  onClick={() => setActiveTabPath(tab.path)}
                  className={clsx(
                    'flex items-center gap-2 px-3 text-xs cursor-pointer border-r border-fleet-border shrink-0 max-w-[200px]',
                    activeTabPath === tab.path ? 'bg-fleet-bg text-fleet-textHover' : 'text-gray-400 hover:bg-fleet-active hover:text-gray-200'
                  )}
                >
                  <span className="truncate">{tab.path.split('/').pop()}</span>
                  {!tab.isSaved && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                  <X
                    size={12}
                    className="opacity-50 hover:opacity-100 shrink-0"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                  />
                </div>
              ))}
            </div>
          )}

          {externalChangeAvailable && (
            <div className="flex items-center justify-between gap-2 bg-yellow-900/90 text-yellow-100 text-xs px-3 py-1.5 shrink-0">
              <span>This file changed on disk.</span>
              <div className="flex items-center gap-3">
                <button className="underline hover:text-white" onClick={reloadFromDisk}>Reload</button>
                <button className="underline hover:text-white" onClick={() => activeTabPath && updateTab(activeTabPath, { externalChangeAvailable: false })}>Ignore</button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {selectedPath ? (
              showMarkdownPreview && selectedPath.endsWith('.md') ? (
                <MarkdownPreview content={fileContent} />
              ) : (
                <Editor
                  height="100%"
                  language={getLanguage(selectedPath)}
                  theme={isDark ? 'vs-dark' : 'vs'}
                  value={fileContent}
                  onChange={handleEditorChange}
                  onMount={handleEditorDidMount}
                  options={{ minimap: { enabled: false }, fontSize: density.editorFontSize, wordWrap: 'on', padding: { top: 16 }, scrollBeyondLastLine: false }}
                />
              )
            ) : (
              <div className="flex-1 h-full flex items-center justify-center text-gray-500 flex-col gap-4">
                <span className="text-4xl text-gray-700">Aura Editor</span>
                <span>Double-Shift to search files</span>
              </div>
            )}
          </div>

          {showTerminal && terminals.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 border-t border-[#323232] flex flex-col bg-[#1e1e1e] z-30 shadow-2xl" style={{ height: `${terminalHeight}px` }}>
              <div className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-blue-500/50 transition-colors z-40" onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }} />
              <div className="flex items-center border-b border-[#323232] bg-[#252525] px-2 overflow-x-auto shrink-0">
                {terminals.map(term => (
                  <div key={term.id} onClick={() => setActiveTermId(term.id)} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-[#323232] ${activeTermId === term.id ? 'bg-[#2d2d2d] text-white' : 'text-gray-400 hover:bg-[#2d2d2d] hover:text-gray-200'}`}>
                    <span>{term.name}</span>
                    <X size={12} className="opacity-50 hover:opacity-100" onClick={(e) => closeTerminal(term.id, e)} />
                  </div>
                ))}
                <button onClick={() => openNewTerminal()} className="p-1.5 text-gray-400 hover:text-white mx-1"><Plus size={14} /></button>
                <div className="flex-1" />
                <button onClick={() => setShowTerminal(false)} className="p-1.5 text-gray-400 hover:text-white"><X size={14} /></button>
              </div>
              <div className="flex-1 overflow-hidden relative bg-[#181818]">
                {terminals.map(term => (
                  <div key={term.id} className="absolute inset-0" style={{ zIndex: activeTermId === term.id ? 10 : 1, visibility: activeTermId === term.id ? 'visible' : 'hidden' }}>
                    <Terminal termId={term.id} isActive={activeTermId === term.id} fontSize={density.terminalFontSize} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-64 bg-fleet-sidebar flex flex-col shrink-0 border-l border-fleet-border">
          <div ref={sidebarRef} className="flex-1 overflow-y-auto overflow-x-hidden p-2 pt-3">
            {rootNodes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {rootNodes.map(rootNode => (
                  <FileTree
                    key={rootNode.path}
                    node={rootNode}
                    onSelect={openTab}
                    onContextMenu={handleContextMenu}
                    onCreateNew={startCreate}
                    onMove={handleMove}
                    onFocusNode={handleFocusNode}
                    selectedPath={selectedPath}
                    revealPath={revealPath}
                    rowPadding={density.treeRowPadding}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center mt-10 text-gray-500 text-sm p-4">No folder opened.</div>
            )}
          </div>
        </div>
      </div>

      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} onSelect={openTab} />}
      {showFileSearch && <FileSearch onClose={() => setShowFileSearch(false)} onSelect={openTab} />}

      {contextMenu && (
        <div className="fixed bg-fleet-sidebar border border-fleet-border shadow-lg rounded py-1 z-50 text-sm text-gray-300 flex flex-col min-w-[160px]" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.node.path.endsWith('.py') && <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => runPython(contextMenu.node)}>Run Script</button>}
          <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => openTerminalHere(contextMenu.node)}>Open Terminal</button>
          <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => startCreate(contextMenu.node, 'file')}>New File</button>
          <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => startCreate(contextMenu.node, 'directory')}>New Folder</button>
          <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => startRename(contextMenu.node)}>Rename</button>
          <div className="h-px bg-fleet-border my-1" />
          <button
            className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
            onClick={() => { setClipboard({ path: contextMenu.node.path }); setContextMenu(null); }}
          >
            Copy
          </button>
          {clipboard && (
            <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => pasteIntoNode(contextMenu.node)}>Paste</button>
          )}
          {!contextMenu.node.isRoot && (
            <button className="px-4 py-1.5 text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors" onClick={() => deleteNode(contextMenu.node)}>Delete</button>
          )}
          {contextMenu.node.isRoot && (
            <>
              <div className="h-px bg-fleet-border my-1" />
              <button className="px-4 py-1.5 text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors" onClick={() => handleRemoveFolder(contextMenu.node.path)}>Remove from Workspace</button>
            </>
          )}
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={() => setRenameTarget(null)}>
          <div className="bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-400 mb-2 truncate">Rename &quot;{renameTarget.name}&quot;</div>
            <input
              ref={renameInputRef}
              className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-sm text-fleet-text outline-none focus:border-blue-500"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') setRenameTarget(null);
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400" onClick={() => setRenameTarget(null)}>Cancel</button>
              <button className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white" onClick={confirmRename}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {createTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={() => setCreateTarget(null)}>
          <div className="bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-400 mb-2 truncate">
              New {createTarget.type === 'directory' ? 'Folder' : 'File'} in &quot;{createTarget.parentPath.split('/').pop()}&quot;
            </div>
            <input
              ref={createInputRef}
              className="w-full bg-fleet-bg border border-fleet-border rounded px-2 py-1.5 text-sm text-fleet-text outline-none focus:border-blue-500"
              value={createValue}
              placeholder={createTarget.type === 'directory' ? 'folder-name' : 'file-name.ts'}
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCreate();
                if (e.key === 'Escape') setCreateTarget(null);
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400" onClick={() => setCreateTarget(null)}>Cancel</button>
              <button className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white" onClick={confirmCreate}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={() => setShowSettings(false)}>
          <div className="bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl p-4 w-96" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium text-fleet-textHover mb-3">Settings</div>
            <div className="flex flex-col gap-4">
              <SettingToggle
                label="Tabs"
                description="Keep multiple files open at once"
                checked={settings.tabsEnabled}
                onChange={(v) => updateSetting('tabsEnabled', v)}
              />
              <SettingToggle
                label="Autosave"
                description="Save automatically a moment after you stop typing"
                checked={settings.autosaveEnabled}
                onChange={(v) => updateSetting('autosaveEnabled', v)}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-fleet-text">Mode</span>
                <span className="text-xs text-gray-500">UI density - editor font size, row height, spacing</span>
                <div className="flex rounded-md overflow-hidden border border-fleet-border mt-1 w-fit">
                  {UI_MODES.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateSetting('uiMode', mode)}
                      className={clsx(
                        'px-3 py-1 text-xs capitalize transition-colors',
                        settings.uiMode === mode ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-fleet-active'
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white" onClick={() => setShowSettings(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
