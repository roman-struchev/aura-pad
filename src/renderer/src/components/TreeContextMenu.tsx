import React from 'react'
import type { FileNode } from './FileTree'

interface TreeContextMenuProps {
  x: number
  y: number
  node: FileNode
  hasClipboard: boolean
  onClose: () => void
  onOpenTerminalHere: (node: FileNode) => void
  onCreateNew: (node: FileNode, type: 'file' | 'directory') => void
  onRename: (node: FileNode) => void
  onCopy: (node: FileNode) => void
  onPaste: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  onRemoveFolder: (path: string) => void
}

// Every action closes the menu afterwards (via onClose), so callers don't
// each need to remember to do it themselves.
export const TreeContextMenu: React.FC<TreeContextMenuProps> = ({
  x,
  y,
  node,
  hasClipboard,
  onClose,
  onOpenTerminalHere,
  onCreateNew,
  onRename,
  onCopy,
  onPaste,
  onDelete,
  onRemoveFolder
}) => {
  const run = (action: () => void): void => {
    action()
    onClose()
  }

  return (
    <div
      className="fixed bg-fleet-sidebar border border-fleet-border shadow-lg rounded py-1 z-50 text-sm text-gray-300 flex flex-col min-w-[160px]"
      style={{ top: y, left: x }}
    >
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(() => onOpenTerminalHere(node))}
      >
        Open Terminal
      </button>
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(() => onCreateNew(node, 'file'))}
      >
        New File
      </button>
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(() => onCreateNew(node, 'directory'))}
      >
        New Folder
      </button>
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(() => onRename(node))}
      >
        Rename
      </button>
      <div className="h-px bg-fleet-border my-1" />
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(() => onCopy(node))}
      >
        Copy
      </button>
      {hasClipboard && (
        <button
          className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
          onClick={() => run(() => onPaste(node))}
        >
          Paste
        </button>
      )}
      {!node.isRoot && (
        <button
          className="px-4 py-1.5 text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors"
          onClick={() => run(() => onDelete(node))}
        >
          Delete
        </button>
      )}
      {node.isRoot && (
        <>
          <div className="h-px bg-fleet-border my-1" />
          <button
            className="px-4 py-1.5 text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors"
            onClick={() => run(() => onRemoveFolder(node.path))}
          >
            Remove from Workspace
          </button>
        </>
      )}
    </div>
  )
}
