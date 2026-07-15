import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { FileNode } from '../../../shared/fileNode'
import type { RevealRequest } from '../components/FileTree'
import { alertDialog, confirmDialog } from '../lib/dialogs'

interface UseWorkspaceTreeCallbacks {
  // Called after a new file is created in the tree, so it can be opened in a tab.
  onFileCreated: (path: string) => void
  // Called after a rename/move, so open tabs pointing at the old path can be
  // remapped to the new one.
  onPathChanged: (oldPath: string, newPath: string) => void
  // Called after a file/folder is deleted, so any tabs under it can be closed.
  onPathDeleted: (deletedPath: string, isDirectory: boolean) => void
  // Owned by the caller (not this hook) so ref access stays out of the
  // plain-state object this hook returns.
  renameInputRef: RefObject<HTMLInputElement | null>
  createInputRef: RefObject<HTMLInputElement | null>
}

// Owns the workspace file tree: the roots themselves (add/remove/rename/move/
// copy/delete), the rename/create dialogs, and the tree's focus/clipboard
// state used for keyboard copy-paste-delete.
export function useWorkspaceTree(callbacks: UseWorkspaceTreeCallbacks) {
  const { renameInputRef, createInputRef } = callbacks

  const [rootNodes, setRootNodes] = useState<FileNode[]>([])
  // Each reveal carries a fresh seq so revealing the same path twice (e.g.
  // the "select opened file" button after the user collapsed folders) still
  // re-expands and re-scrolls - the tree reacts to a *change* of the request.
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null)
  const revealSeqRef = useRef(0)
  const setRevealPath = (path: string | null): void => {
    setRevealRequest(path ? { path, seq: ++revealSeqRef.current } : null)
  }

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(
    null
  )

  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [createTarget, setCreateTarget] = useState<{
    parentPath: string
    type: 'file' | 'directory'
  } | null>(null)
  const [createValue, setCreateValue] = useState('')

  const [focusedNode, setFocusedNode] = useState<FileNode | null>(null)
  const [clipboard, setClipboard] = useState<{ path: string } | null>(null)

  useEffect(() => {
    window.api.getWorkspaces().then((trees) => {
      setRootNodes(trees || [])
    })

    const unsubscribe = window.api.onWorkspacesChanged((trees) => {
      setRootNodes(trees || [])
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (renameTarget) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renameTarget])

  useEffect(() => {
    if (createTarget) {
      createInputRef.current?.focus()
    }
  }, [createTarget])

  const handleAddFolder = async (): Promise<void> => {
    const trees = await window.api.addWorkspace()
    if (trees) setRootNodes(trees)
  }

  const handleRemoveFolder = async (path: string): Promise<void> => {
    const trees = await window.api.removeWorkspace(path)
    setRootNodes(trees || [])
    setContextMenu(null)
  }

  const handleContextMenu = (e: React.MouseEvent, node: FileNode): void => {
    setContextMenu({ x: e.pageX, y: e.pageY, node })
  }

  const handleFocusNode = (node: FileNode): void => {
    setFocusedNode(node)
  }

  const startRename = (node: FileNode): void => {
    setContextMenu(null)
    setRenameValue(node.name)
    setRenameTarget(node)
  }

  const confirmRename = async (): Promise<void> => {
    const node = renameTarget
    if (!node) return
    const newName = renameValue.trim()
    setRenameTarget(null)
    if (!newName || newName === node.name) return

    const result = await window.api.renamePath(node.path, newName)
    if (!result.success || !result.newPath) {
      await alertDialog(result.error || 'Failed to rename.')
      return
    }
    setRootNodes(result.trees || [])
    callbacks.onPathChanged(node.path, result.newPath)
    setFocusedNode(null)
    setClipboard(null)
  }

  const startCreate = (node: FileNode, type: 'file' | 'directory'): void => {
    const parentPath =
      node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    setContextMenu(null)
    setCreateValue('')
    setCreateTarget({ parentPath, type })
  }

  const confirmCreate = async (): Promise<void> => {
    const target = createTarget
    if (!target) return
    const name = createValue.trim()
    setCreateTarget(null)
    if (!name) return

    const result = await window.api.createPath(target.parentPath, name, target.type)
    if (!result.success || !result.newPath) {
      await alertDialog(result.error || 'Failed to create.')
      return
    }
    setRootNodes(result.trees || [])
    setRevealPath(target.parentPath)
    if (target.type === 'file') {
      callbacks.onFileCreated(result.newPath)
    }
  }

  const handleMove = async (sourcePath: string, targetDirPath: string): Promise<void> => {
    if (sourcePath === targetDirPath) return
    const result = await window.api.movePath(sourcePath, targetDirPath)
    if (!result.success || !result.newPath) {
      if (result.error) await alertDialog(result.error)
      return
    }
    setRootNodes(result.trees || [])
    setRevealPath(targetDirPath)
    callbacks.onPathChanged(sourcePath, result.newPath)
    setFocusedNode(null)
    setClipboard(null)
  }

  const pasteIntoNode = async (node: FileNode): Promise<void> => {
    if (!clipboard) return
    const destDir =
      node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    const result = await window.api.copyPath(clipboard.path, destDir)
    setContextMenu(null)
    if (!result.success || !result.newPath) {
      if (result.error) await alertDialog(result.error)
      return
    }
    setRootNodes(result.trees || [])
    setRevealPath(destDir)
  }

  const deleteNode = async (node: FileNode): Promise<void> => {
    if (!(await confirmDialog(`Move "${node.name}" to Trash?`))) return
    const result = await window.api.deletePath(node.path)
    setContextMenu(null)
    if (!result.success) {
      if (result.error) await alertDialog(result.error)
      return
    }
    setRootNodes(result.trees || [])
    callbacks.onPathDeleted(node.path, node.type === 'directory')

    if (focusedNode?.path === node.path) setFocusedNode(null)
    if (clipboard?.path === node.path) setClipboard(null)
  }

  return {
    rootNodes,
    revealRequest,
    setRevealPath,
    contextMenu,
    setContextMenu,
    renameTarget,
    setRenameTarget,
    renameValue,
    setRenameValue,
    createTarget,
    setCreateTarget,
    createValue,
    setCreateValue,
    focusedNode,
    clipboard,
    setClipboard,
    handleAddFolder,
    handleRemoveFolder,
    handleContextMenu,
    handleFocusNode,
    startRename,
    confirmRename,
    startCreate,
    confirmCreate,
    handleMove,
    pasteIntoNode,
    deleteNode
  }
}
