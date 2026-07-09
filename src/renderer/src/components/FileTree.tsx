import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileJson, FileType2, FileCode2, FileText, File } from 'lucide-react';
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
  selectedPath: string | null;
  level?: number;
}

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

export const FileTree: React.FC<FileTreeProps> = ({ node, onSelect, onContextMenu, selectedPath, level = 0 }) => {
  const [expanded, setExpanded] = useState<boolean>(level === 0);
  const isSelected = selectedPath === node.path;

  // Auto-expand if the selected path is a descendant of this directory
  useEffect(() => {
    if (selectedPath && node.type === 'directory' && selectedPath.startsWith(node.path + '/')) {
      setExpanded(true);
    }
  }, [selectedPath, node.path, node.type]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'directory') {
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

  return (
    <div className="select-none font-sans">
      <div 
        className={clsx(
          "flex items-center py-1 px-2 cursor-pointer text-sm hover:bg-fleet-active text-fleet-text hover:text-fleet-textHover transition-colors",
          isSelected && "bg-fleet-active text-fleet-textHover"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="mr-1.5 opacity-70 flex items-center justify-center w-4 h-4">
          {getIcon(node.name, node.type, expanded)}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      
      {node.type === 'directory' && expanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTree 
              key={child.path} 
              node={child} 
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              selectedPath={selectedPath} 
              level={level + 1} 
            />
          ))}
        </div>
      )}
    </div>
  );
};
