import { app, dialog, nativeTheme, shell } from 'electron'
import { handleInvoke, handleSend } from './ipc'
import {
  loadWorkspaces,
  saveWorkspaces,
  getWorkspaceTrees,
  searchInWorkspaces,
  readFileContent,
  writeFileContent,
  renamePath,
  createPath,
  copyPath,
  deletePath,
  movePath
} from './workspaces'
import { loadSettings, saveSettings } from './settings'
import { loadOpenTabsState, saveOpenTabsState } from './openTabsState'
import { loadWorkTogetherResumeState, saveWorkTogetherResumeState } from './workTogetherResumeState'
import {
  loadRecentExternalFiles,
  touchRecentExternalFile,
  removeRecentExternalFile
} from './recentExternalFiles'
import { listPathMatches } from './pathBrowse'
import { encodeFileContent } from './encoding'
import { setupWatchers, recordSelfWrite } from './watcher'
import {
  getAllRepoStatuses,
  getDiff,
  stagePaths,
  unstagePaths,
  discardPath,
  commit as gitCommit,
  lastCommitMessage,
  push as gitPush,
  pull as gitPull,
  getLog,
  getBranches,
  checkoutBranch
} from './git'
import {
  listAccounts as gtasksListAccounts,
  addAccount as gtasksAddAccount,
  removeAccount as gtasksRemoveAccount,
  listTaskLists as gtasksListTaskLists,
  listTasks as gtasksListTasks,
  createTask as gtasksCreateTask,
  updateTask as gtasksUpdateTask,
  moveTask as gtasksMoveTask
} from './googleTasks'
import { lintPython, lintEslint } from './lint'
import { googleWebTranslate } from './translate'
import { applyUpdate } from './updater'
import {
  createSession as workTogetherCreateSession,
  mintLink as workTogetherMintLink,
  revokeLink as workTogetherRevokeLink,
  endSession as workTogetherEndSession,
  getSessionStatus as workTogetherGetSessionStatus,
  connectSession as workTogetherConnectSession,
  sendSessionMessage as workTogetherSendSessionMessage,
  disconnectSession as workTogetherDisconnectSession
} from './workTogether'

// Domain-scoped IPC registration. Window-lifecycle channels (confirm-close,
// decline-close, renderer-ready) stay in index.ts, next to the state they
// mutate; the per-terminal pty channels stay in terminals.ts.

function registerAppIpc(): void {
  handleInvoke('get-app-version', () => app.getVersion())
  handleInvoke('get-theme', () => nativeTheme.shouldUseDarkColors)
  handleSend('apply-update', () => applyUpdate())

  handleInvoke('get-settings', () => loadSettings())
  handleInvoke('save-settings', (settings) => {
    saveSettings(settings)
    return settings
  })

  handleInvoke('get-open-tabs', () => loadOpenTabsState())
  handleInvoke('save-open-tabs', (state) => {
    saveOpenTabsState(state)
  })

  handleInvoke('translate-google-web', (text, from, to) => googleWebTranslate(text, from, to))
}

function registerWorkspaceIpc(): void {
  handleInvoke('get-workspaces', () => getWorkspaceTrees())

  handleInvoke('add-workspace', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const paths = loadWorkspaces()

    if (!paths.includes(selectedPath)) {
      paths.push(selectedPath)
      saveWorkspaces(paths)
      setupWatchers()
    }

    return getWorkspaceTrees()
  })

  handleInvoke('remove-workspace', (pathToRemove) => {
    saveWorkspaces(loadWorkspaces().filter((p) => p !== pathToRemove))
    setupWatchers()
    return getWorkspaceTrees()
  })

  handleInvoke('search-projects', (query) => searchInWorkspaces(query))

  handleInvoke('get-recent-external-files', () => loadRecentExternalFiles())
  handleInvoke('touch-recent-external-file', (filePath) => touchRecentExternalFile(filePath))
  handleInvoke('remove-recent-external-file', (filePath) => removeRecentExternalFile(filePath))
  handleInvoke('list-path-matches', (rawInput) => listPathMatches(rawInput))

  // Tree context menu's "Open in Finder": reveals the file/folder selected in
  // its parent window (Finder / Explorer / the Linux file manager).
  handleSend('reveal-in-finder', (_event, targetPath) => {
    shell.showItemInFolder(targetPath)
  })

  handleInvoke('read-file', (filePath) => readFileContent(filePath))

  handleInvoke('save-file', (filePath, content) => {
    // Encoded once here so the bytes on disk and the self-write hash the
    // watcher compares against are guaranteed to be the same bytes.
    const encoded = encodeFileContent(filePath, content)
    const result = writeFileContent(filePath, encoded)
    if (result.success) recordSelfWrite(filePath, encoded)
    return result
  })

  handleInvoke('rename-path', async (oldPath, newName) => {
    const result = await renamePath(oldPath, newName)
    if (result.success) setupWatchers()
    return result
  })

  handleInvoke('create-path', (parentPath, name, type) => createPath(parentPath, name, type))

  handleInvoke('copy-path', (sourcePath, targetDirPath) => copyPath(sourcePath, targetDirPath))

  handleInvoke('delete-path', async (targetPath) => {
    const result = await deletePath(targetPath)
    if (result.success) setupWatchers()
    return result
  })

  handleInvoke('move-path', async (sourcePath, targetDirPath) => {
    const result = await movePath(sourcePath, targetDirPath)
    if (result.success) setupWatchers()
    return result
  })
}

