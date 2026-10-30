// A13 - closing a window whose renderer isn't listening yet.
//
// main pauses every close and waits for the renderer to answer "nothing
// unsaved". A page that is still loading - right after launch, or during a
// dev-server reload - has no listener, so waiting for it would leave the
// window unclosable and, under `npm run dev`, orphan the whole process when
// electron-vite restarts it.
//
// Runs last, and macOS-only: elsewhere the last window closing quits the app,
// which would take the suite's own session with it.
export default {
  id: 'A13',
  title: 'Window lifecycle',
  async run({ check, skip, connectMain, reconnectRenderer, waitFor, sleep }) {
    if (process.platform !== 'darwin') {
      skip('a closing window is not quitting the app', 'darwin-only')
      return
    }
    const main = await connectMain()
    if (!main) {
      skip('the main process inspector is reachable', 'no --inspect target')
      return
    }

    const win = `require('electron').BrowserWindow.getAllWindows()[0]`
    const windowCount = `require('electron').BrowserWindow.getAllWindows().length`

    // Navigating away leaves a document that never announces itself - the
    // same state the app is in while its own page is still loading, but
    // without the race of trying to hit that window by timing alone.
    await main.evaluate(`(() => { ${win}.webContents.loadURL('about:blank'); return true })()`)
    const blank = await pollUntil(
      async () => (await main.evaluate(`${win}.webContents.getURL()`)) === 'about:blank',
      5000
    )
    check('the window can be pointed at a page with no listeners', blank)
    await sleep(300)
    await main.evaluate(`(() => { ${win}.close(); return true })()`)

    const closed = await pollUntil(async () => (await main.evaluate(windowCount)) === 0, 5000)
    check('a close is not vetoed by a renderer that never announced itself', closed)
    // Whatever the answer, the suite needs a live window back.
    if (!closed) await main.evaluate(`(() => { ${win}.destroy(); return true })()`)

    // Put the window back the way a dock click would, so `--keep` (and any
    // case added after this one) still has an app to talk to.
    await main.evaluate(`(() => { require('electron').app.emit('activate'); return true })()`)
    const reopened = await pollUntil(async () => (await main.evaluate(windowCount)) === 1, 10_000)
    main.close()
    check('the window comes back on activate', reopened)
    if (!reopened) return

    await reconnectRenderer()
    const restored = await waitFor(`!!document.querySelector('[data-tree-row]')`, {
      timeoutMs: 30_000
    })
    check('the reopened window restores the workspace', !!restored)
  }
}

async function pollUntil(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}
