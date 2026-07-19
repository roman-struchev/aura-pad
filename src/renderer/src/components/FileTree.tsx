import React, { useEffect, useRef, useState } from 'react'
import { FilePlus, FolderPlus, Play, Eye, GitBranch } from 'lucide-react'
import clsx from 'clsx'
import type { FileNode } from '../../../shared/fileNode'
import type { GitFileState } from '../../../shared/gitStatus'
import { getFileIcon } from '../lib/fileIcon'
import { isPreviewablePath, isPythonPath } from '../lib/fileType'

export type { FileNode }

// A request to expand the tree down to (and scroll to) a path. `seq` makes
// every request unique, so revealing the same path again still re-triggers.
export interface RevealRequest {
  path: string
  seq: number
}

interface FileTreeProps {
  node: FileNode
  onSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onCreateNew: (node: FileNode, type: 'file' | 'directory') => void
  onMove: (sourcePath: string, targetDirPath: string) => void
  onFocusNode: (node: FileNode) => void
  onRunPython: (node: FileNode) => void
  onPreviewMarkdown: (node: FileNode) => void
  selectedPath: string | null
  revealRequest?: RevealRequest | null
  rowPadding?: string
  gitStatus?: Record<string, GitFileState>
  // Current branch of the repo this root belongs to; shown as a badge on the
  // root row (the per-project git entry point). Only set on root instances.
  rootBranch?: string
  // Called with this root's path - takes the path as an argument (rather
  // than closing over it) so the same stable callback can be passed to every
  // root without breaking the memo below.
  onOpenGit?: (rootPath: string) => void
  level?: number
}

const GIT_BADGE: Record<GitFileState, { label: string; className: string }> = {
  staged: { label: '●', className: 'text-blue-400' },
  modified: { label: 'M', className: 'text-blue-400' },
  added: { label: 'A', className: 'text-green-500' },
  untracked: { label: 'U', className: 'text-red-400' },
  deleted: { label: 'D', className: 'text-gray-500' },
  renamed: { label: 'R', className: 'text-blue-400' }
}

export const DRAG_PATH_MIME = 'application/x-aura-path'

