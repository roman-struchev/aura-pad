import fs from 'fs'
import path from 'path'

// A15 - more than one window: a tab torn off into its own window, and the
// rule that only the first window owns the persisted session.
export default {
  id: 'A15',
  title: 'Detached windows',
  async run({ cdp, ui, ws, fixture, check, skip, connectMain, waitFor, sleep }) {
    const main = await connectMain()
    if (!main) {
      skip('a tab can be torn off into its own window', 'no --inspect target')
      return
    }

    const windowCount = `require('electron').BrowserWindow.getAllWindows().length`
    const windowIds = `require('electron').BrowserWindow.getAllWindows().map((w) => w.id)`
    // getAllWindows() is not ordered by age - the new window can come back
    // first - so the detached one is found by the id that wasn't there
    // before. Destroying the wrong one takes the suite's own window with it.
    const idsBefore = await main.evaluate(windowIds)
    const init = await cdp.evaluate('window.api.getWindowInit()')
    check('the first window owns the session', init?.primary === true, JSON.stringify(init))

    await ui.clickRow(`${ws}/notes.txt`)
    await ui.clickRow(`${ws}/readme.md`)
    await waitFor(`window.api.getOpenTabs().then((s) => s.paths.length >= 2)`, { timeoutMs: 8000 })
    const before = JSON.parse(fs.readFileSync(path.join(fixture.profile, 'openTabs.json'), 'utf-8'))

    // Right-click the tab, then the menu item - the same route a user takes.
    const target = `${ws}/readme.md`
    const rect = await ui.rectOf(`[data-tab-path="${target}"]`)
    await ui.clickAt(rect.x + 20, rect.cy, { button: 'right' })
    await ui.clickButton('Move to New Window')

    const opened = await (async () => {
      for (let i = 0; i < 40; i++) {
        if ((await main.evaluate(windowCount)) === 2) return true
        await sleep(200)
      }
      return false
    })()
    check('tearing a tab off opens a second window', opened, String(await main.evaluate(windowCount)))

    check(
      'the tab leaves the window it came from',
      await waitFor(
        `[...document.querySelectorAll('[data-tab-path]')].every((t) => t.dataset.tabPath !== ${JSON.stringify(target)})`,
        { timeoutMs: 5000 }
      )
    )

    // The new window's own renderer: it opened with that one file, and knows
    // it does not own the session.
    const newIds = (await main.evaluate(windowIds)).filter((id) => !idsBefore.includes(id))
    check('exactly one window was added', newIds.length === 1, JSON.stringify(newIds))
    if (newIds.length !== 1) return
    const detached = `require('electron').BrowserWindow.fromId(${newIds[0]})`
    // Its React tree mounts a beat after the window exists.
    for (let i = 0; i < 40; i++) {
      const mounted = await main.evaluate(
        `${detached}.webContents.executeJavaScript("!!document.querySelector('[data-tab-path]')")`
      )
      if (mounted) break
      await sleep(200)
    }
    const detachedTabs = await main.evaluate(
      `${detached}.webContents.executeJavaScript("[...document.querySelectorAll('[data-tab-path]')].map((t) => t.dataset.tabPath)")`
    )
    check(
      'the new window opens with the torn-off file',
      Array.isArray(detachedTabs) && detachedTabs.includes(target),
      JSON.stringify(detachedTabs)
    )
    const detachedInit = await main.evaluate(
      `${detached}.webContents.executeJavaScript('window.api.getWindowInit()')`
    )
    check(
      'and it does not own the session',
      detachedInit?.primary === false,
      JSON.stringify(detachedInit)
    )
    // Asked twice on purpose: React double-invokes mount effects in dev, and
    // an init that were consumed by the first read would leave the second
    // window empty (which is exactly what happened once).
    const askedAgain = await main.evaluate(
      `${detached}.webContents.executeJavaScript('window.api.getWindowInit()')`
    )
    check('asking for the init twice gives the same answer', askedAgain?.primary === false)

    await sleep(900)
    const after = JSON.parse(fs.readFileSync(path.join(fixture.profile, 'openTabs.json'), 'utf-8'))
    check(
      'the detached window leaves the saved session alone',
      after.paths.length >= before.paths.length - 1 && after.paths.includes(`${ws}/notes.txt`),
      JSON.stringify(after.paths)
    )

    // A torn-off window is the tab and its editor - the tree, the git panel
    // and the toolbar toggles all belong to the window it came from.
    const leanShape = await main.evaluate(
      `${detached}.webContents.executeJavaScript(${JSON.stringify(
        `({
          rows: document.querySelectorAll('[data-tree-row]').length,
          sidebarToggle: [...document.querySelectorAll('button')].some((b) =>
            /sidebar/i.test(b.getAttribute('aria-label') || '')),
          editor: !!document.querySelector('.monaco-editor')
        })`
      )})`
    )
    check('it has no file tree', leanShape?.rows === 0, JSON.stringify(leanShape))
    check('and no sidebar toggle in its toolbar', leanShape?.sidebarToggle === false)
    check('but it does have the editor', leanShape?.editor === true)

    // A terminal in one window must not be killed by the other reloading, so
    // ptys are owned per window; here just check the second window can open
    // one of its own at all.
    const spawned = await main.evaluate(
      `${detached}.webContents.executeJavaScript(${JSON.stringify(
        `window.api.createPty(${JSON.stringify(ws)}).then((id) => !!id).catch(() => false)`
      )})`
    )
    check('the second window can start its own terminal', spawned === true, String(spawned))

    // Pushing the tab back: it lands in the main window and takes the empty
    // window with it.
    await main.evaluate(
      `${detached}.webContents.executeJavaScript(${JSON.stringify(
        `(() => {
          const tab = document.querySelector('[data-tab-path]')
          const r = tab.getBoundingClientRect()
          const evt = new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 })
          tab.dispatchEvent(evt)
          return true
        })()`
      )})`
    )
    await sleep(300)
    await main.evaluate(
      `${detached}.webContents.executeJavaScript(${JSON.stringify(
        `(() => {
          const item = [...document.querySelectorAll('button')].find((b) =>
            b.innerText.includes('Move Back to Main Window'))
          if (!item) return false
          item.click()
          return true
        })()`
      )})`
    )

    const backHome = await (async () => {
      for (let i = 0; i < 40; i++) {
        if ((await main.evaluate(windowCount)) === 1) return true
        await sleep(200)
      }
      return false
    })()
    check('sending the tab back closes the window it was in', backHome)
    check(
      'and the tab is open in the main window again',
      await waitFor(
        `[...document.querySelectorAll('[data-tab-path]')].some((t) => t.dataset.tabPath === ${JSON.stringify(target)})`,
        { timeoutMs: 8000 }
      )
    )
    main.close()
  }
}
