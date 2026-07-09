import { useEffect, useRef, useState } from 'react'
import type * as monacoEditor from 'monaco-editor'
import { confirmDialog } from '../lib/dialogs'

export type OpenTab = {
  path: string
  content: string
  isSaved: boolean
  externalChangeAvailable: boolean
  showPreview: boolean
  pinned?: boolean
}

const CLOSED_STACK_LIMIT = 10

// Manages the set of open files (tab-bar style): opening/closing/saving,
// autosave, reacting to external changes on disk, and keeping tab paths in
// sync when a file is renamed/moved/deleted elsewhere (the file tree).
export function useTabs(tabsEnabled: boolean, autosaveEnabled: boolean) {
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)

  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const tabsRef = useRef<OpenTab[]>([])
  const pendingJumpLine = useRef<number | null>(null)
  const closedStackRef = useRef<string[]>([])

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null
  const selectedPath = activeTab?.path ?? null
  const fileContent = activeTab?.content ?? ''
  const isSaved = activeTab?.isSaved ?? true
  const externalChangeAvailable = activeTab?.externalChangeAvailable ?? false
  const showMarkdownPreview = activeTab?.showPreview ?? false

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const updateTab = (path: string, patch: Partial<OpenTab>): void => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, ...patch } : t)))
  }

  const scrollToLine = (line: number): void => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line)
      editorRef.current.setPosition({ lineNumber: line, column: 1 })
      editorRef.current.focus()
    }
  }

  // Jump to a specific line once the editor is showing the right content,
  // whether that's from opening a search result or switching tabs. Uses a
  // ref (not state) for the pending line so consuming it doesn't itself
  // trigger a state update from inside this effect.
  useEffect(() => {
    if (pendingJumpLine.current !== null) {
      scrollToLine(pendingJumpLine.current)
      pendingJumpLine.current = null
    }
  }, [fileContent])

  const openTab = async (filePath: string, line?: number): Promise<void> => {
    const existing = tabs.find((t) => t.path === filePath)

    if (existing) {
      setActiveTabPath(filePath)
      if (line) pendingJumpLine.current = line
      return
    }

    const result = await window.api.readFile(filePath)
    if (!result.success) {
      console.error(result.error)
      return
    }

    const newTab: OpenTab = {
      path: filePath,
      content: result.content || '',
      isSaved: true,
      externalChangeAvailable: false,
      showPreview: false
    }

    setTabs((prev) => (tabsEnabled ? [...prev, newTab] : [newTab]))
    setActiveTabPath(filePath)
    if (line) pendingJumpLine.current = line
  }

  const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor): void => {
    editorRef.current = editor
  }

  const handleEditorChange = (value: string | undefined): void => {
    if (value !== undefined && activeTabPath) {
      updateTab(activeTabPath, { content: value, isSaved: false })
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!activeTab || activeTab.isSaved) return
    const result = await window.api.saveFile(activeTab.path, activeTab.content)
    if (result.success) updateTab(activeTab.path, { isSaved: true })
  }

  const closeTab = async (path: string): Promise<void> => {
    const tab = tabs.find((t) => t.path === path)
    if (!tab) return
    if (!tab.isSaved && !(await confirmDialog('You have unsaved changes. Close without saving?')))
      return

    const idx = tabs.findIndex((t) => t.path === path)
    const filtered = tabs.filter((t) => t.path !== path)
    setTabs(filtered)

    if (activeTabPath === path) {
      const next = filtered[idx] ?? filtered[idx - 1] ?? null
      setActiveTabPath(next ? next.path : null)
    }
    pendingJumpLine.current = null

    closedStackRef.current = closedStackRef.current.filter((p) => p !== path)
    closedStackRef.current.push(path)
    if (closedStackRef.current.length > CLOSED_STACK_LIMIT) closedStackRef.current.shift()
  }

  const handleCloseFile = (): void => {
    if (!activeTabPath) return
    closeTab(activeTabPath)
  }

  // Cmd+Shift+T: reopen the most recently closed tab, browser-style.
  const reopenClosedTab = (): void => {
    const path = closedStackRef.current.pop()
    if (path) openTab(path)
  }

  const togglePin = (path: string): void => {
    const tab = tabs.find((t) => t.path === path)
    if (tab) updateTab(path, { pinned: !tab.pinned })
  }

  // Reorders tabs by moving sourcePath to targetPath's index (drag & drop in the tab bar).
  const reorderTab = (sourcePath: string, targetPath: string): void => {
    if (sourcePath === targetPath) return
    setTabs((prev) => {
      const sourceIdx = prev.findIndex((t) => t.path === sourcePath)
      const targetIdx = prev.findIndex((t) => t.path === targetPath)
      if (sourceIdx === -1 || targetIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(sourceIdx, 1)
      next.splice(targetIdx, 0, moved)
      return next
    })
  }

  const reloadFromDisk = async (): Promise<void> => {
    if (!activeTabPath) return
    const result = await window.api.readFile(activeTabPath)
    if (result.success) {
      updateTab(activeTabPath, {
        content: result.content || '',
        isSaved: true,
        externalChangeAvailable: false
      })
    } else {
      updateTab(activeTabPath, { externalChangeAvailable: false })
    }
  }

  // Keep open tab paths in sync when a file/folder is renamed or moved in
  // the tree - otherwise the tab would keep pointing at the old path.
  const remapTabPaths = (oldPath: string, newPath: string): void => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.path === oldPath) return { ...t, path: newPath }
        if (t.path.startsWith(oldPath + '/'))
          return { ...t, path: newPath + t.path.slice(oldPath.length) }
        return t
      })
    )
    setActiveTabPath((prev) => {
      if (!prev) return prev
      if (prev === oldPath) return newPath
      if (prev.startsWith(oldPath + '/')) return newPath + prev.slice(oldPath.length)
      return prev
    })
  }

  // Close any tabs pointing at a path (or, for a deleted folder, any path
  // underneath it) that was deleted in the tree.
  const closeTabsUnder = (deletedPath: string, isDirectory: boolean): void => {
    const isAffected = (p: string) =>
      p === deletedPath || (isDirectory && p.startsWith(deletedPath + '/'))
    const remaining = tabs.filter((t) => !isAffected(t.path))
    setTabs(remaining)
    if (activeTabPath && isAffected(activeTabPath)) {
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
    }
  }

  // Autosave: after a short pause in typing, save automatically (unless disabled in Settings).
  useEffect(() => {
    if (!autosaveEnabled) return
    if (!activeTabPath || isSaved || externalChangeAvailable) return
    const timer = setTimeout(() => {
      handleSave()
    }, 1200)
    return () => clearTimeout(timer)
  }, [fileContent, activeTabPath, isSaved, externalChangeAvailable, autosaveEnabled])

  // React to a file changing on disk from outside the app (another editor,
  // git, another window of this app). If we have no local edits it's safe to
  // just reload; otherwise flag it and surface a banner instead of clobbering
  // the user's in-progress changes.
  useEffect(() => {
    const unsubscribe = window.api.onFileChangedExternally(async (changedPath) => {
      const tab = tabsRef.current.find((t) => t.path === changedPath)
      if (!tab) return
      if (tab.isSaved) {
        const result = await window.api.readFile(changedPath)
        if (result.success) updateTab(changedPath, { content: result.content || '', isSaved: true })
      } else {
        updateTab(changedPath, { externalChangeAvailable: true })
      }
    })
    return unsubscribe
  }, [])

  return {
    tabs,
    activeTabPath,
    setActiveTabPath,
    activeTab,
    selectedPath,
    fileContent,
    isSaved,
    externalChangeAvailable,
    showMarkdownPreview,
    updateTab,
    openTab,
    closeTab,
    handleCloseFile,
    reopenClosedTab,
    togglePin,
    reorderTab,
    handleSave,
    handleEditorChange,
    handleEditorDidMount,
    reloadFromDisk,
    remapTabPaths,
    closeTabsUnder
  }
}