// Memoized: App re-renders on every keystroke, and without this the entire
// expanded forest re-rendered with it. Effective because the node objects
// keep their identity across unrelated updates (useWorkspaceTree's
// mergeForest) and App passes identity-stable callbacks (useStableCallback).
export const FileTree: React.FC<FileTreeProps> = React.memo(function FileTree({
  node,
  onSelect,
  onContextMenu,
  onCreateNew,
  onMove,
  onFocusNode,
  onRunPython,
  onPreviewMarkdown,
  selectedPath,
  revealRequest,
  rowPadding = 'py-1',
  gitStatus,
  rootBranch,
  onOpenGit,
  level = 0
}) {
  const [expanded, setExpanded] = useState<boolean>(level === 0)
  const [lastRevealKey, setLastRevealKey] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const isSelected = selectedPath === node.path
  const isDirectory = node.type === 'directory'
  const isPreviewable = isPreviewablePath(node.name)
  const hasFileAction = !isDirectory && (isPythonPath(node.name) || isPreviewable)

  // Auto-expand (once) if the selected/revealed path is this directory or a
  // descendant of it. Adjusting state directly during render - rather than
  // in a useEffect - lets the user still manually collapse it afterward
  // without it being immediately forced back open on the next render. The
  // seq in the key re-arms this for every explicit reveal request, even one
  // for the same path.
  const revealTarget = revealRequest?.path || selectedPath || null
  const revealKey = revealRequest ? `${revealRequest.seq}:${revealRequest.path}` : selectedPath
  const isRevealTarget =
    !!revealTarget &&
    isDirectory &&
    (revealTarget === node.path || revealTarget.startsWith(node.path + '/'))
  if (isRevealTarget && revealKey !== lastRevealKey) {
    setLastRevealKey(revealKey)
    if (!expanded) setExpanded(true)
  }

  // Bring the reveal target itself into view. Runs after the render in which
  // the ancestors above expanded, so the row exists by now; also covers the
  // "just mounted because a parent expanded" case, since the effect fires on
  // mount too.
  const isRevealedNode = revealRequest?.path === node.path
  useEffect(() => {
    if (isRevealedNode) rowRef.current?.scrollIntoView({ block: 'center' })
  }, [revealRequest, isRevealedNode])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDirectory) {
      setExpanded(!expanded)
    } else {
      onSelect(node.path)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onContextMenu(e, node)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.setData(DRAG_PATH_MIME, node.path)
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDirectory) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes(DRAG_PATH_MIME)) {
      e.dataTransfer.dropEffect = 'move'
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isDirectory) return
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!isDirectory) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const sourcePath = e.dataTransfer.getData(DRAG_PATH_MIME)
    if (sourcePath) onMove(sourcePath, node.path)
  }

  return (
    <div className="select-none font-sans">
      <div
        ref={rowRef}
        className={clsx(
          'group flex items-center px-2 cursor-pointer leading-tight hover:bg-fleet-active text-fleet-text hover:text-fleet-textHover transition-colors outline-none focus:ring-1 focus:ring-inset focus:ring-gray-400/60',
          rowPadding,
          isSelected && 'bg-fleet-active text-fleet-textHover',
          isDragOver && 'bg-blue-500/20 ring-1 ring-inset ring-blue-500',
          isDragging && 'opacity-40'
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
          {getFileIcon(node.name, node.type, expanded)}
        </span>
        <span className="truncate flex-1">{node.name}</span>
        {node.isRoot && rootBranch && (
          <button
            className="ml-1 shrink-0 flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-200 px-1 py-px rounded hover:bg-fleet-border max-w-[45%]"
            title={`Open Git — ${rootBranch}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenGit?.(node.path)
            }}
          >
            <GitBranch size={10} className="shrink-0" />
            <span className="truncate">{rootBranch}</span>
          </button>
        )}
        {!isDirectory && (
          <div className="ml-1 shrink-0 flex items-center">
            {gitStatus?.[node.path] && (
              <span
                className={clsx(
                  'text-[10px] font-bold w-3 text-center',
                  hasFileAction && 'group-hover:hidden',
                  GIT_BADGE[gitStatus[node.path]].className
                )}
              >
                {GIT_BADGE[gitStatus[node.path]].label}
              </span>
            )}
            {isPythonPath(node.name) && (
              <button
                className="hidden group-hover:block p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-green-500"
                title="Run Script"
                onClick={(e) => {
                  e.stopPropagation()
                  onRunPython(node)
                }}
              >
                <Play size={13} />
              </button>
            )}
            {isPreviewable && (
              <button
                className="hidden group-hover:block p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-blue-400"
                title="Preview"
                onClick={(e) => {
                  e.stopPropagation()
                  onPreviewMarkdown(node)
                }}
              >
                <Eye size={13} />
              </button>
            )}
          </div>
        )}
        {isDirectory && (
          <div className="hidden group-hover:flex items-center gap-1 ml-1 shrink-0">
            <button
              className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white"
              title="New File"
              onClick={(e) => {
                e.stopPropagation()
                onCreateNew(node, 'file')
              }}
            >
              <FilePlus size={13} />
            </button>
            <button
              className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white"
              title="New Folder"
              onClick={(e) => {
                e.stopPropagation()
                onCreateNew(node, 'directory')
              }}
            >
              <FolderPlus size={13} />
            </button>
          </div>
        )}
      </div>

      {isDirectory && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTree
              key={child.path}
              node={child}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onCreateNew={onCreateNew}
              onMove={onMove}
              onFocusNode={onFocusNode}
              onRunPython={onRunPython}
              onPreviewMarkdown={onPreviewMarkdown}
              selectedPath={selectedPath}
              revealRequest={revealRequest}
              rowPadding={rowPadding}
              gitStatus={gitStatus}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
})
