import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import path from 'path'
import * as pty from 'node-pty'

// Detect shell
const shellExec = process.env[process.platform === 'win32' ? 'COMSPEC' : 'SHELL'] || '/bin/zsh'

// Store multiple PTY processes
const ptys = new Map<string, pty.IPty>()
let ptyIdCounter = 0

// Workspace management
const userDataPath = app.getPath('userData')
const workspacesConfigPath = path.join(userDataPath, 'workspaces.json')

function loadWorkspaces(): string[] {
  try {
    if (fs.existsSync(workspacesConfigPath)) {
      return JSON.parse(fs.readFileSync(workspacesConfigPath, 'utf-8'))
    }
  } catch(e) {}
  return []
}

function saveWorkspaces(paths: string[]) {
  try {
    fs.writeFileSync(workspacesConfigPath, JSON.stringify(paths))
  } catch(e) {}
}

// Helper to check if a directory should be ignored
function isIgnored(name: string) {
  // Ignore hidden folders (starting with .) and common system/build folders
  return name.startsWith('.') || [
    'node_modules', 
    'dist', 
    'out', 
    'build', 
    'target', 
    'venv', 
    '.venv', 
    '__pycache__',
    'package-lock.json',
    'yarn.lock'
  ].includes(name);
}

function buildFileTree(dirPath: string, isRoot = false): any {
  const name = path.basename(dirPath)
  const item: any = { name, path: dirPath, type: 'directory', children: [], isRoot }
  
  try {
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      if (file === '.git' || file === '.DS_Store' || isIgnored(file)) continue
      
      const fullPath = path.join(dirPath, file)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          item.children.push(buildFileTree(fullPath))
        } else {
          item.children.push({ name: file, path: fullPath, type: 'file' })
        }
      } catch (e) {}
    }
    item.children.sort((a: any, b: any) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === 'directory' ? -1 : 1
    })
  } catch (e) {}
  
  return item
}

function getWorkspaceTrees() {
  const paths = loadWorkspaces()
  const trees: any[] = []
  for (const p of paths) {
    if (fs.existsSync(p)) {
      trees.push(buildFileTree(p, true))
    }
  }
  return trees
}

// Global Search Implementation
async function searchInWorkspaces(query: string) {
  const workspacePaths = loadWorkspaces()
  const results: any[] = []
  if (!query || query.length < 2) return results

  const queryLower = query.toLowerCase()

  for (const rootPath of workspacePaths) {
    if (!fs.existsSync(rootPath)) continue
    
    const searchRecursive = (currentPath: string) => {
      try {
        const files = fs.readdirSync(currentPath)
        for (const file of files) {
          if (isIgnored(file)) continue;
          
          const fullPath = path.join(currentPath, file)
          const stat = fs.statSync(fullPath)
          
          if (stat.isDirectory()) {
            searchRecursive(fullPath)
          } else {
            // Only search in text-like files
            if (/\.(py|json|md|txt|ts|tsx|js|jsx|css|html|yml|yaml|xml)$/i.test(file)) {
              const content = fs.readFileSync(fullPath, 'utf-8')
              if (content.toLowerCase().includes(queryLower)) {
                const lines = content.split('\n')
                lines.forEach((line, index) => {
                  if (line.toLowerCase().includes(queryLower)) {
                    results.push({
                      file: file,
                      path: fullPath,
                      line: index + 1,
                      content: line.trim()
                    })
                  }
                })
              }
            }
          }
          if (results.length > 500) return // Cap results
        }
      } catch (e) {}
    }
    searchRecursive(rootPath)
  }
  return results
}

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

  // Multi-terminal PTY handlers
  ipcMain.handle('create-pty', (_event, cwd?: string) => {
    const termId = `term-${ptyIdCounter++}`
    
    const shellArgs = process.platform === 'win32' ? [] : ['-l']
    const ptyProcess = pty.spawn(shellExec, shellArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: cwd || process.env.HOME,
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`pty-data-${termId}`, data)
      }
    })

    ptyProcess.onExit(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`pty-exit-${termId}`)
      }
      ptys.delete(termId)
    })

    ptys.set(termId, ptyProcess)
    return termId
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.struchev.aura')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptys.forEach(p => p.kill())
  ptys.clear()
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
  }
  
  return getWorkspaceTrees()
})

ipcMain.handle('remove-workspace', (_, pathToRemove) => {
  let paths = loadWorkspaces()
  paths = paths.filter(p => p !== pathToRemove)
  saveWorkspaces(paths)
  return getWorkspaceTrees()
})

ipcMain.handle('search-projects', async (_, query) => {
  return await searchInWorkspaces(query)
})

ipcMain.handle('read-file', async (_, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return { success: true, content }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('save-file', async (_, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('rename-path', async (_, oldPath: string, newName: string) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName)
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with this name already exists' }
    }
    fs.renameSync(oldPath, newPath)

    // Keep workspace roots in sync if a root folder was renamed
    const workspacePaths = loadWorkspaces()
    const idx = workspacePaths.indexOf(oldPath)
    if (idx !== -1) {
      workspacePaths[idx] = newPath
      saveWorkspaces(workspacePaths)
    }

    return { success: true, newPath, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('create-path', async (_, parentPath: string, name: string, type: 'file' | 'directory') => {
  try {
    const newPath = path.join(parentPath, name)
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with this name already exists' }
    }
    if (type === 'directory') {
      fs.mkdirSync(newPath)
    } else {
      fs.writeFileSync(newPath, '')
    }
    return { success: true, newPath, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('move-path', async (_, sourcePath: string, targetDirPath: string) => {
  try {
    const sourceParent = path.dirname(sourcePath)
    if (sourcePath === targetDirPath || sourceParent === targetDirPath) {
      return { success: true, newPath: sourcePath, trees: getWorkspaceTrees() }
    }

    // Prevent moving a folder into itself or one of its own descendants
    const rel = path.relative(sourcePath, targetDirPath)
    if (rel === '' || !rel.startsWith('..')) {
      return { success: false, error: 'Cannot move a folder into itself or its subfolder' }
    }

    const newPath = path.join(targetDirPath, path.basename(sourcePath))
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with this name already exists in the destination' }
    }
    fs.renameSync(sourcePath, newPath)

    // Keep workspace roots in sync if a root folder was moved
    const workspacePaths = loadWorkspaces()
    const idx = workspacePaths.indexOf(sourcePath)
    if (idx !== -1) {
      workspacePaths[idx] = newPath
      saveWorkspaces(workspacePaths)
    }

    return { success: true, newPath, trees: getWorkspaceTrees() }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// Terminal action handlers
ipcMain.on('pty-write', (_, termId, data) => {
  ptys.get(termId)?.write(data)
})

ipcMain.on('pty-resize', (_, termId, cols, rows) => {
  try {
    ptys.get(termId)?.resize(cols, rows)
  } catch (e) {}
})

ipcMain.on('destroy-pty', (_, termId) => {
  ptys.get(termId)?.kill()
  ptys.delete(termId)
})
