import { ElectronAPI } from '@electron-toolkit/preload'
import type { AuraPadApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    // The full api surface lives in shared/ipc.ts (single source of truth
    // for channels, arguments and results). getPathForFile is appended here
    // because the DOM `File` type doesn't exist under the node tsconfig that
    // also compiles src/shared.
    api: AuraPadApi & { getPathForFile: (file: File) => string }
  }
}
