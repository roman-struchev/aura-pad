import fs from 'fs'
import os from 'os'
import path from 'path'
import { MOD } from '../ui.mjs'

const QUICK_OPEN = 'input[placeholder^="Search files"]'
const OPEN_IN_SIDEBAR = '[data-quick-open-open-in-tree]'

// A25 - a folder outside every workspace (think ~/.claude), opened from Quick
// Open's path mode into the sidebar's "Recently Opened (Outside)" section:
// browsable and editable there, kept across restarts, but not a project.
export default {
  id: 'A25',
  title: 'Outside folders from Quick Open',
  async run(ctx) {
    const { ws, fixture, check, waitFor, sleep } = ctx
    // Re-read after every restart: ctx.ui is rebuilt on the new connection.
    let ui = ctx.ui
    const cdp = () => ctx.cdp
    const ev = (expr) => cdp().evaluate(expr)
    const js = JSON.stringify

    // Next to the workspace, not in it: the fixture root is outside every root.
    const outside = path.join(fixture.root, 'outside-folders')
    const keep = path.join(outside, 'keep-me')
    const other = path.join(outside, 'also-me')
    const sub = path.join(keep, 'sub')
    fs.mkdirSync(sub, { recursive: true })
    fs.mkdirSync(other, { recursive: true })
    const note = path.join(keep, 'note.txt')
    const deep = path.join(sub, 'deep.txt')
    fs.writeFileSync(note, 'outside note uniqueoutsideword\n')
    fs.writeFileSync(deep, 'deep\n')
    fs.writeFileSync(path.join(other, 'x.txt'), 'x\n')

    const roots = () => ev(`window.api.getWorkspaces().then((t) => t.map((r) => r.path))`)
    const entries = () => ev(`window.api.getRecentExternalFiles()`)
    const listed = (p) => `!!document.querySelector('[data-outside-folder=${js(p)}]')`
    const row = (p) => `[data-quick-open-file=${js(p)}]`

    const openQuickOpen = async () => {
      await ui.key('Shift', 'ShiftLeft', 16, 8)
      await ui.key('Shift', 'ShiftLeft', 16, 8)
      return waitFor(`!!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    }
    const closeQuickOpen = async () => {
      await ui.key('Escape', 'Escape', 27)
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    }

    const rootsBefore = await roots()

    // ---- the dialog says that path mode exists at all ----
    check('quick open opens', await openQuickOpen())
    check(
      'the empty hint mentions browsing folders with ~/',
      await ev(`document.body.innerText.includes('to browse any folder')`)
    )

    // ---- the row-level action: on folders, not on files ----
    await cdp().send('Input.insertText', { text: outside + '/' })
    check(
      'path mode lists the outside folder',
      await waitFor(`!!document.querySelector(${js(row(keep))})`, { timeoutMs: 4000 })
    )
    // The first row (also-me, alphabetical) is selected: its button shows.
    check(
      'the selected folder row shows Open in Sidebar',
      await ev(`(() => {
        const b = document.querySelector(${js(`${row(other)} ${OPEN_IN_SIDEBAR}`)})
        return !!b && b.offsetParent !== null && b.innerText.includes('Open in Sidebar')
      })()`)
    )

    // Plain Enter still steps in, inside the dialog.
    await ui.key('ArrowDown', 'ArrowDown', 40)
    await ui.key('Enter', 'Enter', 13)
    check(
      'plain Enter on a folder steps into it',
      await waitFor(`document.querySelector('${QUICK_OPEN}')?.value === ${js(keep + '/')}`, {
        timeoutMs: 4000
      })
    )
    await waitFor(`!!document.querySelector(${js(row(note))})`, { timeoutMs: 4000 })
    await ui.key('ArrowDown', 'ArrowDown', 40) // sub/ first, then note.txt
    await sleep(100)
    check(
      'a file row has no Open in Sidebar action',
      await ev(`!document.querySelector(${js(`${row(note)} ${OPEN_IN_SIDEBAR}`)})`)
    )

    // Back up one level and Cmd+Enter on keep-me.
    await ev(`(() => {
      const input = document.querySelector('${QUICK_OPEN}')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, ${js(outside + '/')})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await waitFor(`!!document.querySelector(${js(row(keep))})`, { timeoutMs: 4000 })
    // By keyboard, not hover: the pointer may already sit over that row from
    // before the list re-rendered, and then no mouseenter fires.
    await ui.key('ArrowDown', 'ArrowDown', 40)
    await sleep(100)
    await ui.key('Enter', 'Enter', 13, MOD.meta)
    check(
      'Cmd+Enter closes quick open',
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )
    check(
      'the folder is listed under Recently Opened (Outside)',
      await waitFor(listed(keep), { timeoutMs: 6000 })
    )
    check(
      'as a folder entry',
      (await entries()).some((e) => e.path === keep && e.type === 'directory')
    )
    check(
      'and no workspace root is added',
      JSON.stringify(await roots()) === JSON.stringify(rootsBefore)
    )
    check('it is shown expanded', await ui.waitForRow(note))

    // ---- the button does what Cmd+Enter does ----
    await openQuickOpen()
    await cdp().send('Input.insertText', { text: outside + '/' })
    await waitFor(`!!document.querySelector(${js(row(other))})`, { timeoutMs: 4000 })
    await ev(`document.querySelector(${js(`${row(other)} ${OPEN_IN_SIDEBAR}`)}).click()`)
    check(
      'clicking Open in Sidebar closes quick open',
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )
    check('and lists that folder too', await waitFor(listed(other), { timeoutMs: 6000 }))

    // ---- refusals and folders a workspace already has ----
    await ev(`window.api.listPathMatches('~/')`)
    const home = await ev(`window.api.openOutsideFolder(${js(os.homedir())})`)
    check('the home folder itself is refused', typeof home.error === 'string', js(home))
    const unlisted = await ev(`window.api.openOutsideFolder('/usr/share')`)
    check('a folder never listed is refused', typeof unlisted.error === 'string')
    const inside = await ev(`window.api.openOutsideFolder(${js(path.join(ws, 'src'))})`)
    check('a folder inside a workspace is reported as covered', inside.covered === true)
    check(
      'and is not listed',
      !(await entries()).some((e) => e.path === path.join(ws, 'src'))
    )

    // ---- browsing and editing inside it ----
    await ui.clickRow(sub)
    check('a subfolder expands', await ui.waitForRow(deep))
    check('a file in it opens', await ui.openFile(note))
    const saved = await ev(`window.api.saveFile(${js(note)}, 'edited outside uniqueoutsideword\\n')`)
    check(
      'and saves to disk',
      saved.success && fs.readFileSync(note, 'utf-8') === 'edited outside uniqueoutsideword\n',
      js(saved)
    )
    await sleep(500)
    check(
      'opening a file in it adds no entry of its own',
      !(await entries()).some((e) => e.path === note)
    )
    fs.writeFileSync(path.join(keep, 'appeared.txt'), 'hi\n')
    check(
      'a file created on disk shows up',
      await ui.waitForRow(path.join(keep, 'appeared.txt'))
    )

    await ui.clickRow(keep, { button: 'right' })
    await sleep(200)
    const menuHas = (label) =>
      ev(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === ${js(label)})`)
    check(
      'its root offers no Remove from Workspace',
      !(await ui.buttonExists('Remove from Workspace'))
    )
    check('nor Rename (the entry is addressed by that path)', !(await menuHas('Rename')))
    // The menu item by its exact text: ui.clickButton also matches titles, and
    // the workspace root's hover icon is titled "New File" too.
    await ev(
      `[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New File').click()`
    )
    check(
      'New File asks for a name',
      await waitFor(`!!document.querySelector('input[data-autofocus]')`)
    )
    // Typed into the field itself: the context menu closing can leave focus
    // on the page rather than in the dialog's input.
    await ev(`document.querySelector('input[data-autofocus]').focus()`)
    await cdp().send('Input.insertText', { text: 'made-here.txt' })
    await ui.key('Enter', 'Enter', 13)
    await sleep(800)
    const madeRow = await ui.waitForRow(path.join(keep, 'made-here.txt'))
    check(
      'a file created through the context menu lands on disk',
      fs.existsSync(path.join(keep, 'made-here.txt')),
      js(fs.readdirSync(keep))
    )
    check('and in the tree', madeRow)

    await ui.clickRow(note, { button: 'right' })
    await sleep(200)
    check('a file inside it can still be renamed', await menuHas('Rename'))
    await ui.key('Escape', 'Escape', 27)
    await sleep(200)

    // ---- not a project ----
    const hits = (await ev(`window.api.searchProjects('uniqueoutsideword')`)).results
    check(
      'search-in-files finds nothing in it',
      !hits.some((h) => h.path.startsWith(outside)),
      js(hits.map((h) => h.path))
    )

    // ---- readable in the light theme ----
    const settings = await ev('window.api.getSettings()')
    await ev(`window.api.saveSettings(${js({ ...settings, theme: 'light' })})`)
    await sleep(600)
    const entryContrast = await ui.contrastOf(
      `[data-outside-folder=${js(keep)}] [data-tree-row] span.truncate`
    )
    check(
      'the folder entry reads in the light theme',
      entryContrast !== null && entryContrast >= 4.5,
      String(entryContrast)
    )
    await openQuickOpen()
    await cdp().send('Input.insertText', { text: outside + '/' })
    await waitFor(`!!document.querySelector(${js(row(other))})`, { timeoutMs: 4000 })
    await sleep(200)
    const buttonContrast = await ui.contrastOf(`${row(other)} ${OPEN_IN_SIDEBAR} span`)
    check(
      'and so does Open in Sidebar',
      buttonContrast !== null && buttonContrast >= 4.5,
      String(buttonContrast)
    )
    await closeQuickOpen()
    await ev(`window.api.saveSettings(${js(settings)})`)
    await sleep(400)

    // ---- an entry written before folders existed still loads ----
    const legacy = path.join(outside, 'legacy.txt')
    fs.writeFileSync(legacy, 'legacy\n')
    const recentFile = path.join(fixture.profile, 'recentExternalFiles.json')
    const gone = path.join(outside, 'gone-folder')

    // ---- a restart keeps it ----
    await ctx.restart(() => {
      // Planted while the app is down, in the pre-folder format (no `type`).
      const onDisk = JSON.parse(fs.readFileSync(recentFile, 'utf-8'))
      fs.writeFileSync(
        recentFile,
        JSON.stringify([
          ...onDisk,
          { path: legacy, openedAt: Date.now() },
          // Saved before listed folders stopped nesting: a folder inside keep-me.
          { path: sub, openedAt: Date.now(), type: 'directory' },
          // A listed folder that has since gone from disk.
          { path: gone, openedAt: Date.now(), type: 'directory' }
        ])
      )
    })
    ui = ctx.ui
    check(
      'nothing about it reached workspaces.json',
      !JSON.parse(fs.readFileSync(path.join(fixture.profile, 'workspaces.json'), 'utf-8')).some(
        (p) => p.startsWith(outside)
      )
    )
    check('after a restart it is still listed', await waitFor(listed(keep), { timeoutMs: 10_000 }))
    const reread = await ev(`window.api.readFile(${js(note)})`)
    check(
      'and its files still read',
      reread.success && reread.content.startsWith('edited outside'),
      js(reread).slice(0, 200)
    )
    check(
      'an old-format file entry still loads as a file',
      (await entries()).some((e) => e.path === legacy && e.type === undefined)
    )
    check(
      'an older entry nested in a listed folder is dropped',
      await waitFor(
        `window.api.getRecentExternalFiles().then((l) => !l.some((e) => e.path === ${js(sub)}))`,
        { timeoutMs: 4000 }
      )
    )
    const goneRow = await ev(`(() => {
      const row = [...document.querySelectorAll('[title]')].find((e) => e.title.startsWith(${js(gone)}))
      return row ? { title: row.title } : null
    })()`)
    check(
      'a listed folder gone from disk says so rather than posing as a file',
      !!goneRow && goneRow.title.includes('no longer on disk'),
      js(goneRow)
    )

    // ---- × removes it ----
    check('a file in it opens again', await ui.openFile(note))
    await ui.hover(`[data-outside-folder=${js(keep)}]`)
    await ev(`document.querySelector('[data-remove-outside=${js(keep)}]').click()`)
    check('× removes the entry', await waitFor(`!${listed(keep)}`, { timeoutMs: 4000 }))
    check(
      'closes its tabs',
      await waitFor(`window.api.getOpenTabs().then((s) => !s.paths.includes(${js(note)}))`, {
        timeoutMs: 4000
      })
    )
    check('and leaves the folder on disk', fs.existsSync(note))

    // ---- listed folders don't nest ----
    const relist = async (p) => {
      await ev(`window.api.openOutsideFolder(${js(p)})`)
      return (await entries()).filter((e) => e.type === 'directory').map((e) => e.path)
    }
    // Removed and restarted: the folder has to be listed (granted) again first.
    await ev(`window.api.listPathMatches(${js(outside + '/')})`)
    await relist(keep)
    const afterInner = await relist(sub)
    check(
      'a folder inside a listed one is not listed separately',
      afterInner.includes(keep) && !afterInner.includes(sub),
      js(afterInner)
    )
    await ev(`window.api.listPathMatches(${js(fixture.root + '/')})`)
    const afterOuter = await relist(outside)
    check(
      'listing their parent replaces the folders inside it',
      afterOuter.includes(outside) && !afterOuter.includes(keep) && !afterOuter.includes(other),
      js(afterOuter)
    )

    for (const p of [outside, other, keep, legacy, gone]) {
      await ev(`window.api.removeRecentExternalFile(${js(p)})`)
    }
    fs.rmSync(outside, { recursive: true, force: true })
  }
}
