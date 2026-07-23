import type { AppSettings } from './settings'
import type { OpenTabsState } from './openTabsState'
import type { FileNode } from './fileNode'
import type { SearchResult } from './searchResult'
import type { GitCommit, GitRepoStatus } from './gitStatus'
import type { GTask, GTaskInput, GTaskList } from './googleTasks'
import type { LintMarker } from './lint'
import type { RecentExternalFile } from './recentExternalFile'
import type { PathListingResult } from './pathMatch'
import type { MenuAction } from './menuAction'
import type { UpdateNotification } from './updateNotification'
import type {
  WorkTogetherLink,
  WorkTogetherLinkRole,
  WorkTogetherResult,
  WorkTogetherSession,
  WorkTogetherSessionStatus,
  WorkTogetherResumeState
} from './workTogether'

// The single source of truth for every IPC channel: its name, its arguments,
// and its result type. main registers handlers against these contracts
// (src/main/ipc.ts), the preload script *generates* the renderer-facing
// window.api from the method->channel maps below, and window.api's type in
// the renderer is derived from the same maps - so a signature exists in
// exactly one place instead of the three hand-synced copies (main handler,
// preload wrapper, index.d.ts) this file replaced.

export interface OpResult {
  success: boolean
  error?: string
}

export interface FileReadResult extends OpResult {
  content?: string
}

// rename/create/copy/move/delete of a tree entry. On success carries the
// rebuilt workspace trees so the renderer doesn't need a second round-trip.
export interface PathOpResult extends OpResult {
  newPath?: string
  trees?: FileNode[]
}

// stage/unstage/discard/commit: success flag plus the post-operation repo
// statuses, again to save the immediate follow-up status call.
export interface GitMutationResult extends OpResult {
  statuses: GitRepoStatus[]
}

// push/pull/checkout surface git's own stdout/stderr - auth errors and
// non-fast-forward messages are outcomes the user needs to read, not just a
// boolean.
export interface GitCombinedResult {
  success: boolean
  output: string
}

export type GTasksResult<T> = { success: true; data: T } | { success: false; error: string }

export interface GTasksAddAccountResult extends OpResult {
  email?: string
}

export interface TranslateResult extends OpResult {
  text?: string
}

export type GTaskUpdateInput = Partial<GTaskInput> & { status?: 'needsAction' | 'completed' }

// ---------------------------------------------------------------------------
// invoke (renderer -> main -> renderer)

