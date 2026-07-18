import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppSettings } from '../shared/settings'
import type { OpenTabsState } from '../shared/openTabsState'
import type { FileNode } from '../shared/fileNode'
import type { SearchResult } from '../shared/searchResult'
import type { GitCommit, GitRepoStatus } from '../shared/gitStatus'
import type { LintMarker } from '../shared/lint'
import type { RecentExternalFile } from '../shared/recentExternalFile'
import type { PathListingResult } from '../shared/pathMatch'
import type { MenuAction } from '../shared/menuAction'
import type { UpdateNotification } from '../shared/updateNotification'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getAppVersion: () => Promise<string>
      getWorkspaces: () => Promise<FileNode[]>
      addWorkspace: () => Promise<FileNode[]>
      removeWorkspace: (path: string) => Promise<FileNode[]>
      searchProjects: (query: string) => Promise<SearchResult[]>

      getRecentExternalFiles: () => Promise<RecentExternalFile[]>
      touchRecentExternalFile: (filePath: string) => Promise<RecentExternalFile[]>
      removeRecentExternalFile: (filePath: string) => Promise<RecentExternalFile[]>
      listPathMatches: (rawInput: string) => Promise<PathListingResult>

      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
      saveFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
      renamePath: (
        oldPath: string,
        newName: string
      ) => Promise<{ success: boolean; newPath?: string; trees?: FileNode[]; error?: string }>
      revealInFinder: (path: string) => void
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

      getOpenTabs: () => Promise<OpenTabsState>
      saveOpenTabs: (state: OpenTabsState) => Promise<void>
      onWorkspacesChanged: (callback: (trees: FileNode[]) => void) => () => void
      onFileChangedExternally: (callback: (path: string) => void) => () => void
      onOpenFileRequest: (callback: (path: string) => void) => () => void
      onRequestClose: (callback: () => void) => () => void
      confirmClose: () => void
      declineClose: () => void
      notifyRendererReady: () => void
      onMenuAction: (callback: (action: MenuAction) => void) => () => void

      onUpdateNotification: (callback: (update: UpdateNotification) => void) => () => void
      applyUpdate: () => void

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
        relPaths: string[]
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitUnstage: (
        root: string,
        relPaths: string[]
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitDiscard: (
        root: string,
        relPath: string
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitCommit: (
        root: string,
        message: string,
        relPaths: string[],
        amend: boolean
      ) => Promise<{ success: boolean; error?: string; statuses: GitRepoStatus[] }>
      gitLastCommitMessage: (root: string) => Promise<string>
      gitPush: (root: string) => Promise<{ success: boolean; output: string }>
      gitPull: (
        root: string
      ) => Promise<{ success: boolean; output: string; statuses: GitRepoStatus[] }>
      gitLog: (root: string, limit: number, skip: number) => Promise<GitCommit[]>
      gitBranches: (root: string) => Promise<string[]>
      gitCheckout: (
        root: string,
        branch: string
      ) => Promise<{ success: boolean; output: string; statuses: GitRepoStatus[] }>
      onGitStatusChanged: (callback: (statuses: GitRepoStatus[]) => void) => () => void

      lintPython: (absPath: string) => Promise<LintMarker | null>
      lintEslint: (absPath: string, workspaceRoot: string) => Promise<LintMarker[]>

      translateGoogleWeb: (
        text: string,
        from: string,
        to: string
      ) => Promise<{ success: boolean; text?: string; error?: string }>

      getPathForFile: (file: File) => string
    }
  }
}
