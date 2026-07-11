import { useEffect, useState } from 'react'
import type { GitFileEntry, GitFileState, GitRepoStatus } from '../../../shared/gitStatus'
import { alertDialog, confirmDialog } from '../lib/dialogs'

// Owns git status for all open workspace roots: fetches it, subscribes to the
// watcher-driven push updates, and wraps the mutating IPC calls (stage/
// unstage/commit/push/pull), surfacing failures via the app's own dialog
// instead of a native alert.
export function useGitStatus(enabled: boolean) {
  const [rawRepos, setRawRepos] = useState<GitRepoStatus[]>([])
  // Masked rather than cleared via an effect, so disabling the setting can't
  // race with an in-flight fetch that resolves after the effect already ran.
  const repos = enabled ? rawRepos : []

  useEffect(() => {
    if (!enabled) return
    window.api.getGitStatus().then(setRawRepos)
    const unsubscribe = window.api.onGitStatusChanged(setRawRepos)
    return unsubscribe
  }, [enabled])

  const refresh = async (): Promise<void> => {
    if (!enabled) return
    setRawRepos(await window.api.getGitStatus())
  }

  // Flattened for cheap per-row lookup in FileTree. Unstaged state (if any)
  // takes priority over "staged", since it reflects the more urgent fact that
  // there are still unsaved-to-git changes on top of what's already staged.
  const fileStates: Record<string, GitFileState> = {}
  for (const repo of repos) {
    for (const entry of repo.staged) fileStates[entry.path] = 'staged'
    for (const entry of repo.unstaged) fileStates[entry.path] = entry.state
  }

  const stage = async (root: string, relPaths: string[]): Promise<void> => {
    const result = await window.api.gitStage(root, relPaths)
    setRawRepos(result.statuses)
    if (!result.success) await alertDialog(result.error || 'Stage failed.')
  }

  const unstage = async (root: string, relPaths: string[]): Promise<void> => {
    const result = await window.api.gitUnstage(root, relPaths)
    setRawRepos(result.statuses)
    if (!result.success) await alertDialog(result.error || 'Unstage failed.')
  }

  const commit = async (
    root: string,
    message: string,
    relPaths: string[],
    amend: boolean
  ): Promise<boolean> => {
    const result = await window.api.gitCommit(root, message, relPaths, amend)
    setRawRepos(result.statuses)
    if (!result.success) {
      await alertDialog(result.error || 'Commit failed.')
      return false
    }
    return true
  }

  const commitAndPush = async (
    root: string,
    message: string,
    relPaths: string[],
    amend: boolean
  ): Promise<boolean> => {
    const ok = await commit(root, message, relPaths, amend)
    if (ok) await push(root)
    return ok
  }

  const lastCommitMessage = (root: string): Promise<string> => window.api.gitLastCommitMessage(root)

  // Untracked files have nothing in git to check out, so "discard" for them
  // means deleting the file (to Trash, via the same IPC the file tree uses)
  // rather than `git checkout HEAD`, which only applies to tracked paths.
  const discard = async (root: string, entry: GitFileEntry): Promise<void> => {
    if (entry.state === 'untracked') {
      if (!(await confirmDialog(`Move "${entry.relPath}" to Trash?`))) return
      await window.api.deletePath(entry.path)
      return
    }
    if (!(await confirmDialog(`Discard changes to "${entry.relPath}"? This can't be undone.`)))
      return
    const result = await window.api.gitDiscard(root, entry.relPath)
    setRawRepos(result.statuses)
    if (!result.success) await alertDialog(result.error || 'Discard failed.')
  }

  const push = async (root: string): Promise<void> => {
    const result = await window.api.gitPush(root)
    await alertDialog(result.output || (result.success ? 'Pushed successfully.' : 'Push failed.'))
  }

  const pull = async (root: string): Promise<void> => {
    const result = await window.api.gitPull(root)
    setRawRepos(result.statuses)
    await alertDialog(result.output || (result.success ? 'Pulled successfully.' : 'Pull failed.'))
  }

  const diff = (root: string, relPath: string): Promise<{ original: string; modified: string }> =>
    window.api.getGitDiff(root, relPath)

  return {
    repos,
    fileStates,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    commitAndPush,
    lastCommitMessage,
    push,
    pull,
    diff
  }
}
