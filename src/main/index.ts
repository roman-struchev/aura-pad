// Must stay the first import: pins the app name (and thus the userData dir)
// before any module resolves paths under it at import time.
import './appIdentity'
import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import fs from 'fs'
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
import { loadOpenTabsState, saveOpenTabsState } from './openTabsState'
import {
  loadRecentExternalFiles,
  touchRecentExternalFile,
  removeRecentExternalFile
} from './recentExternalFiles'
import { listPathMatches } from './pathBrowse'
import { setupWatchers, closeAllWatchers, broadcast, recordSelfWrite } from './watcher'
import { registerCreatePtyHandler, killAllPtys } from './terminals'
import { buildAppMenu } from './menu'
import {
  getAllRepoStatuses,
  getDiff,
  stagePaths,
  unstagePaths,
  discardPath,
  commit as gitCommit,
  lastCommitMessage,
  push as gitPush,
  pull as gitPull
} from './git'
import { lintPython, lintEslint } from './lint'
import { googleWebTranslate } from './translate'
import { initAutoUpdater, applyUpdate } from './updater'
import type { AppSettings } from '../shared/settings'
import type { OpenTabsState } from '../shared/openTabsState'

// Opening a file via "Open With" (or dropping one on the dock icon on macOS)
// only reaches this process, not the renderer directly - forward it over
// IPC so App.tsx can just call tabs.openTab() with it, the same as opening
// a file from the tree. Queued if the window doesn't exist yet (macOS can
// fire 'open-file' before the app is ready; Windows/Linux pass the path as
// a plain CLI arg on the very first launch, before any window exists).
let mainWindowRef: BrowserWindow | null = null
const pendingFileOpens: string[] = []
// Windows that the renderer has confirmed are safe to close (no unsaved
// tabs, or the user chose to discard them) - see the 'close' handler below.
const windowsAllowedToClose = new WeakSet<BrowserWindow>()
// True once App.tsx has mounted and subscribed to 'open-file-request' (see
// the 'renderer-ready' handler below). 'ready-to-show' fires as soon as the
// page has painted a first frame, which isn't guaranteed to be after React
// has mounted and run its effects - sending straight to 'ready-to-show' could
// fire before anything is listening, silently dropping the very file the
// user tried to open. Queuing until the renderer actively asks for pending
// opens removes that race entirely.
let rendererReady = false

function flushPendingFileOpens(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return
  while (pendingFileOpens.length > 0) {
    mainWindowRef.webContents.send('open-file-request', pendingFileOpens.shift())
  }
}

function openFileInApp(filePath: string): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed() && rendererReady) {
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.focus()
    mainWindowRef.webContents.send('open-file-request', filePath)
  } else {
    pendingFileOpens.push(filePath)
  }
}

// Only a real, existing file counts - guards against dev-mode args
// (electron-vite's own flags/paths) being mistaken for a file to open.
function getFilePathFromArgv(argv: string[]): string | null {
  const candidate = argv[argv.length - 1]
  if (!candidate || candidate.startsWith('-')) return null
  try {
    return fs.statSync(candidate).isFile() ? candidate : null
  } catch (e) {
    return null
  }
}

// macOS-only: must be registered before whenReady, since launching the app
// fresh by double-clicking/opening-with a file fires this before it's ready.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  openFileInApp(filePath)
})

// Opening a file while AuraPad is already running (Windows/Linux file
// associations, or a second macOS open-file) should reuse this window
// rather than spawn another instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = getFilePathFromArgv(argv)
    if (filePath) openFileInApp(filePath)
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindowRef = mainWindow
  rendererReady = false
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
      rendererReady = false
    }
  })

  // Ask the renderer whether it's safe to close (unsaved tabs) instead of
  // discarding work silently - it responds via 'confirm-close' below, either
  // immediately (nothing unsaved) or after the user confirms a prompt.
  mainWindow.on('close', (event) => {
    if (windowsAllowedToClose.has(mainWindow)) return
    event.preventDefault()
    mainWindow.webContents.send('request-close')
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // A plain in-page navigation (e.g. clicking a link in the Markdown preview,
  // which isn't a new-window open and so never reaches setWindowOpenHandler
  // above) would otherwise replace the whole app with the target site. Electron
  // never fires this for the app's own initial loadURL/loadFile call below -
  // only for content-triggered navigations - so any occurrence here is a link
  // that should open in the OS browser instead, with the app's own window
  // left in place.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    shell.openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.on('confirm-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  windowsAllowedToClose.add(win)
  win.close()
})

