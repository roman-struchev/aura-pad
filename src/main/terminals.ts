import { BrowserWindow, type WebContents } from 'electron'
import os from 'os'
import * as pty from 'node-pty'
import { handleInvokeWithEvent, handleSend } from './ipc'
import { pathDenial } from './pathAccess'

const shellExec =
  process.env[process.platform === 'win32' ? 'COMSPEC' : 'SHELL'] ||
  (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

// Each pty belongs to the window that asked for it: with more than one window
// open, output from a terminal in one must not be delivered to (or killed by a
// reload of) another. The id of the owning webContents is enough - the window
// object itself is looked up when there is something to send, so a
// close-and-reopen cycle can't leave a destroyed window captured here.
interface OwnedPty {
  process: pty.IPty
  ownerId: number
}
const ptys = new Map<string, OwnedPty>()
let ptyIdCounter = 0

function sendToOwner(ownerId: number, channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && w.webContents.id === ownerId
  )
  if (win) win.webContents.send(channel, ...args)
}

export function registerCreatePtyHandler(): void {
  handleInvokeWithEvent('create-pty', (event, cwd) => {
    // A login shell in an arbitrary directory is the most valuable thing the
    // filesystem IPC could hand out (docs/BUGS.md §2), so an unknown cwd is
    // refused outright rather than quietly falling back to $HOME - a silent
    // fallback would look like the terminal opened "somewhere else" instead
    // of saying what happened.
    const denial = pathDenial(cwd)
    if (denial) throw new Error(denial)

    const termId = `term-${ptyIdCounter++}`
    const ownerId = event.sender.id

    const shellArgs = process.platform === 'win32' ? [] : ['-l']
    const ptyProcess = pty.spawn(shellExec, shellArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: cwd || os.homedir(),
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => sendToOwner(ownerId, `pty-data-${termId}`, data))

    ptyProcess.onExit(() => {
      sendToOwner(ownerId, `pty-exit-${termId}`)
      ptys.delete(termId)
    })

    ptys.set(termId, { process: ptyProcess, ownerId })
    return termId
  })
}

handleSend('pty-write', (_event, termId, data) => {
  ptys.get(termId)?.process.write(data)
})

handleSend('pty-resize', (_event, termId, cols, rows) => {
  try {
    ptys.get(termId)?.process.resize(cols, rows)
  } catch {
    // A pty that exited between the renderer's resize and this call.
  }
})

handleSend('destroy-pty', (_event, termId) => {
  ptys.get(termId)?.process.kill()
  ptys.delete(termId)
})

// A reload wipes one window's terminal state; the shells it owned would
// otherwise keep running headless. Other windows' terminals are untouched.
export function killPtysOf(sender: WebContents): void {
  for (const [termId, owned] of [...ptys]) {
    if (owned.ownerId !== sender.id) continue
    owned.process.kill()
    ptys.delete(termId)
  }
}

export function killAllPtys(): void {
  ptys.forEach((owned) => owned.process.kill())
  ptys.clear()
}
