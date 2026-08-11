// A8 - the built-in terminal really runs a shell in the right directory.
export default {
  id: 'A8',
  title: 'Terminal',
  async run({ cdp, ws, check, waitFor }) {
    const termId = await cdp.evaluate(`window.api.createPty(${JSON.stringify(ws)})`)
    check(
      'a terminal session starts',
      typeof termId === 'string' && termId.length > 0,
      String(termId)
    )
    if (typeof termId !== 'string') return

    // The pty's output is collected straight off the IPC channel: xterm's DOM
    // only repaints when the window is frontmost.
    await cdp.evaluate(`(() => {
      window.__ptyOut = ''
      window.api.onPtyData(${JSON.stringify(termId)}, (d) => { window.__ptyOut += d })
      return true
    })()`)

    // A login shell prints its prompt (and any rc-file noise) first; writing
    // before it is ready loses the command.
    const promptReady = await waitFor(`window.__ptyOut.length > 0`, { timeoutMs: 10_000 })
    check('the shell starts and prints its prompt', promptReady)

    await cdp.evaluate(
      `window.api.ptyWrite(${JSON.stringify(termId)}, 'echo SMOKE_MARKER_OK; pwd\\r')`
    )
    const echoed = await waitFor(`window.__ptyOut.includes('SMOKE_MARKER_OK\\r\\n')`, {
      timeoutMs: 10_000
    })
    check(
      'a typed command runs and its output comes back',
      echoed,
      JSON.stringify((await cdp.evaluate('window.__ptyOut')).slice(-120))
    )

    // `pwd` resolves symlinks (/var -> /private/var on macOS), so accept either.
    const cwdOk = await waitFor(
      `window.__ptyOut.includes(${JSON.stringify(ws)}) ||
       window.__ptyOut.includes(${JSON.stringify(ws.replace(/^\/private/, ''))}) ||
       window.__ptyOut.includes(${JSON.stringify('/private' + ws)})`,
      { timeoutMs: 8000 }
    )
    check(
      'it starts in the directory it was opened for',
      cwdOk,
      JSON.stringify((await cdp.evaluate('window.__ptyOut')).slice(-160))
    )

    await cdp.evaluate(`window.api.destroyPty(${JSON.stringify(termId)})`)
    const secondId = await cdp.evaluate(`window.api.createPty(${JSON.stringify(ws)})`)
    check('another session can be opened after closing one', secondId !== termId)
    await cdp.evaluate(`window.api.destroyPty(${JSON.stringify(secondId)})`)
  }
}
