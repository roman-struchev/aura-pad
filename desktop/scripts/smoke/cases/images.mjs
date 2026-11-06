import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

// A real PNG of the given size, every pixel transparent - built here rather
// than checked in, so a case can ask for whatever dimensions it needs.
function makePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height) // filter byte 0 + zeroed pixels
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// A23 - image files open in a read-only viewer instead of the binary-file
// error, and SVG gets a preview that never runs the file's script.
export default {
  id: 'A23',
  title: 'Image viewer and SVG preview',
  async run({ cdp, ui, ws, check, waitFor, sleep }) {
    const text = (sel) =>
      cdp.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText || ''`)
    const naturalWidth = () =>
      cdp.evaluate(`document.querySelector('[data-testid="zoomable-image"]')?.naturalWidth || 0`)

    const logo = path.join(ws, 'logo.png')
    fs.writeFileSync(logo, makePng(40, 30))
    check('a PNG opens as a tab', await ui.openFile(logo))
    check(
      'it shows the image, not the binary-file error',
      await waitFor(
        `document.querySelector('[data-testid="zoomable-image"]')?.naturalWidth === 40`,
        { timeoutMs: 8000 }
      ),
      String(await naturalWidth())
    )
    check('no "binary file" dialog appeared', !(await ui.bodyText()).includes('binary file'))
    check(
      'the info line gives its dimensions',
      (await text('[data-testid="image-info"]')).includes('40 × 30')
    )
    check(
      'a small image is not enlarged to fit',
      (await text('[data-testid="zoom-percent"]')) === '100%',
      await text('[data-testid="zoom-percent"]')
    )
    await ui.clickButton('Zoom In')
    check(
      'Zoom In enlarges it',
      (await text('[data-testid="zoom-percent"]')) === '125%',
      await text('[data-testid="zoom-percent"]')
    )
    await ui.clickButton('Fit')

    // Read-only: no text-only actions, and nothing is ever written back.
    const settings = await cdp.evaluate('window.api.getSettings()')
    if (settings?.extensions?.workTogether?.enabled) {
      check('Work Together share is not offered', !(await ui.buttonExists('Share…')))
    }
    check('there is no preview toggle for a raster image', !(await ui.buttonExists('Show Preview')))
    // Local History lives in the tab's context menu: nothing to show for a
    // file the editor never writes.
    const tabRect = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('[draggable="true"]:not([data-tree-row])')]
        .find((e) => e.innerText.startsWith('logo.png'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })()`)
    if (tabRect) {
      await ui.clickAt(tabRect.cx, tabRect.cy, { button: 'right' })
      await sleep(200)
      const historyItem = await cdp.evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Local History')
        return b ? (b.disabled ? 'disabled' : 'enabled') : 'absent'
      })()`)
      check('Local History is not offered on an image tab', historyItem !== 'enabled', historyItem)
      await ui.key('Escape', 'Escape', 27)
      await sleep(150)
    } else {
      check('the image tab is in the strip', false)
    }
    const before = fs.readFileSync(logo)
    await sleep(1600) // past the autosave delay
    check('the file is left untouched', fs.readFileSync(logo).equals(before))

    // Rewritten on disk (a fresh screenshot over the old one): the viewer follows.
    fs.writeFileSync(logo, makePng(20, 10))
    check(
      'an image rewritten on disk is shown anew',
      await waitFor(
        `(document.querySelector('[data-testid="image-info"]')?.innerText || '').includes('20 × 10')`,
        { timeoutMs: 8000 }
      ),
      await text('[data-testid="image-info"]')
    )

    // A big one fits the pane, and 1:1 brings it back to its pixel size.
    const big = path.join(ws, 'big.png')
    fs.writeFileSync(big, makePng(4000, 3000))
    await ui.openFile(big)
    await waitFor(
      `document.querySelector('[data-testid="zoomable-image"]')?.naturalWidth === 4000`,
      {
        timeoutMs: 8000
      }
    )
    const fitted = await text('[data-testid="zoom-percent"]')
    check('a large image is scaled down to fit', parseInt(fitted, 10) < 100, fitted)
    await ui.clickButton('Actual Size')
    check(
      '1:1 shows it at its natural size',
      (await text('[data-testid="zoom-percent"]')) === '100%',
      await text('[data-testid="zoom-percent"]')
    )

    // Extension case doesn't matter.
    const upper = path.join(ws, 'SHOT.PNG')
    fs.writeFileSync(upper, makePng(8, 8))
    await ui.openFile(upper)
    check(
      'an upper-case extension opens in the viewer too',
      await waitFor(
        `document.querySelector('[data-testid="zoomable-image"]')?.naturalWidth === 8`,
        { timeoutMs: 8000 }
      )
    )

    // Not an image at all, whatever the name says.
    const corrupt = path.join(ws, 'corrupt.png')
    fs.writeFileSync(corrupt, Buffer.from('definitely not a png\0\0\0'))
    await ui.openFile(corrupt)
    check(
      'an undecodable image says so in the tab',
      await waitFor(
        `(document.querySelector('[data-testid="image-error"]')?.innerText || '').includes('could not be decoded')`,
        { timeoutMs: 8000 }
      ),
      await text('[data-testid="image-viewer"]')
    )

    // SVG: text in the editor, an image in the preview - and its script inert.
    const svg = path.join(ws, 'icon.svg')
    fs.writeFileSync(
      svg,
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">' +
        '<rect width="64" height="32" fill="teal"/>' +
        '<script>window.top.__svgRan = 1</script></svg>\n'
    )
    await ui.openFile(svg)
    check(
      'an SVG opens in the editor, not the viewer',
      await waitFor(`!document.querySelector('[data-testid="image-viewer"]')`, { timeoutMs: 4000 })
    )
    check('an SVG offers a preview toggle', await ui.buttonExists('Show Preview'))
    await ui.togglePreview()
    check(
      'the SVG preview draws it as an image',
      await waitFor(
        `(() => { const i = document.querySelector('[data-testid="zoomable-image"]'); return !!i && i.src.startsWith('data:image/svg+xml') && i.naturalWidth === 64 })()`,
        { timeoutMs: 8000 }
      )
    )
    check(
      'the script inside the SVG did not run',
      (await cdp.evaluate('window.__svgRan')) === undefined
    )
    await ui.togglePreview()

    for (const label of ['icon.svg', 'corrupt.png', 'SHOT.PNG', 'big.png', 'logo.png']) {
      await ui.closeTab(label).catch(() => {})
      await sleep(150)
    }
    for (const f of [logo, big, upper, corrupt, svg]) fs.rmSync(f, { force: true })
    await sleep(300)
  }
}
