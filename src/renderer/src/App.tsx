import React, { useState, useEffect, useRef } from 'react';
import { FileTree, FileNode } from './components/FileTree';
import { Terminal } from './components/Terminal';
import { GlobalSearch } from './components/GlobalSearch';
import { FileSearch } from './components/FileSearch';
import Editor from '@monaco-editor/react';
import { FolderOpen, X, Terminal as TerminalIcon, Save, Plus, Play, AlignLeft, Search } from 'lucide-react';

type TerminalTab = { id: string; name: string };

function App() {
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(256);
  const [isResizing, setIsResizing] = useState(false);
  const [isSaved, setIsSaved] = useState(true);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [jumpToLine, setJumpToLine] = useState<number | null>(null);

  // Terminals state
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const editorRef = useRef<any>(null);
  const lastShiftTime = useRef<number>(0);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load workspaces on mount
    window.api.getWorkspaces().then(trees => {
      setRootNodes(trees || []);
    });
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

  const handleFileSelect = async (path: string, line?: number) => {
    if (line) setJumpToLine(line);

    if (selectedPath === path && line) {
      scrollToLine(line);
      setShowSearch(false);
      setShowFileSearch(false);
      return;
    }

    setSelectedPath(path);
    const result = await window.api.readFile(path);
    if (result.success) {
      setFileContent(result.content || '');
      setIsSaved(true);
      setShowSearch(false);
      setShowFileSearch(false);
    } else {
      console.error(result.error);
    }
  };

  const scrollToLine = (line: number) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: 1 });
      editorRef.current.focus();
    }
  };

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    if (jumpToLine) {
      scrollToLine(jumpToLine);
      setJumpToLine(null);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setFileContent(value);
      setIsSaved(false);
    }
  };

  const handleSave = async () => {
    if (selectedPath && !isSaved) {
      const result = await window.api.saveFile(selectedPath, fileContent);
      if (result.success) setIsSaved(true);
    }
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
      if ((e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') || (e.shiftKey && e.key === 'F' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')) {
        // Only trigger Shift+F if not in an input field (to avoid interference with typing)
        // Standard IDEs use Shift+Cmd+F for global search.
        if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          setShowSearch(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPath, fileContent, isSaved]);

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

    if (selectedPath === node.path) {
      setSelectedPath(result.newPath);
    } else if (node.type === 'directory' && selectedPath?.startsWith(node.path + '/')) {
      setSelectedPath(result.newPath + selectedPath.slice(node.path.length));
    }
  };

  const handleFormatJson = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(fileContent), null, 2);
      setFileContent(formatted);
      setIsSaved(false);
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
          <button onClick={() => setShowSearch(true)} className="p-1.5 rounded hover:bg-fleet-active transition-colors text-gray-400 hover:text-white" title="Global Search (Shift+Cmd+F)">
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
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex-1 overflow-hidden">
            {selectedPath ? (
              <Editor
                height="100%"
                language={getLanguage(selectedPath)}
                theme="vs-dark"
                value={fileContent}
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on', padding: { top: 16 }, scrollBeyondLastLine: false }}
              />
            ) : (
              <div className="flex-1 h-full flex items-center justify-center text-gray-500 flex-col gap-4">
                <span className="text-4xl text-gray-700">Aura Editor</span>
                <span>Double-Shift to search files</span>
              </div>
            )}
          </div>

          {showTerminal && terminals.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 border-t border-fleet-border flex flex-col bg-fleet-sidebar z-30 shadow-2xl" style={{ height: `${terminalHeight}px` }}>
              <div className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-blue-500/50 transition-colors z-40" onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }} />
              <div className="flex items-center border-b border-fleet-border bg-fleet-header px-2 overflow-x-auto shrink-0">
                {terminals.map(term => (
                  <div key={term.id} onClick={() => setActiveTermId(term.id)} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-fleet-border ${activeTermId === term.id ? 'bg-fleet-active text-white' : 'text-gray-400 hover:bg-fleet-active hover:text-gray-200'}`}>
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
                    <Terminal termId={term.id} isActive={activeTermId === term.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-64 bg-fleet-sidebar flex flex-col shrink-0 border-l border-fleet-border">
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 pt-3">
            {rootNodes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {rootNodes.map(rootNode => (
                  <FileTree key={rootNode.path} node={rootNode} onSelect={handleFileSelect} onContextMenu={handleContextMenu} selectedPath={selectedPath} />
                ))}
              </div>
            ) : (
              <div className="text-center mt-10 text-gray-500 text-sm p-4">No folder opened.</div>
            )}
          </div>
        </div>
      </div>

      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} onSelect={handleFileSelect} />}
      {showFileSearch && <FileSearch onClose={() => setShowFileSearch(false)} onSelect={handleFileSelect} />}

      {contextMenu && (
        <div className="fixed bg-fleet-sidebar border border-fleet-border shadow-lg rounded py-1 z-50 text-sm text-gray-300 flex flex-col min-w-[160px]" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.node.path.endsWith('.py') && <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => runPython(contextMenu.node)}>Run Script</button>}
          <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => openTerminalHere(contextMenu.node)}>Open Terminal</button>
          <button className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white" onClick={() => startRename(contextMenu.node)}>Rename</button>
          {(contextMenu.node as any).isRoot && (
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
    </div>
  );
}

export default App;