export interface InvokeContracts {
  'get-app-version': { args: []; result: string }
  'get-workspaces': { args: []; result: FileNode[] }
  // null when the user cancels the folder picker.
  'add-workspace': { args: []; result: FileNode[] | null }
  'remove-workspace': { args: [path: string]; result: FileNode[] }
  'search-projects': { args: [query: string]; result: SearchResult[] }
  'get-recent-external-files': { args: []; result: RecentExternalFile[] }
  'touch-recent-external-file': { args: [filePath: string]; result: RecentExternalFile[] }
  'remove-recent-external-file': { args: [filePath: string]; result: RecentExternalFile[] }
  'list-path-matches': { args: [rawInput: string]; result: PathListingResult }
  'read-file': { args: [path: string]; result: FileReadResult }
  'save-file': { args: [path: string, content: string]; result: OpResult }
  'rename-path': { args: [oldPath: string, newName: string]; result: PathOpResult }
  'create-path': {
    args: [parentPath: string, name: string, type: 'file' | 'directory']
    result: PathOpResult
  }
  'copy-path': { args: [sourcePath: string, targetDirPath: string]; result: PathOpResult }
  'delete-path': { args: [targetPath: string]; result: PathOpResult }
  'move-path': { args: [sourcePath: string, targetDirPath: string]; result: PathOpResult }
  'get-theme': { args: []; result: boolean }
  'get-settings': { args: []; result: AppSettings }
  'save-settings': { args: [settings: AppSettings]; result: AppSettings }
  'get-open-tabs': { args: []; result: OpenTabsState }
  'save-open-tabs': { args: [state: OpenTabsState]; result: void }
  'create-pty': { args: [cwd?: string]; result: string }
  'git-status': { args: []; result: GitRepoStatus[] }
  'git-diff': {
    args: [root: string, relPath: string]
    result: { original: string; modified: string }
  }
  'git-stage': { args: [root: string, relPaths: string[]]; result: GitMutationResult }
  'git-unstage': { args: [root: string, relPaths: string[]]; result: GitMutationResult }
  'git-discard': { args: [root: string, relPath: string]; result: GitMutationResult }
  'git-commit': {
    args: [root: string, message: string, relPaths: string[], amend: boolean]
    result: GitMutationResult
  }
  'git-last-commit-message': { args: [root: string]; result: string }
  'git-push': { args: [root: string]; result: GitCombinedResult }
  'git-pull': {
    args: [root: string]
    result: GitCombinedResult & { statuses: GitRepoStatus[] }
  }
  'git-log': { args: [root: string, limit: number, skip: number]; result: GitCommit[] }
  'git-branches': { args: [root: string]; result: string[] }
  'git-checkout': {
    args: [root: string, branch: string]
    result: GitCombinedResult & { statuses: GitRepoStatus[] }
  }
  'gtasks-accounts': { args: []; result: string[] }
  'gtasks-add-account': { args: []; result: GTasksAddAccountResult }
  'gtasks-remove-account': { args: [email: string]; result: void }
  'gtasks-lists': { args: [email: string]; result: GTasksResult<GTaskList[]> }
  'gtasks-tasks': { args: [email: string, listId: string]; result: GTasksResult<GTask[]> }
  'gtasks-create-task': {
    args: [email: string, listId: string, input: GTaskInput]
    result: GTasksResult<GTask>
  }
  'gtasks-update-task': {
    args: [email: string, listId: string, taskId: string, input: GTaskUpdateInput]
    result: GTasksResult<GTask>
  }
  'gtasks-move-task': {
    args: [
      email: string,
      listId: string,
      taskId: string,
      previousTaskId?: string,
      destinationListId?: string
    ]
    result: GTasksResult<GTask>
  }
  'lint-python': { args: [absPath: string]; result: LintMarker | null }
  'lint-eslint': { args: [absPath: string, workspaceRoot: string]; result: LintMarker[] }
  'translate-google-web': {
    args: [text: string, from: string, to: string]
    result: TranslateResult
  }
  'work-together-create-session': {
    args: [
      backendUrl: string,
      filePath: string,
      language: string,
      content: string,
      maxTtlSeconds: number
    ]
    result: WorkTogetherResult<WorkTogetherSession>
  }
  'work-together-mint-link': {
    args: [
      backendUrl: string,
      sessionId: string,
      hostToken: string,
      role: WorkTogetherLinkRole,
      ttlSeconds: number
    ]
    result: WorkTogetherResult<WorkTogetherLink>
  }
  'work-together-revoke-link': {
    args: [backendUrl: string, sessionId: string, hostToken: string, linkId: string]
    result: WorkTogetherResult<void>
  }
  'work-together-end-session': {
    args: [backendUrl: string, sessionId: string, hostToken: string]
    result: WorkTogetherResult<void>
  }
  'work-together-get-status': {
    args: [backendUrl: string, sessionId: string, hostToken: string]
    result: WorkTogetherResult<WorkTogetherSessionStatus>
  }
  // Opens (or replaces) the main-process WebSocket relay for this session;
  // resolves once the socket is open or has failed/timed out, so the
  // renderer knows whether it's safe to start sending sync/awareness frames.
  'work-together-connect': {
    args: [sessionId: string, backendUrl: string, token: string]
    result: { success: boolean; error?: string }
  }
  'work-together-send': {
    args: [sessionId: string, data: Uint8Array]
    result: void
  }
  'work-together-disconnect': {
    args: [sessionId: string]
    result: void
  }
  // Sessions still live when the Host last quit/reloaded, so they can be
  // reconnected to (not re-created) on next launch - see
  // shared/workTogether.ts's WorkTogetherResumableSession doc comment.
  'get-work-together-resume-state': { args: []; result: WorkTogetherResumeState }
  'save-work-together-resume-state': { args: [state: WorkTogetherResumeState]; result: void }
}

// window.api method name -> invoke channel.
export const INVOKE_CHANNELS = {
  getAppVersion: 'get-app-version',
  getWorkspaces: 'get-workspaces',
  addWorkspace: 'add-workspace',
  removeWorkspace: 'remove-workspace',
  searchProjects: 'search-projects',
  getRecentExternalFiles: 'get-recent-external-files',
  touchRecentExternalFile: 'touch-recent-external-file',
  removeRecentExternalFile: 'remove-recent-external-file',
  listPathMatches: 'list-path-matches',
  readFile: 'read-file',
  saveFile: 'save-file',
  renamePath: 'rename-path',
  createPath: 'create-path',
  copyPath: 'copy-path',
  deletePath: 'delete-path',
  movePath: 'move-path',
  getTheme: 'get-theme',
  getSettings: 'get-settings',
  saveSettings: 'save-settings',
  getOpenTabs: 'get-open-tabs',
  saveOpenTabs: 'save-open-tabs',
  createPty: 'create-pty',
  getGitStatus: 'git-status',
  getGitDiff: 'git-diff',
  gitStage: 'git-stage',
  gitUnstage: 'git-unstage',
  gitDiscard: 'git-discard',
  gitCommit: 'git-commit',
  gitLastCommitMessage: 'git-last-commit-message',
  gitPush: 'git-push',
  gitPull: 'git-pull',
  gitLog: 'git-log',
  gitBranches: 'git-branches',
  gitCheckout: 'git-checkout',
  gtasksAccounts: 'gtasks-accounts',
  gtasksAddAccount: 'gtasks-add-account',
  gtasksRemoveAccount: 'gtasks-remove-account',
  gtasksLists: 'gtasks-lists',
  gtasksTasks: 'gtasks-tasks',
  gtasksCreateTask: 'gtasks-create-task',
  gtasksUpdateTask: 'gtasks-update-task',
  gtasksMoveTask: 'gtasks-move-task',
  lintPython: 'lint-python',
  lintEslint: 'lint-eslint',
  translateGoogleWeb: 'translate-google-web',
  workTogetherCreateSession: 'work-together-create-session',
  workTogetherMintLink: 'work-together-mint-link',
  workTogetherRevokeLink: 'work-together-revoke-link',
  workTogetherEndSession: 'work-together-end-session',
  workTogetherGetStatus: 'work-together-get-status',
  workTogetherConnect: 'work-together-connect',
  workTogetherSend: 'work-together-send',
  workTogetherDisconnect: 'work-together-disconnect',
  getWorkTogetherResumeState: 'get-work-together-resume-state',
  saveWorkTogetherResumeState: 'save-work-together-resume-state'
} as const satisfies Record<string, keyof InvokeContracts>

