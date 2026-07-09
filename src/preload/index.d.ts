import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getWorkspaces: () => Promise<any[]>
      addWorkspace: () => Promise<any[]>
      removeWorkspace: (path: string) => Promise<any[]>
      searchProjects: (query: string) => Promise<any[]>
      
      readFile: (path: string) => Promise<{success: boolean, content?: string, error?: string}>
      saveFile: (path: string, content: string) => Promise<{success: boolean, error?: string}>
      renamePath: (oldPath: string, newName: string) => Promise<{success: boolean, newPath?: string, trees?: any[], error?: string}>
      createPath: (parentPath: string, name: string, type: 'file' | 'directory') => Promise<{success: boolean, newPath?: string, trees?: any[], error?: string}>
      movePath: (sourcePath: string, targetDirPath: string) => Promise<{success: boolean, newPath?: string, trees?: any[], error?: string}>
      
      createPty: (cwd?: string) => Promise<string>
      destroyPty: (termId: string) => void
      ptyWrite: (termId: string, data: string) => void
      ptyResize: (termId: string, cols: number, rows: number) => void
      onPtyData: (termId: string, callback: (data: string) => void) => () => void
      onPtyExit: (termId: string, callback: () => void) => () => void
    }
  }
}
