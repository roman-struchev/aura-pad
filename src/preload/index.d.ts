import type { AuraPadApi } from '../shared/ipc'

declare global {
  interface Window {
    // The full api surface lives in shared/ipc.ts (single source of truth
    // for channels, arguments and results). getPathForFile is appended here
    // because the DOM `File` type doesn't exist under the node tsconfig that
    // also compiles src/shared; `platform` is a plain value bridged by the
    // preload. There is deliberately no generic ipcRenderer bridge (no
    // window.electron) - see the comment in preload/index.ts.
    api: AuraPadApi & {
      getPathForFile: (file: File) => string
      platform: NodeJS.Platform
    }
  }
}
