const QUICK_OPEN = 'input[placeholder^="Search files"]'

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

    await ui.key('Escape', 'Escape', 27)
    check(
      'Escape closes it',
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )
  }
}