function registerGitIpc(): void {
  const refreshedStatuses = (): ReturnType<typeof getAllRepoStatuses> =>
    getAllRepoStatuses(loadWorkspaces())

  handleInvoke('git-status', async () => {
    if (!loadSettings().extensions.git.enabled) return []
    return refreshedStatuses()
  })

  handleInvoke('git-diff', (root, relPath) => getDiff(root, relPath))

  handleInvoke('git-stage', async (root, relPaths) => {
    const result = await stagePaths(root, relPaths)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-unstage', async (root, relPaths) => {
    const result = await unstagePaths(root, relPaths)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-discard', async (root, relPath) => {
    const result = await discardPath(root, relPath)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-commit', async (root, message, relPaths, amend) => {
    const result = await gitCommit(root, message, relPaths, amend)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-last-commit-message', (root) => lastCommitMessage(root))
  handleInvoke('git-push', (root) => gitPush(root))

  handleInvoke('git-pull', async (root) => {
    const result = await gitPull(root)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-log', (root, limit, skip) => getLog(root, limit, skip))
  handleInvoke('git-branches', (root) => getBranches(root))

  handleInvoke('git-checkout', async (root, branch) => {
    const result = await checkoutBranch(root, branch)
    return { ...result, statuses: await refreshedStatuses() }
  })
}

function registerGoogleTasksIpc(): void {
  handleInvoke('gtasks-accounts', () => gtasksListAccounts())
  handleInvoke('gtasks-add-account', () => gtasksAddAccount())
  handleInvoke('gtasks-remove-account', (email) => gtasksRemoveAccount(email))
  handleInvoke('gtasks-lists', (email) => gtasksListTaskLists(email))
  handleInvoke('gtasks-tasks', (email, listId) => gtasksListTasks(email, listId))
  handleInvoke('gtasks-create-task', (email, listId, input) =>
    gtasksCreateTask(email, listId, input)
  )
  handleInvoke('gtasks-update-task', (email, listId, taskId, input) =>
    gtasksUpdateTask(email, listId, taskId, input)
  )
  handleInvoke('gtasks-move-task', (email, listId, taskId, previousTaskId, destinationListId) =>
    gtasksMoveTask(email, listId, taskId, previousTaskId, destinationListId)
  )
}

function registerDiagnosticsIpc(): void {
  handleInvoke('lint-python', (absPath) => lintPython(absPath))
  handleInvoke('lint-eslint', (absPath, workspaceRoot) => lintEslint(absPath, workspaceRoot))
}

function registerWorkTogetherIpc(): void {
  handleInvoke('work-together-create-session', (backendUrl, filePath, language, content, maxTtl) =>
    workTogetherCreateSession(backendUrl, filePath, language, content, maxTtl)
  )
  handleInvoke('work-together-mint-link', (backendUrl, sessionId, hostToken, role, ttlSeconds) =>
    workTogetherMintLink(backendUrl, sessionId, hostToken, role, ttlSeconds)
  )
  handleInvoke('work-together-revoke-link', (backendUrl, sessionId, hostToken, linkId) =>
    workTogetherRevokeLink(backendUrl, sessionId, hostToken, linkId)
  )
  handleInvoke('work-together-end-session', (backendUrl, sessionId, hostToken) =>
    workTogetherEndSession(backendUrl, sessionId, hostToken)
  )
  handleInvoke('work-together-get-status', (backendUrl, sessionId, hostToken) =>
    workTogetherGetSessionStatus(backendUrl, sessionId, hostToken)
  )
  handleInvoke('work-together-connect', (sessionId, backendUrl, token) =>
    workTogetherConnectSession(sessionId, backendUrl, token)
  )
  handleInvoke('work-together-send', (sessionId, data) => {
    workTogetherSendSessionMessage(sessionId, data)
  })
  handleInvoke('work-together-disconnect', (sessionId) => {
    workTogetherDisconnectSession(sessionId)
  })
  handleInvoke('get-work-together-resume-state', () => loadWorkTogetherResumeState())
  handleInvoke('save-work-together-resume-state', (state) => {
    saveWorkTogetherResumeState(state)
  })
}

export function registerIpcHandlers(): void {
  registerAppIpc()
  registerWorkspaceIpc()
  registerGitIpc()
  registerGoogleTasksIpc()
  registerDiagnosticsIpc()
  registerWorkTogetherIpc()
}
