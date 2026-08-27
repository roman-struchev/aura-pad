import React from 'react'
import type { FileNode } from './FileTree'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { relativeToRoot } from '../lib/path'

interface TreeContextMenuProps {
  x: number
  y: number
  // The right-clicked row: the target for the actions that only make sense
  // for one entry (terminal, reveal, create, rename) and the paste target.
  node: FileNode
  // Everything the selection-wide actions (copy, delete) cover. Always
  // contains `node` - right-clicking outside the selection re-selects.
  selectedNodes: FileNode[]
  // Number of files/folders currently on the clipboard (ours or the OS's).
  clipboardCount: number
  // Open workspace roots, for "Copy Relative Path".
  rootPaths: string[]
  onClose: () => void
  onOpenTerminalHere: (node: FileNode) => void
  onCreateNew: (node: FileNode, type: 'file' | 'directory') => void
  onRename: (node: FileNode) => void
  onCopy: () => void
  onPaste: (node: FileNode) => void
  onDelete: () => void
  onRemoveFolder: (path: string) => void
}

const plural = (count: number, noun: string): string => (count === 1 ? noun : `${count} ${noun}s`)

// Every action closes the menu afterwards (via onClose), so callers don't
// each need to remember to do it themselves.
export const TreeContextMenu: React.FC<TreeContextMenuProps> = ({
  x,
  y,
  node,
  selectedNodes,
  clipboardCount,
  rootPaths,
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

  const copyCount = Math.max(selectedNodes.length, 1)
  // The whole selection, one path per line - the shape that pastes straight
  // into a terminal or a commit message.
  const pathsOf = (relative: boolean): string =>
    (selectedNodes.length ? selectedNodes : [node])
      .map((n) => (relative ? relativeToRoot(n.path, rootPaths) : n.path))
      .join('\n')
  // Workspace roots are unlinked via "Remove from Workspace", never trashed.
  const deleteCount = selectedNodes.filter((n) => !n.isRoot).length
  const isMulti = copyCount > 1

  return (
    <ContextMenu x={x} y={y} surface="tree">
      <ContextMenuItem onClick={() => run(() => onOpenTerminalHere(node))}>
        Open Terminal
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(() => window.api.revealInFinder(node.path))}>
        {window.api.platform === 'darwin'
          ? 'Open in Finder'
          : window.api.platform === 'win32'
            ? 'Reveal in File Explorer'
            : 'Reveal in Files'}
      </ContextMenuItem>
      {node.type === 'file' && (
        <ContextMenuItem onClick={() => run(() => void window.api.openInDefaultApp(node.path))}>
          Open in Default App
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => run(() => onCreateNew(node, 'file'))}>
        New File
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(() => onCreateNew(node, 'directory'))}>
        New Folder
      </ContextMenuItem>
      {!isMulti && (
        <ContextMenuItem onClick={() => run(() => onRename(node))}>Rename</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => run(onCopy)}>
        {isMulti ? `Copy ${plural(copyCount, 'Item')}` : 'Copy'}
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => run(() => void navigator.clipboard.writeText(pathsOf(false)))}
      >
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(() => void navigator.clipboard.writeText(pathsOf(true)))}>
        Copy Relative Path
      </ContextMenuItem>
      {clipboardCount > 0 && (
        <ContextMenuItem onClick={() => run(() => onPaste(node))}>
          {clipboardCount > 1 ? `Paste ${plural(clipboardCount, 'Item')}` : 'Paste'}
        </ContextMenuItem>
      )}
      {deleteCount > 0 && (
        <ContextMenuItem danger onClick={() => run(onDelete)}>
          {deleteCount > 1 ? `Delete ${plural(deleteCount, 'Item')}` : 'Delete'}
        </ContextMenuItem>
      )}
      {node.isRoot && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem danger onClick={() => run(() => onRemoveFolder(node.path))}>
            Remove from Workspace
          </ContextMenuItem>
        </>
      )}
    </ContextMenu>
  )
}
