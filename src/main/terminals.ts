import { BrowserWindow } from 'electron'
import os from 'os'
import * as pty from 'node-pty'
import { handleInvoke, handleSend } from './ipc'
import { pathDenial } from './pathAccess'

const shellExec =
  process.env[process.platform === 'win32' ? 'COMSPEC' : 'SHELL'] ||
  (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

const ptys = new Map<string, pty.IPty>()
let ptyIdCounter = 0

// Resolves to whichever window is currently "the" main window at the time a
// PTY event fires - not fixed at creation time. On macOS the app (and its
// PTYs/terminals) outlives any single window: closing the window and
// reopening one (dock click) must keep delivering output to the new window,
// not the destroyed one a handler was originally bound to.
let getMainWindow: () => BrowserWindow | null = () => null

// Registered once for the app's lifetime (not per-window) - re-registering
// ipcMain.handle for the same channel throws, and rebinding it to whatever
// window existed at the time would silently orphan PTYs across a
// close-then-reopen cycle on macOS.
export function registerCreatePtyHandler(windowProvider: () => BrowserWindow | null): void {
  getMainWindow = windowProvider

  handleInvoke('create-pty', (cwd) => {
    // A login shell in an arbitrary directory is the most valuable thing the
    // filesystem IPC could hand out (docs/BUGS.md §2), so an unknown cwd is
    // refused outright rather than quietly falling back to $HOME - a silent
    // fallback would look like the terminal opened "somewhere else" instead
    // of saying what happened.
    const denial = pathDenial(cwd)
    if (denial) throw new Error(denial)

    const termId = `term-${ptyIdCounter++}`

    const shellArgs = process.platform === 'win32' ? [] : ['-l']
    const ptyProcess = pty.spawn(shellExec, shellArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: cwd || os.homedir(),
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty-data-${termId}`, data)
      }
    })

    ptyProcess.onExit(() => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty-exit-${termId}`)
      }
      ptys.delete(termId)
    })

    ptys.set(termId, ptyProcess)
    return termId
  })
}

handleSend('pty-write', (_event, termId, data) => {
  ptys.get(termId)?.write(data)
})

handleSend('pty-resize', (_event, termId, cols, rows) => {
  try {
    ptys.get(termId)?.resize(cols, rows)
  } catch (e) {}
})

handleSend('destroy-pty', (_event, termId) => {
  ptys.get(termId)?.kill()
  ptys.delete(termId)
})

export function killAllPtys(): void {
  ptys.forEach((p) => p.kill())
  ptys.clear()
}
