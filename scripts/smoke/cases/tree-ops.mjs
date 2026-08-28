import fs from 'fs'

// A4 - creating, renaming, copying, moving and deleting through the tree,
// driven the way a user does it (row hover actions, context menu, shortcuts).
export default {
  id: 'A4',
  title: 'File operations',
  async run({ cdp, ui, ws, check, skip, waitFor, sleep }) {
    // Create: the "New File" action on the root row, then the name dialog.
    await ui.hover(ui.treeRow(ws))
    const newFile = await cdp.evaluate(`(() => {
      const row = document.querySelector('[data-tree-row][data-path=${JSON.stringify(ws)}]')
      const b = row && [...row.querySelectorAll('button')].find((b) => b.title === 'New File')
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })()`)
    check('the tree offers a "New File" action', !!newFile)
    if (newFile) {
      await ui.clickAt(newFile.cx, newFile.cy)
      const input = await waitFor(`!!document.querySelector('input[data-autofocus]')`)
      check('it asks for a name', input)
      await cdp.send('Input.insertText', { text: 'created.txt' })
      await ui.key('Enter', 'Enter', 13)
      const exists = await waitFor(`!!document.querySelector('[data-path="${ws}/created.txt"]')`, {
        timeoutMs: 6000
      })
      check('the new file appears in the tree', exists && fs.existsSync(`${ws}/created.txt`))
    }

    const dupe = await cdp.evaluate(
      `window.api.createPath(${JSON.stringify(ws)}, 'created.txt', 'file')`
    )
    check('creating a duplicate name is refused', !dupe.success, dupe.error ?? '')

    const renamed = await cdp.evaluate(
      `window.api.renamePath(${JSON.stringify(`${ws}/created.txt`)}, 'renamed.txt')`
    )
    check(
      'a file can be renamed',
      renamed.success && fs.existsSync(`${ws}/renamed.txt`) && !fs.existsSync(`${ws}/created.txt`)
    )

    const moved = await cdp.evaluate(
      `window.api.movePath(${JSON.stringify(`${ws}/renamed.txt`)}, ${JSON.stringify(`${ws}/dest`)})`
    )
    check('a file moves into a folder', moved.success && fs.existsSync(`${ws}/dest/renamed.txt`))

    fs.writeFileSync(`${ws}/renamed.txt`, 'clashing name\n')
    const clash = await cdp.evaluate(
      `window.api.movePath(${JSON.stringify(`${ws}/renamed.txt`)}, ${JSON.stringify(`${ws}/dest`)})`
    )
    check(
      'moving onto an existing name is refused instead of overwriting',
      !clash.success && fs.readFileSync(`${ws}/renamed.txt`, 'utf-8') === 'clashing name\n',
      clash.error ?? ''
    )

    // Copy/paste of the tree selection, via the real shortcuts.
    await ui.clickRow(`${ws}/notes.txt`)
    await ui.key('c', 'KeyC', 67, 4)
    await sleep(300)
    const clipboard = await cdp.evaluate('window.api.readClipboardFiles()')
    check(
      'Cmd+C puts the selected file on the clipboard',
      clipboard.includes(`${ws}/notes.txt`),
      JSON.stringify(clipboard)
    )

    await ui.clickRow(`${ws}/dest`)
    await ui.key('v', 'KeyV', 86, 4)
    const pasted = await waitFor(
      `window.api.readFile(${JSON.stringify(`${ws}/dest/notes.txt`)}).then((r) => r.success)`,
      { timeoutMs: 6000 }
    )
    check('Cmd+V pastes it into the selected folder', pasted)

    // Multi-select, then delete the whole selection.
    await cdp.evaluate(
      `window.api.createPath(${JSON.stringify(ws)}, 'doomed-a.txt', 'file')
        .then(() => window.api.createPath(${JSON.stringify(ws)}, 'doomed-b.txt', 'file'))`
    )
    const bothVisible = await waitFor(
      `!!document.querySelector('[data-path="${ws}/doomed-a.txt"]') &&
       !!document.querySelector('[data-path="${ws}/doomed-b.txt"]')`,
      { timeoutMs: 8000 }
    )
    check('files created outside the app show up in the tree', bothVisible)

    if (bothVisible) {
      await ui.clickRow(`${ws}/doomed-a.txt`)
      await ui.clickRow(`${ws}/doomed-b.txt`, { modifiers: 4 })
      const selected = await ui.selectedPaths()
      check(
        'Cmd+click selects several rows',
        selected.includes(`${ws}/doomed-a.txt`) && selected.includes(`${ws}/doomed-b.txt`),
        JSON.stringify(selected)
      )

      await ui.key('Backspace', 'Backspace', 8)
      const confirmShown = await waitFor(
        `!![...document.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')`,
        { timeoutMs: 4000 }
      )
      check('deleting asks for confirmation first', confirmShown)
      if (confirmShown) {
        await cdp.evaluate(
          `[...document.querySelectorAll('button')].find((b) => b.textContent === 'Confirm').click()`
        )
        const gone = await waitFor(`!document.querySelector('[data-path="${ws}/doomed-a.txt"]')`, {
          timeoutMs: 6000
        })
        check(
          'the whole selection goes to Trash',
          gone && !fs.existsSync(`${ws}/doomed-a.txt`) && !fs.existsSync(`${ws}/doomed-b.txt`)
        )
      }
    }

    // The context menu stays inside the window with the sidebar docked right,
    // where every right-click lands a few pixels from the viewport edge. The
    // root row is the widest menu ("Remove from Workspace"), and the width the
    // menu is *measured* at is exactly what used to be wrong here.
    const setSidebar = async (side) => {
      await ui.clickButton('settings')
      await sleep(400)
      const ok = await cdp.evaluate(`(() => {
        const sel = [...document.querySelectorAll('select')].find((s) =>
          [...s.options].some((o) => o.value === 'right') &&
          [...s.options].some((o) => o.value === 'left'))
        if (!sel) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(sel, ${JSON.stringify(side)})
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await ui.key('Escape', 'Escape', 27)
      await sleep(400)
      return ok
    }

    // ---- Copy Path / Copy Relative Path / Open in Default App ----
    const nested = `${ws}/src/main.ts`
    if (!(await ui.rowExists(nested))) await ui.clickRow(`${ws}/src`)
    const readClipboard = async () => {
      try {
        return await cdp.evaluate('navigator.clipboard.readText()')
      } catch {
        return null
      }
    }
    const menuAction = async (label) => {
      const row = await ui.rectOf(ui.treeRow(nested))
      await ui.clickAt(row.x + 20, row.y + row.h / 2, { button: 'right' })
      await sleep(200)
      await ui.clickButton(label)
      await sleep(200)
    }

    await menuAction('Copy Path')
    const absolute = await readClipboard()
    if (absolute === null) skip('the tree copies a file path', 'clipboard read denied')
    else check('the tree copies a file path', absolute === nested, String(absolute))

    await menuAction('Copy Relative Path')
    const relative = await readClipboard()
    if (relative === null) skip('and the same path relative to its project', 'clipboard denied')
    else
      check('and the same path relative to its project', relative === 'src/main.ts', String(relative))

    // Present but never clicked: it would hand the file to a real application
    // on whoever's machine is running the suite.
    const row = await ui.rectOf(ui.treeRow(nested))
    await ui.clickAt(row.x + 20, row.y + row.h / 2, { button: 'right' })
    await sleep(200)
    check('the menu offers Open in Default App', await ui.buttonExists('Open in Default App'))
    await cdp.evaluate(`window.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await sleep(200)
    // Handing a file to another program is behind the same allowlist (BUGS §2).
    const refused = await cdp.evaluate(`window.api.openInDefaultApp('/etc/hosts')`)
    check('opening a path outside the workspaces is refused', refused.success === false, refused.error)

    // The menu has to be readable in every theme, not just the dark one it was
    // designed in: it paints itself on the sidebar colour, so fixed greys are
    // legible on exactly one side of the theme list. Measured as a real
    // contrast ratio, at rest and under the mouse (a real mouseMoved, so :hover
    // actually applies).
    const setTheme = async (value) => {
      await ui.clickButton('settings')
      await sleep(400)
      const ok = await cdp.evaluate(`(() => {
        const sel = [...document.querySelectorAll('select')].find((s) =>
          [...s.options].some((o) => o.value === 'light') &&
          [...s.options].some((o) => o.value === 'dark'))
        if (!sel) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(sel, ${JSON.stringify(value)})
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await ui.key('Escape', 'Escape', 27)
      await sleep(400)
      return ok
    }

    // Relative luminance and the WCAG contrast ratio, computed in the page
    // against whatever the theme actually resolved the CSS variables to.
    const menuContrast = () =>
      cdp.evaluate(`(() => {
        const item = document.querySelector('div.fixed[data-surface="tree"] button')
        if (!item) return null
        const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
        const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
        const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
        const backdrop = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor
            if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c
          }
          return 'rgb(255, 255, 255)'
        }
        const a = lum(rgb(getComputedStyle(item).color))
        const b = lum(rgb(backdrop(item)))
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
      })()`)

    if (await setTheme('light')) {
      const row = await ui.rectOf(ui.treeRow(nested))
      await ui.clickAt(row.x + 20, row.y + row.h / 2, { button: 'right' })
      await sleep(250)
      const resting = await menuContrast()
      check('the context menu is readable in the light theme', resting >= 4.5, String(resting))

      const item = await ui.rectOf('div.fixed[data-surface="tree"] button')
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: item.cx, y: item.cy })
      await sleep(200)
      const hovered = await menuContrast()
      check('and stays readable under the mouse', hovered >= 4.5, String(hovered))

      await cdp.evaluate(`window.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await sleep(200)
      await setTheme('dark')
    } else {
      check('the theme can be changed from settings', false)
    }

    if (await setSidebar('right')) {
      const row = await ui.rectOf(ui.treeRow(ws))
      // A few px inside the row's right edge: the worst case for the flip.
      await ui.clickAt(row.x + row.w - 6, row.y + row.h / 2, { button: 'right' })
      await sleep(300)
      const menu = await cdp.evaluate(`(() => {
        const el = document.querySelector('div.fixed[data-surface="tree"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                 vw: innerWidth, vh: innerHeight }
      })()`)
      check('right-clicking a tree row opens the context menu', !!menu)
      if (menu) {
        check(
          'it stays inside the window with the sidebar docked right',
          menu.left >= 0 && menu.right <= menu.vw && menu.top >= 0 && menu.bottom <= menu.vh,
          JSON.stringify(menu)
        )
      }
      await cdp.evaluate(`window.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await sleep(200)
      await setSidebar('left')
    } else {
      check('the sidebar side can be changed from settings', false)
    }
  }
}
