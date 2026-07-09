import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'

const shellExec = process.env[process.platform === 'win32' ? 'COMSPEC' : 'SHELL'] || '/bin/zsh'

const ptys = new Map<string, pty.IPty>()
let ptyIdCounter = 0

// Bound to a specific window since PTY output needs to be sent back to it.
export function registerCreatePtyHandler(mainWindow: BrowserWindow): void {
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

export function killAllPtys(): void {
  ptys.forEach((p) => p.kill())
  ptys.clear()
}
