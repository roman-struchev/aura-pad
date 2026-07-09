import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

interface AppSettings {
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: 'micro' | 'compact' | 'normal'
}

const api = {
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  addWorkspace: () => ipcRenderer.invoke('add-workspace'),
  removeWorkspace: (path: string) => ipcRenderer.invoke('remove-workspace', path),
  searchProjects: (query: string) => ipcRenderer.invoke('search-projects', query),
  
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  saveFile: (path: string, content: string) => ipcRenderer.invoke('save-file', path, content),
  renamePath: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-path', oldPath, newName),
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
  onThemeUpdated: (callback: (isDark: boolean) => void) => {
    const listener = (_, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  },

  onWorkspacesChanged: (callback: (trees: any[]) => void) => {
    const listener = (_, trees: any[]) => callback(trees)
    ipcRenderer.on('workspaces-changed', listener)
    return () => ipcRenderer.removeListener('workspaces-changed', listener)
  },

  onFileChangedExternally: (callback: (path: string) => void) => {
    const listener = (_, path: string) => callback(path)
    ipcRenderer.on('file-changed-externally', listener)
    return () => ipcRenderer.removeListener('file-changed-externally', listener)
  },
  
  createPty: (cwd?: string) => ipcRenderer.invoke('create-pty', cwd),
  destroyPty: (termId: string) => ipcRenderer.send('destroy-pty', termId),
  ptyWrite: (termId: string, data: string) => ipcRenderer.send('pty-write', termId, data),
  ptyResize: (termId: string, cols: number, rows: number) => ipcRenderer.send('pty-resize', termId, cols, rows),
  
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
  }
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