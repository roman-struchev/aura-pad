import fs from 'fs'
import path from 'path'

// A3 - the tab strip: opening several files, switching, closing, persistence.
export default {
  id: 'A3',
  title: 'Tabs',
  async run({ cdp, ui, ws, fixture, check, waitFor, sleep }) {
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

    const active = (await ui.openTabs()).activeTabPath
    check('the last opened file is the active one', active === `${ws}/data.json`, String(active))

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
    // remembered, so it can be reopened from the sidebar later.
    const external = path.join(fixture.outside, 'external.txt')
    const externalRead = await cdp.evaluate(`window.api.readFile(${JSON.stringify(external)})`)
    check('a file outside the workspace can be opened', externalRead.success)
    await cdp.evaluate(`window.api.touchRecentExternalFile(${JSON.stringify(external)})`)
    const recent = await cdp.evaluate(
      `window.api.getRecentExternalFiles().then((e) => e.map((x) => x.path))`
    )
    check('it lands in the "recently opened outside" list', recent.includes(external))

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
