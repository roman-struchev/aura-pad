import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { handleInvoke, handleInvokeWithEvent, handleSend } from './ipc'
import {
  loadWorkspaces,
  saveWorkspaces,
  getWorkspaceTrees,
  searchInWorkspaces,
  readFileContent,
  writeFileContent,
  renamePath,
  createPath,
  copyPaths,
  deletePaths,
  movePath
} from './workspaces'
import { readFilesFromClipboard, writeFilesToClipboard } from './clipboardFiles'
import { loadSettings, saveSettings } from './settings'
import { loadOpenTabsState, saveOpenTabsState } from './openTabsState'
import { loadWorkTogetherResumeState, saveWorkTogetherResumeState } from './workTogetherResumeState'
import {
  loadRecentExternalFiles,
  touchRecentExternalFile,
  removeRecentExternalFile
} from './recentExternalFiles'
import { listPathMatches } from './pathBrowse'
import { replaceInFiles, undoReplaceInFiles } from './replaceInFiles'
import { readImageDataUrl, savePastedImage } from './pastedImages'
import { readHttpEnvironments } from './httpEnv'
import { appendHttpRequest } from './httpSave'
import { listSnapshots, readSnapshot, recordSnapshot, shouldSnapshot } from './localHistory'
import { grantPath, grantPaths, isAllowedPath, pathDenial, relativeDenial } from './pathAccess'
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
import { cancelHttpRequest, sendHttpRequest } from './http'
import { clearHttpHistory, loadHttpHistory } from './httpHistory'
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
  handleInvoke('local-history-list', (filePath) =>
    pathDenial(filePath) ? [] : listSnapshots(filePath)
  )

  handleInvoke('local-history-read', (filePath, id) => {
    const denial = pathDenial(filePath)
    if (denial) return { success: false, error: denial }
    return readSnapshot(filePath, id)
  })

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

  handleInvoke('search-projects', (query, options) => searchInWorkspaces(query, options))
  handleInvoke('replace-in-files', (request) => replaceInFiles(request))
  handleInvoke('undo-replace-in-files', () => undoReplaceInFiles())

  handleInvoke('get-recent-external-files', () => loadRecentExternalFiles())
  // Only records a file the renderer was allowed to open in the first place:
  // the list is itself a source of access (see pathAccess), so letting the
  // renderer write into it freely would hand out permanent grants.
  handleInvoke('touch-recent-external-file', (filePath) =>
    isAllowedPath(filePath) ? touchRecentExternalFile(filePath) : loadRecentExternalFiles()
  )
  handleInvoke('remove-recent-external-file', (filePath) => removeRecentExternalFile(filePath))
  // Quick Open's path mode: what main lists here is what the renderer may then
  // open, which is how a file outside every workspace still gets opened.
  handleInvoke('list-path-matches', (rawInput) => {
    const listing = listPathMatches(rawInput)
    grantPath(listing.dir)
    grantPaths(listing.entries.map((entry) => entry.path))
    return listing
  })

  // Tree context menu's "Open in Finder": reveals the file/folder selected in
  // its parent window (Finder / Explorer / the Linux file manager).
  handleSend('reveal-in-finder', (_event, targetPath) => {
    if (pathDenial(targetPath)) return
    shell.showItemInFolder(targetPath)
  })

  handleInvoke('read-file', (filePath) => {
    const denial = pathDenial(filePath)
    return denial ? { success: false, error: denial } : readFileContent(filePath)
  })

  handleInvoke('save-file', (filePath, content) => {
    const denial = pathDenial(filePath)
    if (denial) return { success: false, error: denial }
    // The state this write is about to replace, kept where the user can get
    // back to it (src/main/localHistory.ts). Guarded by shouldSnapshot so the
    // usual autosave - seconds after the last one - doesn't pay for a read of
    // the whole file it is going to overwrite anyway.
    if (shouldSnapshot(filePath)) {
      const previous = readFileContent(filePath)
      if (previous.success && previous.content !== undefined) {
        recordSnapshot(filePath, previous.content, 'Save')
      }
    }
    // Encoded once here so the bytes on disk and the self-write hash the
    // watcher compares against are guaranteed to be the same bytes.
    const encoded = encodeFileContent(filePath, content)
    const result = writeFileContent(filePath, encoded)
    if (result.success) recordSelfWrite(filePath, encoded)
    return result
  })

  handleInvoke('rename-path', async (oldPath, newName) => {
    const denial = pathDenial(oldPath)
    if (denial) return { success: false, error: denial }
    const result = await renamePath(oldPath, newName)
    if (result.success) setupWatchers()
    return result
  })

  handleInvoke('create-path', (parentPath, name, type) => {
    const denial = pathDenial(parentPath)
    return denial ? { success: false, error: denial } : createPath(parentPath, name, type)
  })

  handleInvoke('copy-paths', (sourcePaths, targetDirPath) => {
    const denial = pathDenial(...sourcePaths, targetDirPath)
    return denial ? { success: false, error: denial } : copyPaths(sourcePaths, targetDirPath)
  })

  handleInvoke('delete-paths', async (targetPaths) => {
    const denial = pathDenial(...targetPaths)
    if (denial) return { success: false, error: denial }
    const result = await deletePaths(targetPaths)
    // Watchers are re-armed whenever anything was trashed - a partial batch
    // still changed the tree, so this can't hang off `success` alone.
    setupWatchers()
    return result
  })

  handleInvoke('save-pasted-image', (documentPath) => savePastedImage(documentPath))
  handleInvoke('read-image-data-url', (imagePath) => readImageDataUrl(imagePath))

  handleInvoke('clipboard-write-files', (paths) => {
    const denial = pathDenial(...paths)
    return denial ? { success: false, error: denial } : writeFilesToClipboard(paths)
  })

  // Read side of the OS clipboard: the paths come from Finder/Explorer, not
  // from the renderer, and pasting them is what grants them.
  handleInvoke('clipboard-read-files', () => {
    const paths = readFilesFromClipboard()
    grantPaths(paths)
    return paths
  })

  handleInvoke('move-path', async (sourcePath, targetDirPath) => {
    const denial = pathDenial(sourcePath, targetDirPath)
    if (denial) return { success: false, error: denial }
    const result = await movePath(sourcePath, targetDirPath)
    if (result.success) setupWatchers()
    return result
  })
}

