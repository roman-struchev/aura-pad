import fs from 'fs'
import path from 'path'

// A 1x1 transparent PNG - enough for the clipboard to hold a real image.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// A16 - pasting an image into a Markdown file writes it next to the document
// and leaves a relative link behind.
export default {
  id: 'A16',
  title: 'Markdown image paste',
  async run({ cdp, ui, ws, check, skip, connectMain, waitFor, sleep }) {
    const main = await connectMain()
    if (!main) {
      skip('an image on the clipboard is pasted into the document', 'no --inspect target')
      return
    }

    const doc = path.join(ws, 'pasted.md')
    fs.writeFileSync(doc, 'before\n')
    await sleep(600)
    await ui.clickRow(doc)
    await waitFor(
      `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(doc)})`,
      { timeoutMs: 8000 }
    )
    await ui.focusEditor()

    // The clipboard is the real one - main reads it, not the renderer.
    const written = await main.evaluate(`(() => {
      const { clipboard, nativeImage } = require('electron')
      clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(${JSON.stringify(PNG_BASE64)}, 'base64')))
      return !clipboard.readImage().isEmpty()
    })()`)
    check('an image is on the clipboard', written === true)

    // A real paste event carrying an image: the handler only looks at whether
    // the paste has one, so a DataTransfer built here is faithful enough.
    const dispatched = await cdp.evaluate(`(() => {
      const dom = document.querySelector('.monaco-editor')
      if (!dom) return 'no editor'
      const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }))
      dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      return 'sent'
    })()`)
    check('the paste reached the editor', dispatched === 'sent', String(dispatched))

    const assetsDir = path.join(ws, 'assets')
    const landed = await (async () => {
      for (let i = 0; i < 40; i++) {
        if (fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).some((f) => f.endsWith('.png'))) {
          return true
        }
        await sleep(200)
      }
      return false
    })()
    check('the image is written next to the document', landed)

    // Autosave carries the inserted link to disk (~1.2s).
    const linked = await (async () => {
      for (let i = 0; i < 40; i++) {
        const text = fs.readFileSync(doc, 'utf-8')
        if (/!\[[^\]]*\]\(assets\/image-[\d-]+\.png\)/.test(text)) return text
        await sleep(200)
      }
      return fs.readFileSync(doc, 'utf-8')
    })()
    check(
      'and the document gets a relative link to it',
      /!\[[^\]]*\]\(assets\/image-[\d-]+\.png\)/.test(linked),
      JSON.stringify(linked)
    )

    // The preview has to show it: the page's CSP has no file: source, so main
    // hands the bytes over as a data: URL.
    await ui.togglePreview()
    const shown = await waitFor(
      `!!document.querySelector('.markdown-body img[src^="data:image/png"]')`,
      { timeoutMs: 8000 }
    )
    check('the Markdown preview renders the pasted image', shown)
    await ui.togglePreview()
    await sleep(300)

    // Only Markdown: the same paste in a .txt file is left to Monaco.
    const plain = path.join(ws, 'notes.txt')
    await ui.clickRow(plain)
    await waitFor(
      `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(plain)})`,
      { timeoutMs: 8000 }
    )
    const before = fs.readdirSync(assetsDir).length
    await cdp.evaluate(`(() => {
      const dom = document.querySelector('.monaco-editor')
      const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }))
      dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      return true
    })()`)
    await sleep(1200)
    check(
      'pasting an image into a non-Markdown file writes nothing',
      fs.readdirSync(assetsDir).length === before,
      String(fs.readdirSync(assetsDir).length)
    )

    // A path outside the allowed folders is refused like any other write.
    const refused = await cdp.evaluate(
      `window.api.savePastedImage(${JSON.stringify(path.join(ws, '..', '..', 'nowhere.md'))})`
    )
    check('an image cannot be planted outside the workspace', refused.success === false, refused.error)

    await ui.closeTab('pasted.md')
    fs.rmSync(doc, { force: true })
    fs.rmSync(assetsDir, { recursive: true, force: true })
    main.close()
    await sleep(500)
  }
}
