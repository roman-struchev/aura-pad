// Input + DOM helpers shared by the smoke cases.
//
// Everything here drives the app the way a user does (real mouse and key
// events through CDP) rather than calling React internals, so a case fails
// when the *app* is broken, not when a refactor moved a function.

import { sleep } from './cdp.mjs'

// CDP modifier bits.
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

export function makeUi(cdp) {
  const rectOf = async (selector) =>
    cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })()`)

  const clickAt = async (x, y, { button = 'left', modifiers = 0 } = {}) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: type === 'mouseMoved' ? 'none' : button,
        buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0,
        clickCount: 1,
        modifiers
      })
    }
    await sleep(120)
  }

  const click = async (selector, options) => {
    const r = await rectOf(selector)
    if (!r) throw new Error(`nothing to click: ${selector}`)
    await clickAt(r.cx, r.cy, options)
    return r
  }

  const hover = async (selector) => {
    const r = await rectOf(selector)
    if (!r) throw new Error(`nothing to hover: ${selector}`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.cy })
    await sleep(120)
    return r
  }

  const key = async (key, code, keyCode, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers
      })
    }
    await sleep(80)
  }

  // Monaco keeps focus on a hidden textarea and uses EditContext, so
  // execCommand-style insertion does nothing - click into the editor first,
  // then let CDP insert the text as if typed.
  const typeInEditor = async (text) => {
    await click('.monaco-editor')
    await cdp.send('Input.insertText', { text })
    await sleep(120)
  }

  // Keyboard shortcuts only reach Monaco while its hidden input has focus, and
  // clicking `.monaco-editor` aims at the element's centre - which for a short
  // file is the empty space below the last line, where the click does not
  // always move focus there. Anything about to send keys to the editor should
  // focus it explicitly instead of trusting a click.
  const focusEditor = async () => {
    const focused = await cdp.evaluate(`(() => {
      const el = document.querySelector('.monaco-editor .native-edit-context')
        || document.querySelector('.monaco-editor textarea')
      if (!el) return false
      el.focus()
      return document.activeElement === el
    })()`)
    if (!focused) throw new Error('could not focus the editor')
    await sleep(80)
  }

  // Tree rows carry data-path (see lib/treeRows.ts), which makes them
  // addressable without guessing at row order.
  const treeRow = (path) => `[data-tree-row][data-path="${path}"]`
  const pathAtPoint = (x, y) =>
    cdp.evaluate(`(() => {
      const el = document.elementFromPoint(${x}, ${y})
      return el?.closest('[data-tree-row]')?.dataset.path ?? null
    })()`)

  const rowPaths = () =>
    cdp.evaluate(`[...document.querySelectorAll('[data-tree-row]')].map((r) => r.dataset.path)`)

  // Clicking a tree row is a *coordinate* click (that's the point - it has to
  // go through real mouse events), and the tree re-renders whenever the
  // workspace changes on disk. The watcher is debounced, so a file a case
  // wrote a moment ago can land between measuring the row's rect and the
  // click reaching it, shifting every row below it and selecting the
  // neighbour instead - which then quietly fails a later assertion about the
  // file that *was* meant to be clicked. So: wait for the row list to hold
  // still, then check the point really still belongs to this row, and re-aim
  // if the tree moved anyway.
  const clickRow = async (path, options) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let previous = null
      for (let settle = 0; settle < 12; settle++) {
        const current = JSON.stringify(await rowPaths())
        if (current === previous) break
        previous = current
        await sleep(120)
      }
      const r = await rectOf(treeRow(path))
      if (!r) throw new Error(`nothing to click: ${treeRow(path)}`)
      if ((await pathAtPoint(r.cx, r.cy)) !== path) continue
      await clickAt(r.cx, r.cy, options)
      // null means something now covers the point - a right-click's context
      // menu, typically - which says nothing about the row having moved.
      const landed = await pathAtPoint(r.cx, r.cy)
      if (landed === null || landed === path) return r
    }
    throw new Error(`the tree kept shifting under the click for ${path}`)
  }

  const rowExists = (path) =>
    cdp.evaluate(`!!document.querySelector(${JSON.stringify(treeRow(path))})`)

  // Waits for a row to appear rather than sleeping a guessed number of
  // milliseconds after writing the file: the tree's watcher is debounced, and
  // "long enough on this machine" is how a case becomes flaky on another one.
  const waitForRow = async (path, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await rowExists(path)) return true
      await sleep(100)
    }
    return false
  }

  // The whole "open this file" gesture, which nearly every case starts with:
  // wait for the row, click it, and wait until the app says that tab is the
  // active one. Hand-rolled in each case before, three of the four steps at a
  // time, which is where the "the tree kept shifting" flakes came from.
  const openFile = async (path, options) => {
    if (!(await waitForRow(path))) throw new Error(`no tree row for ${path}`)
    await clickRow(path, options)
    const isActive = `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(path)})`
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (await cdp.evaluate(isActive)) return true
      await sleep(100)
    }
    return false
  }

  // A row is highlighted when its class list carries the bare active classes -
  // not the `hover:` variants, which are always present in the string.
  const selectedPaths = () =>
    cdp.evaluate(`[...document.querySelectorAll('[data-tree-row]')]
      .filter((r) => r.className.split(' ').includes('bg-fleet-active'))
      .map((r) => r.dataset.path)`)

  const findButton = (text) =>
    `[...document.querySelectorAll('button')].find((b) =>
       (b.innerText + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || ''))
         .toLowerCase().includes(${JSON.stringify(String(text).toLowerCase())}))`

  const buttonExists = (text) => cdp.evaluate(`!!(${findButton(text)})`)

  // Dispatched as a DOM click rather than synthetic mouse coordinates: the
  // toolbar sits in the window's `-webkit-app-region: drag` title bar, where
  // Chromium hands the press to window dragging and the button never sees it.
  // Everything else in the app is clicked for real (see clickAt).
  const clickButton = async (text) => {
    const clicked = await cdp.evaluate(`(() => {
      const b = ${findButton(text)}
      if (!b) return false
      b.click()
      return true
    })()`)
    if (!clicked) throw new Error(`no button matching "${text}"`)
    await sleep(200)
  }

  const bodyText = () => cdp.evaluate('document.body.innerText')

  // Tab-strip entries. Tree rows are draggable too, so the tab bar can only be
  // addressed by excluding them.
  const TAB_SELECTOR = '[draggable="true"]:not([data-tree-row])'
  const openTabLabels = () =>
    cdp.evaluate(
      `[...document.querySelectorAll('${TAB_SELECTOR}')].map((e) => e.innerText.split('\\n')[0])`
    )

  const clickTab = async (label) => {
    const target = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('${TAB_SELECTOR}')]
        .find((e) => e.innerText.startsWith(${JSON.stringify(label)}))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })()`)
    if (!target) throw new Error(`no tab labelled "${label}"`)
    await clickAt(target.cx, target.cy)
  }

  // The tab's close control is an inline icon (lucide renders an <svg>), not a
  // <button>, so it has to be addressed as the tab's own svg child.
  const closeTab = async (label) => {
    const target = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('${TAB_SELECTOR}')]
        .find((e) => e.innerText.startsWith(${JSON.stringify(label)}))
      const icon = el && el.querySelector('svg')
      if (!icon) return null
      const r = icon.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })()`)
    if (!target) throw new Error(`no close control on tab "${label}"`)
    await clickAt(target.cx, target.cy)
  }

  // The toolbar's preview button flips its label between "Show Preview" and
  // "Show Source", so callers that just want to flip it shouldn't have to know
  // which state it is in.
  const togglePreview = async () => {
    const label = await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((b) => /show (preview|source)/i.test(b.getAttribute('aria-label') || ''))
      if (!b) return null
      const label = b.getAttribute('aria-label')
      b.click()
      return label
    })()`)
    if (!label) throw new Error('no preview toggle in the toolbar')
    await sleep(300)
    return label
  }

  // The persisted session doubles as the app's own state readout: unlike
  // Monaco's DOM it is exact and available immediately.
  const openTabs = () => cdp.evaluate('window.api.getOpenTabs()')

  return {
    rectOf,
    clickAt,
    click,
    hover,
    key,
    typeInEditor,
    focusEditor,
    treeRow,
    clickRow,
    rowExists,
    waitForRow,
    openFile,
    selectedPaths,
    buttonExists,
    clickButton,
    openTabLabels,
    clickTab,
    closeTab,
    togglePreview,
    openTabs,
    bodyText
  }
}
