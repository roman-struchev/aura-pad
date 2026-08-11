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

  // Tree rows carry data-path (see lib/treeRows.ts), which makes them
  // addressable without guessing at row order.
  const treeRow = (path) => `[data-tree-row][data-path="${path}"]`
  const clickRow = (path, options) => click(treeRow(path), options)

  const rowExists = (path) =>
    cdp.evaluate(`!!document.querySelector(${JSON.stringify(treeRow(path))})`)

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
    treeRow,
    clickRow,
    rowExists,
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
