import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { FileNode } from '../../../shared/fileNode'
import type { RevealRequest, RowClickModifiers } from '../components/FileTree'
import { alertDialog, confirmDialog } from '../lib/dialogs'
import { dirname } from '../lib/path'
import { visibleTreePaths } from '../lib/treeRows'

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

// Main rebuilds and pushes the *entire* forest on any structural change.
// Reuse the previous render's node objects (by identity) for subtrees that
// didn't actually change, so the memoized FileTree rows under them can skip
// re-rendering - without this, every watcher push re-rendered every expanded
// row in every workspace.
function mergeNode(prev: FileNode | undefined, next: FileNode): FileNode {
  if (
    !prev ||
    prev.name !== next.name ||
    prev.path !== next.path ||
    prev.type !== next.type ||
    !!prev.isRoot !== !!next.isRoot ||
    !prev.children !== !next.children
  ) {
    return next
  }
  if (!next.children) return prev
  const prevChildren = prev.children ?? []
  const prevByPath = new Map(prevChildren.map((c) => [c.path, c]))
  let unchanged = prevChildren.length === next.children.length
  const merged = next.children.map((child, i) => {
    const result = mergeNode(prevByPath.get(child.path), child)
    if (result !== prevChildren[i]) unchanged = false
    return result
  })
  return unchanged ? prev : { ...next, children: merged }
}

// Descends straight to a path instead of walking the whole forest: only the
// child that is a prefix of the wanted path can contain it.
function findNode(roots: FileNode[], target: string): FileNode | null {
  for (const root of roots) {
    if (root.path === target) return root
    if (target.startsWith(root.path + '/') && root.children) {
      const hit = findNode(root.children, target)
      if (hit) return hit
    }
  }
  return null
}

function mergeForest(prev: FileNode[], next: FileNode[]): FileNode[] {
  const prevByPath = new Map(prev.map((r) => [r.path, r]))
  let unchanged = prev.length === next.length
  const merged = next.map((root, i) => {
    const result = mergeNode(prevByPath.get(root.path), root)
    if (result !== prev[i]) unchanged = false
    return result
  })
  return unchanged ? prev : merged
}

