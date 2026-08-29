import fs from 'fs'
import path from 'path'

// A3 - the tab strip: opening several files, switching, closing, persistence.
export default {
  id: 'A3',
  title: 'Tabs',
  async run({ cdp, ui, ws, fixture, check, skip, connectMain, waitFor, sleep }) {
    // Opened here rather than relying on A2 having run, so the case stands on
    // its own under `npm run smoke -- A3`.
    await ui.clickRow(`${ws}/notes.txt`)
    await ui.clickRow(`${ws}/readme.md`)
    await ui.clickRow(`${ws}/data.json`)

    const opened = await waitFor(`window.api.getOpenTabs().then((s) => s.paths.length >= 3)`, {
      timeoutMs: 8000
    })
    check('opening more files adds tabs', opened, JSON.stringify((await ui.openTabs()).paths))
    check(
      'each open file has a tab',
      (await ui.openTabLabels()).filter((l) => /notes|readme|data/.test(l)).length >= 3,
      JSON.stringify(await ui.openTabLabels())
    )

    // Each click's file read is async, so the active tab only catches up a
    // beat later - reading it straight after the third click just measures
    // how fast the disk was.
    const activeIsLast = await waitFor(
      `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(`${ws}/data.json`)})`,
      { timeoutMs: 8000 }
    )
    check(
      'the last opened file is the active one',
      activeIsLast,
      String((await ui.openTabs()).activeTabPath)
    )

    await ui.clickTab('readme.md')
    check(
      'clicking a tab activates it',
      await waitFor(`window.api.getOpenTabs().then((s) => s.activeTabPath.endsWith('readme.md'))`, {
        timeoutMs: 5000
      }),
      String((await ui.openTabs()).activeTabPath)
    )

    await ui.closeTab('data.json')
    check(
      'closing a tab removes it',
      await waitFor(
        `window.api.getOpenTabs().then((s) => !s.paths.some((p) => p.endsWith('data.json')))`,
        { timeoutMs: 5000 }
      ),
      JSON.stringify((await ui.openTabs()).paths)
    )
    check(
      'the remaining tabs stay open',
      (await ui.openTabs()).paths.some((p) => p.endsWith('readme.md'))
    )

    // A file from outside every workspace opens like any other and is
    // remembered, so it can be reopened from the sidebar later. It goes
    // through Quick Open's path listing first, which is both how a user
    // reaches such a file and how main comes to allow it (src/main/pathAccess
    // - naming the path out of nowhere is refused).
    const external = path.join(fixture.outside, 'external.txt')
    await cdp.evaluate(
      `window.api.listPathMatches(${JSON.stringify(path.join(fixture.outside, 'ext'))})`
    )
    const externalRead = await cdp.evaluate(`window.api.readFile(${JSON.stringify(external)})`)
    check('a file outside the workspace can be opened', externalRead.success, externalRead.error)
    await cdp.evaluate(`window.api.touchRecentExternalFile(${JSON.stringify(external)})`)
    const recent = await cdp.evaluate(
      `window.api.getRecentExternalFiles().then((e) => e.map((x) => x.path))`
    )
    check('it lands in the "recently opened outside" list', recent.includes(external))

    // A crowded strip: more tabs than fit must scroll, and the active one has
    // to stay in view - it used to be appended past the right edge, invisible,
    // with no scrollbar (the strip hides it) to say so. Opened through main's
    // 'open-file-request' rather than by clicking tree rows: a dozen rows do
    // not all fit on screen, and coordinate clicks need them visible.
    const main = await connectMain()
    if (!main) {
      skip('a crowded tab strip keeps the active tab in view', 'no --inspect target')
    } else {
      const crowd = Array.from({ length: 12 }, (_, i) =>
        path.join(ws, `crowd-${String(i + 1).padStart(2, '0')}.txt`)
      )
      for (const file of crowd) fs.writeFileSync(file, 'crowded\n')
      const send = (p) =>
        main.evaluate(
          `(() => { require('electron').BrowserWindow.getAllWindows()[0]` +
            `.webContents.send('open-file-request', ${JSON.stringify(p)}); return true })()`
        )
      for (const file of crowd) {
        await send(file)
        await sleep(120)
      }
      const allOpen = await waitFor(
        `window.api.getOpenTabs().then((s) => s.paths.filter((p) => p.includes('crowd-')).length === ${crowd.length})`,
        { timeoutMs: 15000 }
      )
      check('a dozen files open as a dozen tabs', allOpen, JSON.stringify(await ui.openTabLabels()))

      const strip = `document.querySelector('[data-tab-strip]')`
      check(
        'the strip scrolls instead of squeezing the tabs away',
        await cdp.evaluate(
          `(() => { const s = ${strip}; return !!s && s.scrollWidth > s.clientWidth + 1 })()`
        )
      )
      check('an overflowing strip offers the full tab list', await ui.buttonExists('All Open Tabs'))

      // Fully visible, not merely intersecting: half a tab peeking out from
      // under the fade is the bug this guards.
      const activeInView = `(() => {
        const s = ${strip}
        const t = s && s.querySelector('[data-tab-active]')
        if (!s || !t) return false
        const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect()
        return tr.left >= sr.left - 1 && tr.right <= sr.right + 1
      })()`
      check(
        'the newly opened tab is scrolled into view',
        await waitFor(activeInView, { timeoutMs: 5000 })
      )

      // The other direction: the strip parked at its right end, then a tab
      // from the far left activated.
      await cdp.evaluate(`(() => { ${strip}.scrollLeft = 1e6; return true })()`)
      await send(`${ws}/notes.txt`)
      const backToFirst = await waitFor(
        `window.api.getOpenTabs().then((s) => s.activeTabPath.endsWith('notes.txt'))`,
        { timeoutMs: 8000 }
      )
      check('activating a tab that scrolled off works', backToFirst)
      check('it is scrolled back into view', await waitFor(activeInView, { timeoutMs: 5000 }))

      // Leave the strip (and the workspace) as the later cases expect it.
      const notesTab = await ui.rectOf(`[data-tab-path="${ws}/notes.txt"]`)
      await ui.clickAt(notesTab.cx, notesTab.cy, { button: 'right' })
      await ui.clickButton('Close Others')
      await waitFor(`window.api.getOpenTabs().then((s) => s.paths.length === 1)`, {
        timeoutMs: 5000
      })
      // Back to what the earlier checks left open, so the cases after this one
      // start from the strip they used to.
      await send(`${ws}/readme.md`)
      await waitFor(`window.api.getOpenTabs().then((s) => s.activeTabPath.endsWith('readme.md'))`, {
        timeoutMs: 8000
      })
      for (const file of crowd) fs.rmSync(file, { force: true })
      main.close()
      await sleep(400)
    }

    // The tab's own menu carries the same two path actions as the tree's.
    const readmeTab = await ui.rectOf(`[data-tab-path="${ws}/readme.md"]`)
    await ui.clickAt(readmeTab.x + 20, readmeTab.cy, { button: 'right' })
    await sleep(200)
    await ui.clickButton('Copy Relative Path')
    await sleep(200)
    let tabPath = null
    try {
      tabPath = await cdp.evaluate('navigator.clipboard.readText()')
    } catch {
      tabPath = null
    }
    if (tabPath === null) skip('a tab copies its path relative to the project', 'clipboard denied')
    else
      check('a tab copies its path relative to the project', tabPath === 'readme.md', String(tabPath))

    // The title bar has to stay a title bar: the strip is as wide as the
    // window, and marking all of it no-drag (which it was) left the window
    // draggable only by the sliver beside the traffic lights.
    const regions = await cdp.evaluate(`(() => {
      const regionOf = (el) => {
        for (let node = el; node; node = node.parentElement) {
          const region = getComputedStyle(node).webkitAppRegion
          if (region === 'drag' || region === 'no-drag') return region
        }
        return 'none'
      }
      const strip = document.querySelector('[data-tab-strip]')
      const tab = document.querySelector('[data-tab-path]')
      if (!strip || !tab) return null
      const stripBox = strip.getBoundingClientRect()
      const lastTab = [...document.querySelectorAll('[data-tab-path]')].at(-1)
      const after = lastTab.getBoundingClientRect().right + 20
      // Only meaningful while there is empty strip left of its right edge.
      const empty = after < stripBox.right - 4 ? document.elementFromPoint(after, stripBox.top + stripBox.height / 2) : null
      const onTab = document.elementFromPoint(
        tab.getBoundingClientRect().x + 10,
        tab.getBoundingClientRect().y + 10
      )
      return { empty: empty ? regionOf(empty) : 'no-empty-space', tab: onTab ? regionOf(onTab) : null }
    })()`)
    check(
      'the empty part of the tab strip drags the window',
      regions && (regions.empty === 'drag' || regions.empty === 'no-empty-space'),
      JSON.stringify(regions)
    )
    check(
      'and the tabs themselves still take the click',
      regions && regions.tab === 'no-drag',
      JSON.stringify(regions)
    )

    await sleep(700)
    const persisted = JSON.parse(
      fs.readFileSync(path.join(fixture.profile, 'openTabs.json'), 'utf-8')
    )
    check(
      'the open tabs are persisted for the next launch',
      Array.isArray(persisted.paths) && persisted.paths.length > 0,
      JSON.stringify(persisted).slice(0, 120)
    )
  }
}
