const QUICK_OPEN = 'input[placeholder^="Search files"]'
const IN_FILES = 'input[placeholder^="Search in all projects"]'
const SEARCH_BUTTON = 'button[aria-label="Global Search (Cmd+Shift+F)"]'

// A6 - finding things: full-text search across workspaces, and quick open.
export default {
  id: 'A6',
  title: 'Search and quick open',
  async run({ cdp, ui, ws, check, waitFor, sleep }) {
    const hits = await cdp.evaluate(`window.api.searchProjects('findmeplease')`)
    check(
      'full-text search finds a match',
      hits.some((h) => h.path === `${ws}/haystack.txt`),
      JSON.stringify(hits.slice(0, 2))
    )

    const ignoredHits = await cdp.evaluate(`window.api.searchProjects('needle-in')`)
    check(
      'search skips node_modules and .gitignore entries',
      ignoredHits.length === 0,
      JSON.stringify(ignoredHits.map((h) => h.path))
    )

    // Quick open is a renderer-level shortcut (double Shift), so unlike the
    // native-menu accelerators it can be driven from here.
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    const dialogOpen = await waitFor(`!!document.querySelector('${QUICK_OPEN}')`, {
      timeoutMs: 4000
    })
    check('double-Shift opens quick open', dialogOpen)
    if (!dialogOpen) return

    await cdp.send('Input.insertText', { text: 'haystack' })
    await sleep(400)
    check(
      'typing filters the results',
      await cdp.evaluate(`document.body.innerText.includes('haystack.txt')`)
    )

    // Only one search dialog at a time: realising mid-quick-open that the
    // file is easier found by its contents switches this dialog over rather
    // than opening a second one behind it - and the query comes along.
    // (The toolbar button, not Cmd+Shift+F: menu accelerators can't be
    // driven over CDP, and it sits in the drag region, hence .click().)
    await cdp.evaluate(`document.querySelector('${SEARCH_BUTTON}').click()`)
    const switched = await waitFor(
      `!document.querySelector('${QUICK_OPEN}') && !!document.querySelector('${IN_FILES}')`,
      { timeoutMs: 4000 }
    )
    check('switching to search-in-files replaces quick open instead of stacking', switched)
    check(
      'the typed query carries over',
      (await cdp.evaluate(`document.querySelector('${IN_FILES}')?.value`)) === 'haystack'
    )

    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    const switchedBack = await waitFor(
      `!!document.querySelector('${QUICK_OPEN}') && !document.querySelector('${IN_FILES}')`,
      { timeoutMs: 4000 }
    )
    check('double-Shift switches back, again leaving one dialog', switchedBack)
    check(
      'and the query comes back with it',
      (await cdp.evaluate(`document.querySelector('${QUICK_OPEN}')?.value`)) === 'haystack'
    )

    await ui.key('Escape', 'Escape', 27)
    check(
      'Escape closes it',
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )
  }
}