// Not part of the typed contracts on purpose: this channel is preload-only
// (see getPathForFile there), and putting it in shared/ipc.ts would generate a
// window.api method that let the page grant itself any path it liked.
function registerDropGrantIpc(): void {
  ipcMain.on('grant-dropped-path', (_event, droppedPath: unknown) => {
    if (typeof droppedPath === 'string') grantPath(droppedPath)
  })
}

function registerGitIpc(): void {
  const refreshedStatuses = (): ReturnType<typeof getAllRepoStatuses> =>
    getAllRepoStatuses(loadWorkspaces())

  handleInvoke('git-status', async () => {
    if (!loadSettings().extensions.git.enabled) return []
    return refreshedStatuses()
  })

  // Every git call runs `git` with the given root as its cwd, so an
  // unchecked root is a shell-out anywhere on disk; the relative paths are
  // checked too, since `../..` walks straight back out of the repo.
  const gitFailure = (denial: string): { success: false; output: string } => ({
    success: false,
    output: denial
  })

  handleInvoke('git-diff', (root, relPath) =>
    relativeDenial(root, [relPath]) ? { original: '', modified: '' } : getDiff(root, relPath)
  )

  handleInvoke('git-stage', async (root, relPaths) => {
    const denial = relativeDenial(root, relPaths)
    const result = denial ? { success: false, error: denial } : await stagePaths(root, relPaths)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-unstage', async (root, relPaths) => {
    const denial = relativeDenial(root, relPaths)
    const result = denial ? { success: false, error: denial } : await unstagePaths(root, relPaths)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-discard', async (root, relPath) => {
    const denial = relativeDenial(root, [relPath])
    const result = denial ? { success: false, error: denial } : await discardPath(root, relPath)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-commit', async (root, message, relPaths, amend) => {
    const denial = relativeDenial(root, relPaths)
    const result = denial
      ? { success: false, error: denial }
      : await gitCommit(root, message, relPaths, amend)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-last-commit-message', (root) =>
    pathDenial(root) ? '' : lastCommitMessage(root)
  )
  handleInvoke('git-push', (root) => {
    const denial = pathDenial(root)
    return denial ? gitFailure(denial) : gitPush(root)
  })

  handleInvoke('git-pull', async (root) => {
    const denial = pathDenial(root)
    const result = denial ? gitFailure(denial) : await gitPull(root)
    return { ...result, statuses: await refreshedStatuses() }
  })

  handleInvoke('git-log', (root, limit, skip) =>
    pathDenial(root) ? [] : getLog(root, limit, skip)
  )
  handleInvoke('git-branches', (root) => (pathDenial(root) ? [] : getBranches(root)))

  handleInvoke('git-checkout', async (root, branch) => {
    const denial = pathDenial(root)
    const result = denial ? gitFailure(denial) : await checkoutBranch(root, branch)
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

function registerHttpIpc(): void {
  handleInvoke('http-send', (requestId, spec) => sendHttpRequest(requestId, spec))
  handleSend('http-cancel', (_event, requestId) => cancelHttpRequest(requestId))
  handleInvoke('http-environments', (filePath) =>
    pathDenial(filePath)
      ? { dir: null, names: [], variables: {}, hasPrivate: false }
      : readHttpEnvironments(filePath)
  )

  handleInvoke('http-save-request', (filePath, block) => {
    const denial = pathDenial(filePath)
    if (denial) return { success: false, error: denial }
    return appendHttpRequest(filePath, block)
  })

  handleInvoke('http-history', () => loadHttpHistory())
  handleInvoke('http-history-clear', () => clearHttpHistory())
}

function registerDiagnosticsIpc(): void {
  // Both shell out with the given path as an argument (and eslint with the
  // root as its cwd), so they are as much a spawn surface as the pty is.
  handleInvoke('lint-python', (absPath) => (pathDenial(absPath) ? null : lintPython(absPath)))
  handleInvoke('lint-eslint', (absPath, workspaceRoot) =>
    pathDenial(absPath, workspaceRoot) ? [] : lintEslint(absPath, workspaceRoot)
  )
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
  // Bound to the window that opened the session, so a shared tab in a second
  // window receives its own messages.
  handleInvokeWithEvent('work-together-connect', (event, sessionId, backendUrl, token) =>
    workTogetherConnectSession(sessionId, backendUrl, token, event.sender.id)
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
  registerDropGrantIpc()
  registerGitIpc()
  registerGoogleTasksIpc()
  registerHttpIpc()
  registerDiagnosticsIpc()
  registerWorkTogetherIpc()
}
