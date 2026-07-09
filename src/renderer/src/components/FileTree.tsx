import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileJson, FileType2, FileCode2, FileText, File, FilePlus, FolderPlus } from 'lucide-react';
import clsx from 'clsx';

export type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  isRoot?: boolean;
};

interface FileTreeProps {
  node: FileNode;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onCreateNew: (node: FileNode, type: 'file' | 'directory') => void;
  onMove: (sourcePath: string, targetDirPath: string) => void;
  onFocusNode: (node: FileNode) => void;
  selectedPath: string | null;
  revealPath?: string | null;
  rowPadding?: string;
  level?: number;
}

export const DRAG_PATH_MIME = 'application/x-aura-path';

const getIcon = (name: string, type: 'file' | 'directory', expanded: boolean) => {
  if (type === 'directory') {
    return expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />;
  }
  
  if (name.endsWith('.json')) return <FileJson size={14} className="text-yellow-500" />;
  if (name.endsWith('.md')) return <FileText size={14} className="text-blue-400" />;
  if (name.endsWith('.py')) return <FileCode2 size={14} className="text-green-500" />;
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return <FileType2 size={14} className="text-blue-400" />;
  if (name.endsWith('.js') || name.endsWith('.jsx')) return <FileType2 size={14} className="text-yellow-400" />;
  
  return <File size={14} className="text-gray-400" />;
};

export const FileTree: React.FC<FileTreeProps> = ({ node, onSelect, onContextMenu, onCreateNew, onMove, onFocusNode, selectedPath, revealPath, rowPadding = 'py-1', level = 0 }) => {
  const [expanded, setExpanded] = useState<boolean>(level === 0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';

  // Auto-expand if the selected/revealed path is this directory or a descendant of it
  useEffect(() => {
    const target = revealPath || selectedPath;
    if (target && isDirectory && (target === node.path || target.startsWith(node.path + '/'))) {
      setExpanded(true);
    }
  }, [revealPath, selectedPath, node.path, isDirectory]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDirectory) {
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onContextMenu(e, node);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData(DRAG_PATH_MIME, node.path);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes(DRAG_PATH_MIME)) {
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isDirectory) return;
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const sourcePath = e.dataTransfer.getData(DRAG_PATH_MIME);
    if (sourcePath) onMove(sourcePath, node.path);
  };

  return (
    <div className="select-none font-sans">
      <div
        className={clsx(
          "group flex items-center px-2 cursor-pointer text-sm hover:bg-fleet-active text-fleet-text hover:text-fleet-textHover transition-colors outline-none focus:ring-1 focus:ring-inset focus:ring-gray-400/60",
          rowPadding,
          isSelected && "bg-fleet-active text-fleet-textHover",
          isDragOver && "bg-blue-500/20 ring-1 ring-inset ring-blue-500",
          isDragging && "opacity-40"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        tabIndex={-1}
        onClick={handleClick}
        onFocus={() => onFocusNode(node)}
        onContextMenu={handleContextMenu}
        draggable={!node.isRoot}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="mr-1.5 opacity-70 flex items-center justify-center w-4 h-4">
          {getIcon(node.name, node.type, expanded)}
        </span>
        <span className="truncate flex-1">{node.name}</span>
        {isDirectory && (
          <div className="hidden group-hover:flex items-center gap-1 ml-1 shrink-0">
            <button
              className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white"
              title="New File"
              onClick={(e) => { e.stopPropagation(); onCreateNew(node, 'file'); }}
            >
              <FilePlus size={13} />
            </button>
            <button
              className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white"
              title="New Folder"
              onClick={(e) => { e.stopPropagation(); onCreateNew(node, 'directory'); }}
            >
              <FolderPlus size={13} />
            </button>
          </div>
        )}
      </div>

      {isDirectory && expanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTree
              key={child.path}
              node={child}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onCreateNew={onCreateNew}
              onMove={onMove}
              onFocusNode={onFocusNode}
              selectedPath={selectedPath}
              revealPath={revealPath}
              rowPadding={rowPadding}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
