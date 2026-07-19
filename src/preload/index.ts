import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  EVENT_CHANNELS,
  type AuraPadApi,
  type InvokeApi,
  type SendApi,
  type EventApi,
  type Unsubscribe
} from '../shared/ipc'

// window.api is generated from the channel maps in shared/ipc.ts - adding an
// IPC endpoint means adding its contract + map entry there, nothing here.
// Only the dynamic per-terminal channels and webUtils bridging are manual.

function buildInvokeApi(): InvokeApi {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const [method, channel] of Object.entries(INVOKE_CHANNELS)) {
    out[method] = (...args) => ipcRenderer.invoke(channel, ...args)
  }
  return out as unknown as InvokeApi
}

function buildSendApi(): SendApi {
  const out: Record<string, (...args: unknown[]) => void> = {}
  for (const [method, channel] of Object.entries(SEND_CHANNELS)) {
    out[method] = (...args) => ipcRenderer.send(channel, ...args)
  }
  return out as unknown as SendApi
}

function subscribe(channel: string, callback: (...args: unknown[]) => void): Unsubscribe {
  const listener = (_event: unknown, ...args: unknown[]): void => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function buildEventApi(): EventApi {
  const out: Record<string, (callback: (...args: unknown[]) => void) => Unsubscribe> = {}
  for (const [method, channel] of Object.entries(EVENT_CHANNELS)) {
    out[method] = (callback) => subscribe(channel, callback)
  }
  return out as unknown as EventApi
}

const api: AuraPadApi & { getPathForFile: (file: File) => string } = {
  ...buildInvokeApi(),
  ...buildSendApi(),
  ...buildEventApi(),

  onPtyData: (termId: string, callback: (data: string) => void) =>
    subscribe(`pty-data-${termId}`, callback as (...args: unknown[]) => void),
  onPtyExit: (termId: string, callback: () => void) => subscribe(`pty-exit-${termId}`, callback),

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
