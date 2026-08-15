// A14 - the update toast, driven by the same events main sends during a real
// update (docs/TEST_CASES.md §9).
//
// The updater itself only runs in a packaged build against a real release, so
// the *install* stays manual (Part B 9.1-9.5); what is automated here is the
// renderer half: the notification/progress events pushed straight at the
// window's webContents, exactly as main's broadcast() does. Nothing here
// clicks Install - that would run the real install script and replace
// /Applications/AuraPad.app.
export default {
  id: 'A14',
  title: 'Update toast',
  async run({ cdp, check, skip, connectMain, waitFor, ui }) {
    const main = await connectMain()
    if (!main) {
      skip('the main process inspector is reachable', 'no --inspect target')
      return
    }

    const send = (channel, payload) =>
      main.evaluate(`(() => {
        require('electron').BrowserWindow.getAllWindows()[0]
          .webContents.send(${JSON.stringify(channel)}, ${JSON.stringify(payload)})
        return true
      })()`)

    const toastText = `document.querySelector('[data-update-toast]')?.textContent || ''`
    const barWidth = `document.querySelector('[data-update-bar]')?.style.width || ''`

    await send('update-notification', { version: '9.9.9', mode: 'script' })
    const offered = await waitFor(`/9\\.9\\.9 is available/.test(${toastText})`, {
      timeoutMs: 5000
    })
    check('a new version is announced with an Install button', offered)

    // The long half of a macOS install: curl's percentage, in the sentence and
    // as the hairline bar under it.
    await send('update-progress', { phase: 'download', percent: 42 })
    const downloading = await waitFor(`/Downloading AuraPad 9\\.9\\.9… 42%/.test(${toastText})`, {
      timeoutMs: 5000
    })
    check('download progress replaces the buttons with a percentage', downloading)
    check('the progress bar tracks the percentage', (await cdp.evaluate(barWidth)) === '42%')

    await send('update-progress', { phase: 'download', percent: 87 })
    const advanced = await waitFor(`${barWidth} === '87%'`, { timeoutMs: 5000 })
    check('later progress updates move it', advanced)

    // Mounting and copying the bundle: no meter to report, so the toast drops
    // the percentage rather than freezing it at the last download value.
    await send('update-progress', { phase: 'install' })
    const installing = await waitFor(
      `/Installing AuraPad 9\\.9\\.9… the app will restart itself\\./.test(${toastText})`,
      { timeoutMs: 5000 }
    )
    check('the install phase drops to an indeterminate note', installing)
    check('the progress bar is gone with no percentage to show', !(await cdp.evaluate(barWidth)))

    // A failed attempt has to clear the progress, not leave a stale 87%.
    await send('update-notification', { version: '9.9.9', mode: 'script', failed: true })
    const failed = await waitFor(`/Update failed/.test(${toastText})`, { timeoutMs: 5000 })
    check('a failed attempt shows the retry state', failed)
    check('the stale progress bar is dropped', !(await cdp.evaluate(barWidth)))

    main.close()

    // Leave the app the way the case found it - the toast sits over the
    // bottom-right corner every later case works in.
    await ui.click('[data-update-dismiss]')
    const dismissed = await waitFor(`!document.querySelector('[data-update-toast]')`, {
      timeoutMs: 5000
    })
    check('Later dismisses the toast', dismissed)
  }
}
