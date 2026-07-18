import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings } from '../shared/settings'
import type { OpenTabsState } from '../shared/openTabsState'
import type { FileNode } from '../shared/fileNode'
import type { GitRepoStatus } from '../shared/gitStatus'
import type { RecentExternalFile } from '../shared/recentExternalFile'
import type { PathListingResult } from '../shared/pathMatch'
import type { MenuAction } from '../shared/menuAction'
import type { UpdateNotification } from '../shared/updateNotification'
import type { GTaskInput } from '../shared/googleTasks'

const api = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  addWorkspace: () => ipcRenderer.invoke('add-workspace'),
  removeWorkspace: (path: string) => ipcRenderer.invoke('remove-workspace', path),
  searchProjects: (query: string) => ipcRenderer.invoke('search-projects', query),

  getRecentExternalFiles: (): Promise<RecentExternalFile[]> =>
    ipcRenderer.invoke('get-recent-external-files'),
  touchRecentExternalFile: (filePath: string): Promise<RecentExternalFile[]> =>
    ipcRenderer.invoke('touch-recent-external-file', filePath),
  removeRecentExternalFile: (filePath: string): Promise<RecentExternalFile[]> =>
    ipcRenderer.invoke('remove-recent-external-file', filePath),
  listPathMatches: (rawInput: string): Promise<PathListingResult> =>
    ipcRenderer.invoke('list-path-matches', rawInput),

  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  saveFile: (path: string, content: string) => ipcRenderer.invoke('save-file', path, content),
  renamePath: (oldPath: string, newName: string) =>
    ipcRenderer.invoke('rename-path', oldPath, newName),
  revealInFinder: (path: string) => ipcRenderer.send('reveal-in-finder', path),
  createPath: (parentPath: string, name: string, type: 'file' | 'directory') =>
    ipcRenderer.invoke('create-path', parentPath, name, type),
  movePath: (sourcePath: string, targetDirPath: string) =>
    ipcRenderer.invoke('move-path', sourcePath, targetDirPath),
  copyPath: (sourcePath: string, targetDirPath: string) =>
    ipcRenderer.invoke('copy-path', sourcePath, targetDirPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('delete-path', targetPath),

  getTheme: () => ipcRenderer.invoke('get-theme'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),

  getOpenTabs: (): Promise<OpenTabsState> => ipcRenderer.invoke('get-open-tabs'),
  saveOpenTabs: (state: OpenTabsState) => ipcRenderer.invoke('save-open-tabs', state),
  onThemeUpdated: (callback: (isDark: boolean) => void) => {
    const listener = (_, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  },

  onWorkspacesChanged: (callback: (trees: FileNode[]) => void) => {
    const listener = (_, trees: FileNode[]) => callback(trees)
    ipcRenderer.on('workspaces-changed', listener)
    return () => ipcRenderer.removeListener('workspaces-changed', listener)
  },

  onFileChangedExternally: (callback: (path: string) => void) => {
    const listener = (_, path: string) => callback(path)
    ipcRenderer.on('file-changed-externally', listener)
    return () => ipcRenderer.removeListener('file-changed-externally', listener)
  },

  onOpenFileRequest: (callback: (path: string) => void) => {
    const listener = (_, path: string) => callback(path)
    ipcRenderer.on('open-file-request', listener)
    return () => ipcRenderer.removeListener('open-file-request', listener)
  },

  onRequestClose: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('request-close', listener)
    return () => ipcRenderer.removeListener('request-close', listener)
  },
  confirmClose: () => ipcRenderer.send('confirm-close'),
  declineClose: () => ipcRenderer.send('decline-close'),
  notifyRendererReady: () => ipcRenderer.send('renderer-ready'),

  onMenuAction: (callback: (action: MenuAction) => void) => {
    const listener = (_, action: MenuAction) => callback(action)
    ipcRenderer.on('menu-action', listener)
    return () => ipcRenderer.removeListener('menu-action', listener)
  },

  onUpdateNotification: (callback: (update: UpdateNotification) => void) => {
    const listener = (_, update: UpdateNotification) => callback(update)
    ipcRenderer.on('update-notification', listener)
    return () => ipcRenderer.removeListener('update-notification', listener)
  },
  applyUpdate: () => ipcRenderer.send('apply-update'),

  createPty: (cwd?: string) => ipcRenderer.invoke('create-pty', cwd),
  destroyPty: (termId: string) => ipcRenderer.send('destroy-pty', termId),
  ptyWrite: (termId: string, data: string) => ipcRenderer.send('pty-write', termId, data),
  ptyResize: (termId: string, cols: number, rows: number) =>
    ipcRenderer.send('pty-resize', termId, cols, rows),

  onPtyData: (termId: string, callback: (data: string) => void) => {
    const channel = `pty-data-${termId}`
    const listener = (_, data) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  onPtyExit: (termId: string, callback: () => void) => {
    const channel = `pty-exit-${termId}`
    const listener = () => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  getGitStatus: () => ipcRenderer.invoke('git-status'),
  getGitDiff: (root: string, relPath: string) => ipcRenderer.invoke('git-diff', root, relPath),
  gitStage: (root: string, relPaths: string[]) => ipcRenderer.invoke('git-stage', root, relPaths),
  gitUnstage: (root: string, relPaths: string[]) =>
    ipcRenderer.invoke('git-unstage', root, relPaths),
  gitDiscard: (root: string, relPath: string) => ipcRenderer.invoke('git-discard', root, relPath),
  gitCommit: (root: string, message: string, relPaths: string[], amend: boolean) =>
    ipcRenderer.invoke('git-commit', root, message, relPaths, amend),
  gitLastCommitMessage: (root: string) => ipcRenderer.invoke('git-last-commit-message', root),
  gitPush: (root: string) => ipcRenderer.invoke('git-push', root),
  gitPull: (root: string) => ipcRenderer.invoke('git-pull', root),
  gitLog: (root: string, limit: number, skip: number) =>
    ipcRenderer.invoke('git-log', root, limit, skip),
  gitBranches: (root: string) => ipcRenderer.invoke('git-branches', root),
  gitCheckout: (root: string, branch: string) => ipcRenderer.invoke('git-checkout', root, branch),
  gtasksAccounts: () => ipcRenderer.invoke('gtasks-accounts'),
  gtasksAddAccount: () => ipcRenderer.invoke('gtasks-add-account'),
  gtasksRemoveAccount: (email: string) => ipcRenderer.invoke('gtasks-remove-account', email),
  gtasksLists: (email: string) => ipcRenderer.invoke('gtasks-lists', email),
  gtasksTasks: (email: string, listId: string) => ipcRenderer.invoke('gtasks-tasks', email, listId),
  gtasksCreateTask: (email: string, listId: string, input: GTaskInput) =>
    ipcRenderer.invoke('gtasks-create-task', email, listId, input),
  gtasksUpdateTask: (
    email: string,
    listId: string,
    taskId: string,
    input: Partial<GTaskInput> & { status?: 'needsAction' | 'completed' }
  ) => ipcRenderer.invoke('gtasks-update-task', email, listId, taskId, input),
  gtasksMoveTask: (email: string, listId: string, taskId: string, previousTaskId?: string) =>
    ipcRenderer.invoke('gtasks-move-task', email, listId, taskId, previousTaskId),
  onGitStatusChanged: (callback: (statuses: GitRepoStatus[]) => void) => {
    const listener = (_, statuses: GitRepoStatus[]) => callback(statuses)
    ipcRenderer.on('git-status-changed', listener)
    return () => ipcRenderer.removeListener('git-status-changed', listener)
  },

  lintPython: (absPath: string) => ipcRenderer.invoke('lint-python', absPath),
  lintEslint: (absPath: string, workspaceRoot: string) =>
    ipcRenderer.invoke('lint-eslint', absPath, workspaceRoot),

  translateGoogleWeb: (text: string, from: string, to: string) =>
    ipcRenderer.invoke('translate-google-web', text, from, to),

  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
