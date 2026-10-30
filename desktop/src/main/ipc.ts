import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { InvokeContracts, SendContracts } from '../shared/ipc'

// Thin typed shims over ipcMain: the channel name picks its contract from
// shared/ipc.ts, so a handler whose arguments or result drift from what the
// preload-generated window.api sends/expects fails to compile instead of
// failing at runtime.

export function handleInvoke<C extends keyof InvokeContracts>(
  channel: C,
  handler: (
    ...args: InvokeContracts[C]['args']
  ) => InvokeContracts[C]['result'] | Promise<InvokeContracts[C]['result']>
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as InvokeContracts[C]['args'])))
}

// The invoke form that needs to know which window asked - a pty belongs to the
// window that created it, not to "the" window, so its output keeps going to the
// right renderer once there is more than one.
export function handleInvokeWithEvent<C extends keyof InvokeContracts>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: InvokeContracts[C]['args']
  ) => InvokeContracts[C]['result'] | Promise<InvokeContracts[C]['result']>
): void {
  ipcMain.handle(channel, (event, ...args) =>
    handler(event, ...(args as InvokeContracts[C]['args']))
  )
}

// The raw event stays available (first parameter) - a few handlers need
// event.sender to find their window.
export function handleSend<C extends keyof SendContracts>(
  channel: C,
  handler: (event: IpcMainEvent, ...args: SendContracts[C]) => void
): void {
  ipcMain.on(channel, (event, ...args) => handler(event, ...(args as SendContracts[C])))
}
