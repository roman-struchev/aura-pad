import fs from 'fs'

// A10 - git status, diff and branches for a workspace that is a repo.
export default {
  id: 'A10',
  title: 'Git',
  async run({ cdp, ws, fixture, check, skip, waitFor }) {
    if (!fixture.gitReady) {
      skip('git surfaces', 'git unavailable when the fixture was built')
      return
    }

    const repos = await waitFor(
      `window.api.getGitStatus().then((r) => (r.length > 0 ? r : null))`,
      { timeoutMs: 15_000 }
    )
    check('the workspace is recognised as a repo', Array.isArray(repos) && repos.length > 0)
    if (!Array.isArray(repos) || repos.length === 0) return

    const repo = repos[0]
    check('the current branch is reported', repo.branch === 'main', String(repo.branch))
    check(
      'a modified file shows up as unstaged',
      repo.unstaged?.some((f) => f.relPath === 'notes.txt'),
      JSON.stringify(repo.unstaged?.map((f) => `${f.relPath}:${f.state}`))
    )

    const diff = await cdp.evaluate(`window.api.getGitDiff(${JSON.stringify(ws)}, 'notes.txt')`)
    check(
      'a diff against HEAD is available',
      typeof diff?.original === 'string' &&
        typeof diff?.modified === 'string' &&
        diff.original !== diff.modified,
      JSON.stringify({
        original: diff?.original?.slice(0, 24),
        modified: diff?.modified?.slice(0, 24)
      })
    )

    const branches = await cdp.evaluate(`window.api.gitBranches(${JSON.stringify(ws)})`)
    const branchList = Array.isArray(branches) ? branches : (branches?.branches ?? [])
    check(
      'branches are listed',
      JSON.stringify(branchList).includes('main'),
      JSON.stringify(branchList).slice(0, 80)
    )

    // Staging is what the git panel's checkboxes do.
    const staged = await cdp.evaluate(`window.api.gitStage(${JSON.stringify(ws)}, ['notes.txt'])`)
    check(
      'a file can be staged',
      staged?.success && staged.statuses?.[0]?.staged?.some((f) => f.relPath === 'notes.txt'),
      JSON.stringify(staged?.statuses?.[0]?.staged?.map((f) => f.relPath))
    )
    await cdp.evaluate(`window.api.gitUnstage(${JSON.stringify(ws)}, ['notes.txt'])`)

    fs.writeFileSync(`${ws}/untracked-by-git.txt`, 'new\n')
    const sawUntracked = await waitFor(
      `window.api.getGitStatus().then((r) =>
         !!r[0]?.unstaged?.some((f) => f.relPath === 'untracked-by-git.txt'))`,
      { timeoutMs: 10_000 }
    )
    check('a new file is reported as untracked', sawUntracked)
  }
}