// App.tsx sends this right after mounting and subscribing to
// 'open-file-request' - only from this point on is it safe to deliver a file
// open directly instead of queuing it.
ipcMain.on('renderer-ready', () => {
  rendererReady = true
  flushPendingFileOpens()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.struchev.aurapad')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  Menu.setApplicationMenu(
    buildAppMenu((action) => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindowRef
      win?.webContents.send('menu-action', action)
    })
  )

  // Registered once for the app's lifetime - always resolves to whatever
  // window is current, so it keeps working across a macOS close-then-reopen
  // (dock activate) cycle instead of staying bound to a destroyed window.
  registerCreatePtyHandler(() => mainWindowRef)

  createWindow()
  setupWatchers()
  initAutoUpdater()

  const initialFilePath = getFilePathFromArgv(process.argv)
  if (initialFilePath) openFileInApp(initialFilePath)

  nativeTheme.on('updated', () => {
    broadcast('theme-updated', nativeTheme.shouldUseDarkColors)
  })

  app.on('activate', function () {
    // On macOS, closing the last window doesn't quit the app - it tears down
    // watchers below (window-all-closed) since nothing was around to receive
    // their events. Reopening one (dock click) needs them re-armed, or the
    // file tree/git status/external-change detection in the new window would
    // just silently never update again.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      setupWatchers()
    }
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

ipcMain.handle('get-recent-external-files', () => loadRecentExternalFiles())

ipcMain.handle('touch-recent-external-file', (_, filePath) => touchRecentExternalFile(filePath))

ipcMain.handle('remove-recent-external-file', (_, filePath) => removeRecentExternalFile(filePath))

ipcMain.handle('list-path-matches', (_, rawInput) => listPathMatches(rawInput))

ipcMain.handle('read-file', async (_, filePath) => {
  return readFileContent(filePath)
})

ipcMain.handle('save-file', async (_, filePath, content) => {
  const result = writeFileContent(filePath, content)
  if (result.success) recordSelfWrite(filePath, content)
  return result
})

ipcMain.on('apply-update', () => applyUpdate())

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors)

ipcMain.handle('get-settings', () => loadSettings())

ipcMain.handle('save-settings', (_, settings: AppSettings) => {
  saveSettings(settings)
  return settings
})

ipcMain.handle('get-open-tabs', () => loadOpenTabsState())

ipcMain.handle('save-open-tabs', (_, state: OpenTabsState) => {
  saveOpenTabsState(state)
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

// Git IPC Handlers
const refreshedStatuses = (): ReturnType<typeof getAllRepoStatuses> =>
  getAllRepoStatuses(loadWorkspaces())

ipcMain.handle('git-status', async () => {
  if (!loadSettings().gitEnabled) return []
  return refreshedStatuses()
})

ipcMain.handle('git-diff', async (_, root: string, relPath: string) => {
  return getDiff(root, relPath)
})

ipcMain.handle('git-stage', async (_, root: string, relPaths: string[]) => {
  const result = await stagePaths(root, relPaths)
  return { ...result, statuses: await refreshedStatuses() }
})

ipcMain.handle('git-unstage', async (_, root: string, relPaths: string[]) => {
  const result = await unstagePaths(root, relPaths)
  return { ...result, statuses: await refreshedStatuses() }
})

ipcMain.handle('git-discard', async (_, root: string, relPath: string) => {
  const result = await discardPath(root, relPath)
  return { ...result, statuses: await refreshedStatuses() }
})

ipcMain.handle(
  'git-commit',
  async (_, root: string, message: string, relPaths: string[], amend: boolean) => {
    const result = await gitCommit(root, message, relPaths, amend)
    return { ...result, statuses: await refreshedStatuses() }
  }
)

ipcMain.handle('git-last-commit-message', async (_, root: string) => {
  return lastCommitMessage(root)
})

ipcMain.handle('git-push', async (_, root: string) => {
  return gitPush(root)
})

ipcMain.handle('git-pull', async (_, root: string) => {
  const result = await gitPull(root)
  return { ...result, statuses: await refreshedStatuses() }
})

// Diagnostics IPC Handlers
ipcMain.handle('lint-python', async (_, absPath: string) => {
  if (!loadSettings().diagnosticsEnabled) return null
  return lintPython(absPath)
})

ipcMain.handle('lint-eslint', async (_, absPath: string, workspaceRoot: string) => {
  if (!loadSettings().diagnosticsEnabled) return []
  return lintEslint(absPath, workspaceRoot)
})

ipcMain.handle('translate-google-web', (_, text: string, from: string, to: string) =>
  googleWebTranslate(text, from, to)
)
