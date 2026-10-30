import fs from 'fs'
import path from 'path'

// A9 - settings round-trip, the sidebar toggle, and session restore.
// The restore checks need a fresh process, so this case runs last of the
// UI-heavy ones and pays for the single restart the suite allows itself.
export default {
  id: 'A9',
  title: 'Settings and session restore',
  async run(ctx) {
    const { cdp, ui, fixture, check, waitFor, sleep } = ctx

    const before = await cdp.evaluate('window.api.getSettings()')
    check(
      'settings are readable',
      !!before && typeof before.theme === 'string',
      JSON.stringify(before?.theme)
    )

    await cdp.evaluate(
      `window.api.getSettings().then((s) => window.api.saveSettings({ ...s, theme: 'monokai' }))`
    )
    const after = await cdp.evaluate('window.api.getSettings()')
    check('a changed setting is returned by the next read', after.theme === 'monokai', after.theme)
    const onDisk = JSON.parse(fs.readFileSync(path.join(fixture.profile, 'settings.json'), 'utf-8'))
    check(
      'it is persisted to settings.json',
      onDisk.theme === 'monokai',
      JSON.stringify(onDisk.theme)
    )

    // The sidebar toggle button (Cmd+B is a native-menu accelerator, which
    // CDP-injected keys never reach - see docs/TEST_CASES.md).
    await ui.clickButton('Sidebar')
    const hidden = await waitFor(`!document.querySelector('[data-tree-row]')`, { timeoutMs: 3000 })
    check('the sidebar toggle hides the tree', hidden)
    const hiddenSetting = await cdp.evaluate(
      'window.api.getSettings().then((s) => s.sidebarVisible)'
    )
    check('and records it in settings', hiddenSetting === false, String(hiddenSetting))
    await ui.clickButton('Sidebar')
    check(
      'toggling again brings it back',
      await waitFor(`!!document.querySelector('[data-tree-row]')`)
    )

    // Restore: relaunch and check the persisted session comes back.
    await cdp.evaluate(
      `window.api.getSettings().then((s) => window.api.saveSettings({ ...s, theme: 'dark', tabsEnabled: true }))`
    )
    await sleep(700)
    const expected = JSON.parse(
      fs.readFileSync(path.join(fixture.profile, 'openTabs.json'), 'utf-8')
    )

    await ctx.restart()
    const restored = await ctx.waitFor(`window.api.getOpenTabs().then((s) => s.paths.length > 0)`, {
      timeoutMs: 10_000
    })
    check('the previous session is restored on relaunch', restored)
    const tabsNow = await ctx.cdp.evaluate(`window.api.getOpenTabs().then((s) => s.paths)`)
    check(
      'the same files are open again',
      expected.paths.every((p) => tabsNow.includes(p)),
      JSON.stringify(tabsNow)
    )
    const themeNow = await ctx.cdp.evaluate('window.api.getSettings().then((s) => s.theme)')
    check('settings survive the restart', themeNow === 'dark', String(themeNow))
  }
}