// ---------------------------------------------------------------------------
// send (renderer -> main, fire-and-forget)

export interface SendContracts {
  'reveal-in-finder': [targetPath: string]
  'confirm-close': []
  'decline-close': []
  'renderer-ready': []
  'apply-update': []
  'destroy-pty': [termId: string]
  'pty-write': [termId: string, data: string]
  'pty-resize': [termId: string, cols: number, rows: number]
}

export const SEND_CHANNELS = {
  revealInFinder: 'reveal-in-finder',
  confirmClose: 'confirm-close',
  declineClose: 'decline-close',
  notifyRendererReady: 'renderer-ready',
  applyUpdate: 'apply-update',
  destroyPty: 'destroy-pty',
  ptyWrite: 'pty-write',
  ptyResize: 'pty-resize'
} as const satisfies Record<string, keyof SendContracts>

// ---------------------------------------------------------------------------
// events (main -> renderer). The per-terminal pty-data-<id>/pty-exit-<id>
// channels are dynamic and stay hand-written in the preload script.

export interface EventContracts {
  'theme-updated': [isDark: boolean]
  'workspaces-changed': [trees: FileNode[]]
  'file-changed-externally': [path: string]
  'open-file-request': [path: string]
  'request-close': []
  'menu-action': [action: MenuAction]
  'update-notification': [update: UpdateNotification]
  'git-status-changed': [statuses: GitRepoStatus[]]
}

export const EVENT_CHANNELS = {
  onThemeUpdated: 'theme-updated',
  onWorkspacesChanged: 'workspaces-changed',
  onFileChangedExternally: 'file-changed-externally',
  onOpenFileRequest: 'open-file-request',
  onRequestClose: 'request-close',
  onMenuAction: 'menu-action',
  onUpdateNotification: 'update-notification',
  onGitStatusChanged: 'git-status-changed'
} as const satisfies Record<string, keyof EventContracts>

// ---------------------------------------------------------------------------
// The renderer-facing window.api shape, derived from the maps above.

export type Unsubscribe = () => void

export type InvokeApi = {
  [M in keyof typeof INVOKE_CHANNELS]: (
    ...args: InvokeContracts[(typeof INVOKE_CHANNELS)[M]]['args']
  ) => Promise<InvokeContracts[(typeof INVOKE_CHANNELS)[M]]['result']>
}

export type SendApi = {
  [M in keyof typeof SEND_CHANNELS]: (...args: SendContracts[(typeof SEND_CHANNELS)[M]]) => void
}

export type EventApi = {
  [M in keyof typeof EVENT_CHANNELS]: (
    callback: (...args: EventContracts[(typeof EVENT_CHANNELS)[M]]) => void
  ) => Unsubscribe
}

// getPathForFile is appended where the DOM `File` type exists
// (src/preload/index.d.ts) - shared code compiles under the node tsconfig too.
export type AuraPadApi = InvokeApi &
  SendApi &
  EventApi & {
    onPtyData: (termId: string, callback: (data: string) => void) => Unsubscribe
    onPtyExit: (termId: string, callback: () => void) => Unsubscribe
    // Per-session, dynamic like the pty channels above: one binary Yjs
    // sync/awareness/control frame per event (see specification.md §4-5),
    // and the close code/reason once the backend drops the connection.
    onWorkTogetherMessage: (sessionId: string, callback: (data: Uint8Array) => void) => Unsubscribe
    onWorkTogetherClosed: (
      sessionId: string,
      callback: (code: number, reason: string) => void
    ) => Unsubscribe
  }
