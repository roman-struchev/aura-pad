import fs from 'fs'
import path from 'path'
import { MOD } from '../ui.mjs'

const QUICK_OPEN = 'input[placeholder^="Search files"]'
const PALETTE = 'input[placeholder^="Type an action"]'
// Cmd on macOS, Ctrl elsewhere - the same split useGlobalHotkeys makes.
const CMD = process.platform === 'darwin' ? MOD.meta : MOD.ctrl

// A20 - going somewhere: Quick Open's ":line" and "#symbol" modes (which are
// also the file-structure view) and the command palette. All three are
// renderer-level shortcuts, so unlike the native-menu accelerators they can
// be driven from here.
export default {
  id: 'A20',
  title: 'Go to line, file structure, command palette',
  async run({ cdp, ui, ws, check, waitFor, sleep }) {
    const script = path.join(ws, 'nav.ts')
    fs.writeFileSync(
      script,
      [
        'export const NAV_LIMIT = 3',
        '',
        'export interface NavThing {',
        '  id: string',
        '}',
        '',
        'export class NavStore {',
        '  load(id: string): NavThing {',
        '    return { id }',
        '  }',
        '}',
        '',
        'export function buildThing(id: string): NavThing {',
        '  return new NavStore().load(id)',
        '}',
        '',
        'const renderThing = (thing: NavThing): string => thing.id',
        '',
        'export default renderThing'
      ].join('\n') + '\n'
    )
    const doc = path.join(ws, 'nav.md')
    fs.writeFileSync(doc, '# Nav doc\n\n## Middle\n\n```sh\n# not a heading\n```\n\n## Deep end\n')
    check('the fixture files reach the tree', await ui.waitForRow(script))
    await ui.waitForRow(doc)
    check('the file to navigate opens', await ui.openFile(script))

    // ---- Cmd+L: go to line ----
    await ui.key('l', 'KeyL', 76, CMD)
    const lineMode = await waitFor(`document.querySelector('${QUICK_OPEN}')?.value === ':'`, {
      timeoutMs: 4000
    })
    check('Cmd+L opens Quick Open already in line mode', lineMode)
    await cdp.send('Input.insertText', { text: '12' })
    await sleep(300)
    check(
      'a line number offers itself as the one result',
      (await cdp.evaluate(
        `document.querySelector('[data-quick-open-line]')?.dataset.quickOpenLine`
      )) === '12'
    )
    await ui.key('Enter', 'Enter', 13)
    check(
      'Enter takes the dialog away',
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )

    // ---- Cmd+F12: the file's structure ----
    await ui.key('F12', 'F12', 123, CMD)
    const structureMode = await waitFor(`document.querySelector('${QUICK_OPEN}')?.value === '#'`, {
      timeoutMs: 4000
    })
    check('Cmd+F12 opens it in structure mode', structureMode)
    await sleep(300)
    // Read the rows, not the page text: the editor sitting behind the
    // overlay holds the very same words.
    const symbolRows = () =>
      cdp.evaluate(
        `[...document.querySelectorAll('[data-quick-open-symbol]')].map((e) => e.dataset.quickOpenSymbol)`
      )
    const listed = await symbolRows()
    check(
      'the structure lists the classes, functions and constants of the open file',
      ['NavStore', 'buildThing', 'renderThing', 'NavThing', 'NAV_LIMIT', 'load'].every((name) =>
        listed.includes(name)
      ),
      JSON.stringify(listed)
    )
    check('and it says which file it is showing', (await ui.bodyText()).includes('in nav.ts'))

    await cdp.send('Input.insertText', { text: 'bldth' })
    await sleep(300)
    const filtered = await symbolRows()
    check(
      'a fuzzy query narrows it to the one symbol',
      filtered.length === 1 && filtered[0] === 'buildThing',
      JSON.stringify(filtered)
    )
    await ui.key('Enter', 'Enter', 13)
    const jumped = await waitFor(
      `!document.querySelector('${QUICK_OPEN}')` +
        ` && window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(script)})`,
      { timeoutMs: 4000 }
    )
    check('picking a symbol closes the dialog and stays in the file', jumped)

    // ---- "file#symbol": the same locator, aimed at another file ----
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    check(
      'double-Shift still opens plain Quick Open',
      await waitFor(`!!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )
    await cdp.send('Input.insertText', { text: 'nav.md#deep' })
    await sleep(400)
    check(
      'the file part still searches files',
      await cdp.evaluate(
        `[...document.querySelectorAll('[data-quick-open-file]')]
           .some((e) => e.dataset.quickOpenFile.endsWith('/nav.md'))`
      )
    )
    await ui.key('Enter', 'Enter', 13)
    const opened = await waitFor(
      `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(doc)})`,
      { timeoutMs: 6000 }
    )
    check('Enter opens that file at its symbol', opened)

    // Markdown structure: headings, and nothing from inside a fenced block.
    await ui.key('F12', 'F12', 123, CMD)
    await waitFor(`document.querySelector('${QUICK_OPEN}')?.value === '#'`, { timeoutMs: 4000 })
    await sleep(300)
    const headings = await ui.bodyText()
    check(
      'a markdown file lists its headings and skips the fenced code block',
      headings.includes('Nav doc') &&
        headings.includes('Deep end') &&
        !headings.includes('not a heading'),
      headings.slice(0, 300)
    )
    await ui.key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })

    // A mode key pressed over an already-open Quick Open must reset it, not
    // leave the previous query sitting there.
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await waitFor(`!!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    await cdp.send('Input.insertText', { text: 'nav' })
    await sleep(300)
    await ui.key('l', 'KeyL', 76, CMD)
    check(
      'Cmd+L over an open Quick Open re-seeds it',
      await waitFor(`document.querySelector('${QUICK_OPEN}')?.value === ':'`, { timeoutMs: 4000 })
    )
    await ui.key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })

    // ---- Cmd+Shift+A: the command palette ----
    await ui.key('A', 'KeyA', 65, CMD | MOD.shift)
    const paletteOpen = await waitFor(`!!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })
    check('Cmd+Shift+A opens the command palette', paletteOpen)
    if (!paletteOpen) return
    check(
      'it lists actions from the native menu and beyond it',
      await cdp.evaluate(
        `['toggle-terminal', 'go-to-line', 'new-terminal', 'reveal-active-file']
           .every((id) => !!document.querySelector('[data-command="' + id + '"]'))`
      )
    )
    await cdp.send('Input.insertText', { text: 'tgltrm' })
    await sleep(300)
    check(
      'a fuzzy query finds the action',
      await cdp.evaluate(
        `document.querySelectorAll('[data-command]').length === 1
           && !!document.querySelector('[data-command="toggle-terminal"]')`
      ),
      await ui.bodyText()
    )
    await ui.key('Escape', 'Escape', 27)
    check(
      'Escape closes it',
      await waitFor(`!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })
    )

    // Running one for real: the sidebar toggle is settings-backed, so the
    // effect is visible in app state rather than only on screen.
    const before = (await cdp.evaluate(`window.api.getSettings()`)).sidebarVisible
    await ui.key('A', 'KeyA', 65, CMD | MOD.shift)
    await waitFor(`!!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })
    await cdp.send('Input.insertText', { text: 'toggle sidebar' })
    await sleep(300)
    await ui.key('Enter', 'Enter', 13)
    const toggled = await waitFor(
      `window.api.getSettings().then((s) => s.sidebarVisible === ${!before})`,
      { timeoutMs: 6000 }
    )
    check('Enter runs the action it had selected', toggled)
    check(
      'and the palette is gone once it has run',
      await waitFor(`!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })
    )

    // Put the sidebar back, again through the palette.
    await ui.key('A', 'KeyA', 65, CMD | MOD.shift)
    await waitFor(`!!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })
    await cdp.send('Input.insertText', { text: 'toggle sidebar' })
    await sleep(300)
    await ui.key('Enter', 'Enter', 13)
    await waitFor(`window.api.getSettings().then((s) => s.sidebarVisible === ${before})`, {
      timeoutMs: 6000
    })

    // ---- readable in the light theme, not only the dark one ----
    // Both dialogs paint themselves on the sidebar colour, which is near-white
    // in two of the four themes; a fixed grey label is legible on exactly one
    // side of that list (the same trap the context menu hit).
    const settings = await cdp.evaluate('window.api.getSettings()')
    await cdp.evaluate(
      `window.api.saveSettings(${JSON.stringify({ ...settings, theme: 'light' })})`
    )
    await sleep(600)

    await ui.key('A', 'KeyA', 65, CMD | MOD.shift)
    await waitFor(`!!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })
    await sleep(300)
    const paletteContrast = await ui.contrastOf('[data-command] span:nth-child(2)')
    check(
      'the palette reads in the light theme',
      paletteContrast !== null && paletteContrast >= 4.5,
      String(paletteContrast)
    )
    await ui.key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('${PALETTE}')`, { timeoutMs: 4000 })

    await ui.openFile(script)
    await ui.key('F12', 'F12', 123, CMD)
    await waitFor(`!!document.querySelector('[data-quick-open-symbol]')`, { timeoutMs: 4000 })
    await sleep(300)
    const symbolContrast = await ui.contrastOf('[data-quick-open-symbol] span')
    check(
      'and so do the structure rows',
      symbolContrast !== null && symbolContrast >= 4.5,
      String(symbolContrast)
    )
    await ui.key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    await cdp.evaluate(`window.api.saveSettings(${JSON.stringify(settings)})`)
    await sleep(400)

    fs.rmSync(script, { force: true })
    fs.rmSync(doc, { force: true })
    await sleep(400)
  }
}
