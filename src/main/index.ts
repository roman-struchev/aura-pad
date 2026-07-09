import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import {
  loadWorkspaces,
  saveWorkspaces,
  getWorkspaceTrees,
  searchInWorkspaces,
  readFileContent,
  writeFileContent,
  renamePath,
  createPath,
  copyPath,
  deletePath,
  movePath
} from './workspaces'
import { loadSettings, saveSettings } from './settings'
import { setupWatchers, closeAllWatchers, broadcast, recordSelfWrite } from './watcher'
import { registerCreatePtyHandler, killAllPtys } from './terminals'
import { buildAppMenu } from './menu'
import type { AppSettings } from '../shared/settings'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 8 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerCreatePtyHandler(mainWindow)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.struchev.aura')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  Menu.setApplicationMenu(buildAppMenu())

  createWindow()
  setupWatchers()

  nativeTheme.on('updated', () => {
    broadcast('theme-updated', nativeTheme.shouldUseDarkColors)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllPtys()
  closeAllWatchers()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// File System IPC Handlers
ipcMain.handle('get-workspaces', () => {
  return getWorkspaceTrees()
})

ipcMain.handle('add-workspace', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null

  const selectedPath = result.filePaths[0]
  const paths = loadWorkspaces()

  if (!paths.includes(selectedPath)) {
    paths.push(selectedPath)
    saveWorkspaces(paths)
    setupWatchers()
  }

  return getWorkspaceTrees()
})

ipcMain.handle('remove-workspace', (_, pathToRemove) => {
  let paths = loadWorkspaces()
  paths = paths.filter((p) => p !== pathToRemove)
  saveWorkspaces(paths)
  setupWatchers()
  return getWorkspaceTrees()
})

ipcMain.handle('search-projects', async (_, query) => {
  return await searchInWorkspaces(query)
})

ipcMain.handle('read-file', async (_, filePath) => {
  return readFileContent(filePath)
})

ipcMain.handle('save-file', async (_, filePath, content) => {
  const result = writeFileContent(filePath, content)
  if (result.success) recordSelfWrite(filePath)
  return result
})

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors)

ipcMain.handle('get-settings', () => loadSettings())

ipcMain.handle('save-settings', (_, settings: AppSettings) => {
  saveSettings(settings)
  return settings
})

ipcMain.handle('rename-path', async (_, oldPath: string, newName: string) => {
  const result = renamePath(oldPath, newName)
  if (result.success) setupWatchers()
  return result
})

ipcMain.handle(
  'create-path',
  async (_, parentPath: string, name: string, type: 'file' | 'directory') => {
    return createPath(parentPath, name, type)
  }
)

ipcMain.handle('copy-path', async (_, sourcePath: string, targetDirPath: string) => {
  return copyPath(sourcePath, targetDirPath)
})

ipcMain.handle('delete-path', async (_, targetPath: string) => {
  const result = await deletePath(targetPath)
  if (result.success) setupWatchers()
  return result
})

ipcMain.handle('move-path', async (_, sourcePath: string, targetDirPath: string) => {
  const result = movePath(sourcePath, targetDirPath)
  if (result.success) setupWatchers()
  return result
})
