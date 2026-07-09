import { ElectronAPI } from '@electron-toolkit/preload'

interface AppSettings {
  tabsEnabled: boolean
  autosaveEnabled: boolean
  uiMode: 'micro' | 'compact' | 'normal' | 'large'
}

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
      copyPath: (sourcePath: string, targetDirPath: string) => Promise<{success: boolean, newPath?: string, trees?: any[], error?: string}>
      deletePath: (targetPath: string) => Promise<{success: boolean, trees?: any[], error?: string}>

      getTheme: () => Promise<boolean>
      onThemeUpdated: (callback: (isDark: boolean) => void) => () => void

      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: AppSettings) => Promise<AppSettings>
      onWorkspacesChanged: (callback: (trees: any[]) => void) => () => void
      onFileChangedExternally: (callback: (path: string) => void) => () => void
      
      createPty: (cwd?: string) => Promise<string>
      destroyPty: (termId: string) => void
      ptyWrite: (termId: string, data: string) => void
      ptyResize: (termId: string, cols: number, rows: number) => void
      onPtyData: (termId: string, callback: (data: string) => void) => () => void
      onPtyExit: (termId: string, callback: () => void) => () => void
    }
  }
}
