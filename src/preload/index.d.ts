import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppSettings } from '../shared/settings'
import type { FileNode } from '../shared/fileNode'
import type { SearchResult } from '../shared/searchResult'
import type { GitRepoStatus } from '../shared/gitStatus'
import type { LintMarker } from '../shared/lint'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getWorkspaces: () => Promise<FileNode[]>
      addWorkspace: () => Promise<FileNode[]>
      removeWorkspace: (path: string) => Promise<FileNode[]>
      searchProjects: (query: string) => Promise<SearchResult[]>

      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
      saveFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
      renamePath: (
        oldPath: string,
        newName: string
      ) => Promise<{ success: boolean; newPath?: string; trees?: FileNode[]; error?: string }>
      createPath: (
        parentPath: string,
        name: string,
        type: 'file' | 'directory'
      ) => Promise<{ success: boolean; newPath?: string; trees?: FileNode[]; error?: string }>
      movePath: (
        sourcePath: string,
        targetDirPath: string
      ) => Promise<{ success: boolean; newPath?: string; trees?: FileNode[]; error?: string }>
      copyPath: (
        sourcePath: string,
        targetDirPath: string
      ) => Promise<{ success: boolean; newPath?: string; trees?: FileNode[]; error?: string }>
      deletePath: (
        targetPath: string
      ) => Promise<{ success: boolean; trees?: FileNode[]; error?: string }>

      getTheme: () => Promise<boolean>
      onThemeUpdated: (callback: (isDark: boolean) => void) => () => void

      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: AppSettings) => Promise<AppSettings>
      onWorkspacesChanged: (callback: (trees: FileNode[]) => void) => () => void
      onFileChangedExternally: (callback: (path: string) => void) => () => void
      onOpenFileRequest: (callback: (path: string) => void) => () => void

      createPty: (cwd?: string) => Promise<string>
      destroyPty: (termId: string) => void
      ptyWrite: (termId: string, data: string) => void
      ptyResize: (termId: string, cols: number, rows: number) => void
      onPtyData: (termId: string, callback: (data: string) => void) => () => void
      onPtyExit: (termId: string, callback: () => void) => () => void

      getGitStatus: () => Promise<GitRepoStatus[]>
      getGitDiff: (root: string, relPath: string) => Promise<{ original: string; modified: string }>
      gitStage: (
        root: string,
        relPath: string
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitUnstage: (
        root: string,
        relPath: string
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitDiscard: (
        root: string,
        relPath: string
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitCommit: (
        root: string,
        message: string
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitPush: (root: string) => Promise<{ success: boolean; output: string }>
      gitPull: (
        root: string
      ) => Promise<{ success: boolean; output: string; statuses: GitRepoStatus[] }>
      onGitStatusChanged: (callback: (statuses: GitRepoStatus[]) => void) => () => void

      lintPython: (absPath: string) => Promise<LintMarker | null>
      lintEslint: (absPath: string, workspaceRoot: string) => Promise<LintMarker[]>

      getPathForFile: (file: File) => string
    }
  }
}
