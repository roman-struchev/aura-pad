import type { GitRepoStatus } from '../../../shared/gitStatus'

// The repo behind a workspace root: usually the root itself, but a repo
// nested one level under it also counts. Shared by the window-header
// breadcrumb, the sidebar's per-root branch badges, and the git panel
// entry point - it used to be copy-pasted in each.
export function findRepoForRoot(
  repos: GitRepoStatus[],
  rootPath: string
): GitRepoStatus | undefined {
  return repos.find((r) => r.root === rootPath || r.root.startsWith(rootPath + '/'))
}