// Owns the workspace file tree: the roots themselves (add/remove/rename/move/
// copy/delete), the rename/create dialogs, and the tree's focus/clipboard
// state used for keyboard copy-paste-delete.
export function useWorkspaceTree(callbacks: UseWorkspaceTreeCallbacks) {
  const { renameInputRef, createInputRef } = callbacks

  const [rootNodes, setRawRootNodes] = useState<FileNode[]>([])
  const setRootNodes = (trees: FileNode[]): void => {
    setRawRootNodes((prev) => mergeForest(prev, trees))
  }
  // False until the initial workspace scan resolves, so callers that need to
  // tell "no workspaces configured" apart from "still loading" (e.g. the
  // outside-workspace reconciliation in App.tsx) don't act on a root list
  // that's merely empty because it hasn't loaded yet.
  const [rootsLoaded, setRootsLoaded] = useState(false)
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
  // How many files the clipboard holds right now, read when the context menu
  // opens - it decides whether "Paste" is offered and how it's labelled.
  const [clipboardCount, setClipboardCount] = useState(0)

  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [createTarget, setCreateTarget] = useState<{
    parentPath: string
    type: 'file' | 'directory'
  } | null>(null)
  const [createValue, setCreateValue] = useState('')

  // The tree's own selection, in visible order. Copy/paste/delete act on it.
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  // Where a shift-range starts, and the paste target for the keyboard: the
  // last row the user actually clicked, not just the first selected one.
  const [anchorPath, setAnchorPath] = useState<string | null>(null)
  // Fallback for platforms where handing a file list to the OS clipboard
  // isn't supported (Windows/Linux desktops we can't write a native file
  // list on): in-app copy/paste keeps working through this.
  const inAppClipboard = useRef<string[]>([])

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  // Resolved against the current forest, so entries that vanished (deleted
  // outside the app, or by the operation itself) simply drop out.
  const selectedNodes = useMemo(
    () => selectedPaths.map((p) => findNode(rootNodes, p)).filter((n): n is FileNode => !!n),
    [rootNodes, selectedPaths]
  )

  useEffect(() => {
    window.api.getWorkspaces().then((trees) => {
      setRootNodes(trees || [])
      setRootsLoaded(true)
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

  const selectOnly = (node: FileNode): void => {
    setSelectedPaths([node.path])
    setAnchorPath(node.path)
  }

  const handleRowClick = (node: FileNode, modifiers: RowClickModifiers): void => {
    if (modifiers.range && anchorPath) {
      // The visible rows, in the order they're painted - so a shift-range
      // spans exactly what the user sees between the two rows, across
      // collapsed folders and multiple workspace roots alike.
      const order = visibleTreePaths()
      const from = order.indexOf(anchorPath)
      const to = order.indexOf(node.path)
      if (from !== -1 && to !== -1) {
        setSelectedPaths(order.slice(Math.min(from, to), Math.max(from, to) + 1))
        return
      }
    }
    if (modifiers.toggle) {
      setSelectedPaths((prev) =>
        prev.includes(node.path) ? prev.filter((p) => p !== node.path) : [...prev, node.path]
      )
      setAnchorPath(node.path)
      return
    }
    selectOnly(node)
  }

  // The OS clipboard wins when it holds files (that's how a Finder copy gets
  // in), with the in-app list as the fallback for platforms where writing a
  // native file list isn't possible.
  const readClipboardPaths = async (): Promise<string[]> => {
    const fromOs = await window.api.readClipboardFiles()
    return fromOs.length > 0 ? fromOs : inAppClipboard.current
  }

  const handleContextMenu = async (e: React.MouseEvent, node: FileNode): Promise<void> => {
    // Read before awaiting: React reuses nothing here, but the event is the
    // caller's and shouldn't be touched after the handler yields.
    const { clientX, clientY } = e
    // Right-clicking outside the current selection retargets it; inside it,
    // the whole selection stays, so "Copy 3 Items" means what it says.
    if (!selectedPathSet.has(node.path)) selectOnly(node)
    // Awaited rather than filled in later, so the menu doesn't grow a Paste
    // row under the cursor a frame after it opened.
    setClipboardCount((await readClipboardPaths()).length)
    setContextMenu({ x: clientX, y: clientY, node })
  }

  const copySelection = async (): Promise<void> => {
    const paths = selectedPaths
    if (paths.length === 0) return
    inAppClipboard.current = paths
    const result = await window.api.writeClipboardFiles(paths)
    if (!result.success && result.error) await alertDialog(result.error)
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
    setSelectedPaths([result.newPath])
    setAnchorPath(result.newPath)
  }

  const startCreate = (node: FileNode, type: 'file' | 'directory'): void => {
    const parentPath = node.type === 'directory' ? node.path : dirname(node.path)
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
    setSelectedPaths([result.newPath])
    setAnchorPath(result.newPath)
  }

  // Paste target: the folder itself when a folder was hit, otherwise the
  // folder the clicked file lives in - the same rule Finder uses.
  const pasteIntoNode = async (node: FileNode): Promise<void> => {
    const sources = await readClipboardPaths()
    setContextMenu(null)
    if (sources.length === 0) return
    const destDir = node.type === 'directory' ? node.path : dirname(node.path)
    const result = await window.api.copyPaths(sources, destDir)
    if (result.trees) setRootNodes(result.trees)
    setRevealPath(destDir)
    // Leaving the fresh copies selected makes a follow-up rename or delete a
    // single keystroke away, and shows what landed where.
    if (result.newPaths?.length) {
      setSelectedPaths(result.newPaths)
      setAnchorPath(result.newPaths[result.newPaths.length - 1])
    }
    if (result.error) await alertDialog(result.error)
  }

  // Keyboard paste: into the row the user last clicked, falling back to the
  // first row of the selection.
  const pasteIntoSelection = async (): Promise<void> => {
    const target = (anchorPath ? findNode(rootNodes, anchorPath) : null) ?? selectedNodes[0]
    if (target) await pasteIntoNode(target)
  }

  const deleteSelection = async (): Promise<void> => {
    // Workspace roots are removed from the workspace, never trashed.
    const targets = selectedNodes.filter((n) => !n.isRoot)
    setContextMenu(null)
    if (targets.length === 0) return

    const label = targets.length === 1 ? `"${targets[0].name}"` : `${targets.length} selected items`
    if (!(await confirmDialog(`Move ${label} to Trash?`))) return

    const result = await window.api.deletePaths(targets.map((n) => n.path))
    if (result.trees) setRootNodes(result.trees)
    for (const target of targets) {
      callbacks.onPathDeleted(target.path, target.type === 'directory')
    }
    const deleted = new Set(targets.map((n) => n.path))
    setSelectedPaths((prev) => prev.filter((p) => !deleted.has(p)))
    setAnchorPath((prev) => (prev && deleted.has(prev) ? null : prev))
    inAppClipboard.current = inAppClipboard.current.filter((p) => !deleted.has(p))
    if (result.error) await alertDialog(result.error)
  }

  return {
    rootNodes,
    rootsLoaded,
    revealRequest,
    setRevealPath,
    contextMenu,
    setContextMenu,
    clipboardCount,
    renameTarget,
    setRenameTarget,
    renameValue,
    setRenameValue,
    createTarget,
    setCreateTarget,
    createValue,
    setCreateValue,
    selectedPaths,
    selectedPathSet,
    selectedNodes,
    handleAddFolder,
    handleRemoveFolder,
    handleContextMenu,
    handleRowClick,
    startRename,
    confirmRename,
    startCreate,
    confirmCreate,
    handleMove,
    copySelection,
    pasteIntoNode,
    pasteIntoSelection,
    deleteSelection
  }
}
