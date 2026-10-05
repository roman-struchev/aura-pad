import fs from 'fs'
import { execFileSync } from 'child_process'

// A21 - git inside the editor: change markers beside the line numbers (with
// the expand-and-revert a click on one opens) and the cursor line's inline
// blame (hooks/useGitDecorations.ts). Plus the breadcrumbs strip above the
// editor (components/Breadcrumbs.tsx), off by default.
//
// Ground truth is what the hook writes on the editor's container
// (data-git-hunks, data-blame) and the file on disk - never Monaco's rendered
// lines, which go stale in a window the OS treats as hidden.
export default {
  id: 'A21',
  title: 'Git in the editor',
  async run({ cdp, ui, ws, fixture, check, skip, waitFor, read }) {
    if (!fixture.gitReady) {
      skip('git markers and blame', 'git unavailable when the fixture was built')
      return
    }

    // Flips a switch in Settings → Editor the way a user would: the settings
    // file alone doesn't reach a running renderer.
    const toggleSetting = async (label) => {
      const found = await cdp.evaluate(`(async () => {
        const gear = [...document.querySelectorAll('button')].find((b) =>
          /settings/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || '')))
        gear?.click()
        await new Promise((r) => setTimeout(r, 300))
        ;[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Editor')?.click()
        await new Promise((r) => setTimeout(r, 200))
        const sw = document.querySelector('[role="switch"][aria-label=${JSON.stringify(label)}]')
        sw?.click()
        await new Promise((r) => setTimeout(r, 200))
        return !!sw
      })()`)
      await ui.key('Escape', 'Escape', 27)
      return found
    }

    // Inline blame is off by default; the checks below need it on.
    check('Settings has an Inline Blame switch', await toggleSetting('Inline Blame'))

    // A file of its own, committed here, so earlier cases' edits to the
    // shared fixture files can't shift the expected line numbers.
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: ws,
        stdio: 'pipe',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
      })
    const file = `${ws}/gutter.txt`
    fs.writeFileSync(file, 'one\ntwo\nthree\nfour\nfive\n')
    git('add', 'gutter.txt')
    git('commit', '-q', '-m', 'add gutter fixture')
    // Line 2 changed, a line added after 3, line 5 removed.
    fs.writeFileSync(file, 'one\nTWO\nthree\nnew line\nfour\n')

    const head = await cdp.evaluate(
      `window.api.getGitHeadContent(${JSON.stringify(ws)}, 'gutter.txt')`
    )
    check('the committed version is readable', head === 'one\ntwo\nthree\nfour\nfive\n', head)
    check(
      'a file with no committed version has none',
      (await cdp.evaluate(
        `window.api.getGitHeadContent(${JSON.stringify(ws)}, 'no-such-file.txt')`
      )) === null
    )

    await ui.openFile(file)
    const hunks = await waitFor(
      `document.querySelector('[data-git-hunks]')?.dataset.gitHunks || null`,
      { timeoutMs: 10_000 }
    )
    check(
      'changed, added and removed lines are marked',
      hunks === 'modified:2-2,added:4-4,deleted:5-5',
      String(hunks)
    )

    // Blame follows the cursor: a committed line names its commit, an
    // edited one says it isn't committed yet.
    const blame1 = await waitFor(
      `(document.querySelector('[data-blame]')?.dataset.blame || '').startsWith('1:') &&
         document.querySelector('[data-blame]').dataset.blame`,
      { timeoutMs: 10_000 }
    )
    check(
      'the cursor line shows its author and commit',
      typeof blame1 === 'string' &&
        blame1.includes('Smoke Test') &&
        blame1.includes('add gutter fixture'),
      String(blame1)
    )
    await ui.focusEditor()
    await ui.key('ArrowDown', 'ArrowDown', 40)
    const blame2 = await waitFor(
      `(document.querySelector('[data-blame]')?.dataset.blame || '').startsWith('2:') &&
         document.querySelector('[data-blame]').dataset.blame`,
      { timeoutMs: 10_000 }
    )
    check(
      'an edited line is blamed as uncommitted',
      typeof blame2 === 'string' && blame2.includes('Uncommitted'),
      String(blame2)
    )

    // Typing updates the markers live, before any save.
    await ui.key('ArrowUp', 'ArrowUp', 38)
    await ui.key('Home', 'Home', 36)
    await cdp.send('Input.insertText', { text: 'top\n' })
    const moved = await waitFor(
      `(() => {
        const h = document.querySelector('[data-git-hunks]')?.dataset.gitHunks
        return h && h.startsWith('added:1-1') ? h : null
      })()`,
      { timeoutMs: 5_000 }
    )
    check(
      'markers follow unsaved typing',
      moved === 'added:1-1,modified:3-3,added:5-5,deleted:6-6',
      String(moved)
    )

    // Click the bar of the first hunk, then Revert in what opens.
    const bar = await cdp.evaluate(`(() => {
      const el = document.querySelector('.monaco-editor .aura-git-added')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    if (!bar) {
      skip('a marker opens the hunk', 'the gutter was not rendered (hidden window)')
    } else {
      await ui.clickAt(bar.x, bar.y)
      const opened = await waitFor(`!!document.querySelector('[data-testid="git-hunk"]')`, {
        timeoutMs: 3_000
      })
      check('clicking a marker expands its hunk', opened)
      // A real mouse click, not a DOM .click(): Monaco swallows the
      // mousedown inside a view zone unless the zone opts out.
      await ui.click('[data-testid="git-hunk-revert"]')
      const reverted = await waitFor(
        `(() => {
          const h = document.querySelector('[data-git-hunks]')?.dataset.gitHunks
          return h === 'modified:2-2,added:4-4,deleted:5-5' ? h : null
        })()`,
        { timeoutMs: 5_000 }
      )
      check('Revert puts the committed text back', !!reverted)
      const onDisk = await waitFor(
        `window.api.readFile(${JSON.stringify(file)}).then((r) => !(r.content || '').startsWith('top'))`,
        { timeoutMs: 10_000 }
      )
      check('and the revert is saved like any edit', onDisk, read('gutter.txt').slice(0, 20))
    }
    // Breadcrumbs: switched on from Settings → Editor (the settings file alone
    // doesn't reach a running renderer), then the path and the heading the
    // cursor is under.
    check('Settings has a Breadcrumbs switch', await toggleSetting('Breadcrumbs'))
    check(
      'and it is saved',
      await waitFor(`window.api.getSettings().then((s) => s.breadcrumbsEnabled === true)`)
    )
    await ui.openFile(`${ws}/readme.md`)
    const crumbs = await waitFor(
      `(() => {
        const el = document.querySelector('[data-testid="breadcrumbs"]')
        return el && el.querySelector('[data-testid="breadcrumb-symbol"]') ? el.innerText : null
      })()`,
      { timeoutMs: 5_000 }
    )
    check(
      'breadcrumbs show the project, the file and the heading at the cursor',
      typeof crumbs === 'string' &&
        crumbs.includes('workspace') &&
        crumbs.includes('readme.md') &&
        crumbs.includes('Title'),
      JSON.stringify(crumbs)
    )
    check(
      "the file's actions move into the strip",
      await cdp.evaluate(`!!document.querySelector(
        '[data-testid="breadcrumbs"] button[aria-label^="Show Preview"]')`)
    )
    if (!(await ui.rowExists(`${ws}/src/main.ts`))) await ui.clickRow(`${ws}/src`)
    await ui.openFile(`${ws}/src/main.ts`)
    await cdp.evaluate(`[...document.querySelectorAll('[data-testid="breadcrumbs"] button')]
      .find((b) => b.innerText === 'src')?.click()`)
    const selected = await waitFor(
      `[...document.querySelectorAll('[data-tree-row]')]
        .filter((r) => r.className.split(' ').includes('bg-fleet-active'))
        .map((r) => r.dataset.path).join(',') || null`,
      { timeoutMs: 3_000 }
    )
    check(
      'clicking a folder crumb selects that folder in the tree',
      // The open file keeps its own highlight alongside.
      typeof selected === 'string' && selected.split(',').includes(`${ws}/src`),
      String(selected)
    )
    await toggleSetting('Breadcrumbs')
    check(
      'switching them off removes the strip',
      await waitFor(`!document.querySelector('[data-testid="breadcrumbs"]')`)
    )
    // Back to the default for whatever runs next.
    await toggleSetting('Inline Blame')
  }
}
