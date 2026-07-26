import { contextBridge, ipcRenderer, webUtils } from 'electron'
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
//
// Nothing else is exposed on purpose: @electron-toolkit/preload's generic
// `electronAPI` bridge (which used to be published as window.electron) hands
// the page an unrestricted ipcRenderer - invoke/send/on for *any* channel,
// bypassing the typed contracts below and reachable by any script that gets
// to run in this renderer (e.g. from the HTML preview). The only thing it was
// actually used for was process.platform, which is now a plain value on the
// api object.

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

const api: AuraPadApi & {
  getPathForFile: (file: File) => string
  platform: NodeJS.Platform
} = {
  ...buildInvokeApi(),
  ...buildSendApi(),
  ...buildEventApi(),

  platform: process.platform,

  onPtyData: (termId: string, callback: (data: string) => void) =>
    subscribe(`pty-data-${termId}`, callback as (...args: unknown[]) => void),
  onPtyExit: (termId: string, callback: () => void) => subscribe(`pty-exit-${termId}`, callback),

  onWorkTogetherMessage: (sessionId: string, callback: (data: Uint8Array) => void) =>
    subscribe(`work-together-message-${sessionId}`, callback as (...args: unknown[]) => void),
  onWorkTogetherClosed: (sessionId: string, callback: (code: number, reason: string) => void) =>
    subscribe(`work-together-closed-${sessionId}`, callback as (...args: unknown[]) => void),

  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
