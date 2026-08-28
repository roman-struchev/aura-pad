const TERMINAL_BUTTON = 'button[aria-label="Toggle Terminal (Ctrl+`)"]'
const COMMIT_BOX = 'textarea[placeholder="Commit message"]'

// A8 - the built-in terminal really runs a shell in the right directory,
// and Cmd+K clears the one the user is typing in.
export default {
  id: 'A8',
  title: 'Terminal',
  async run({ cdp, ui, ws, check, skip, waitFor, sleep, connectMain }) {
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

    // Cmd+K with focus in the terminal clears it instead of toggling the git
    // panel. The accelerator itself belongs to the native menu and can't be
    // driven over CDP, so this sends the action the menu sends - the routing
    // in App.tsx, which is the part that can actually break, is what runs.
    const main = await connectMain()
    if (!main) {
      skip('Cmd+K clears the focused terminal', 'no --inspect target')
      return
    }
    const sendMenu = (action) =>
      main.evaluate(`(() => {
        require('electron').BrowserWindow.getAllWindows()[0]
          .webContents.send('menu-action', ${JSON.stringify(action)})
        return true
      })()`)

    // Toolbar buttons live in the title bar's drag region and ignore
    // synthetic mouse events - dispatch the DOM click instead.
    await cdp.evaluate(`document.querySelector(${JSON.stringify(TERMINAL_BUTTON)}).click()`)
    const panelUp = await waitFor(`!!document.querySelector('.xterm-helper-textarea')`, {
      timeoutMs: 10_000
    })
    check('the toolbar button opens a terminal in the panel', panelUp)
    if (!panelUp) return

    // A file has to be open for the second half of this: the editor is what
    // the panel used to be drawn on top of.
    await ui.openFile(`${ws}/notes.txt`)

    // Where the panel sits: the full width of the window (a narrow window
    // used to squeeze it into whatever the sidebar left of the editor
    // column), and above the editor rather than over it - a file whose last
    // lines end up underneath the panel can't be scrolled to.
    const geom = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-terminal-panel]')
      const editor = document.querySelector('.monaco-editor')
      if (!panel) return null
      const p = panel.getBoundingClientRect()
      return {
        left: Math.round(p.left),
        right: Math.round(p.right),
        top: Math.round(p.top),
        width: window.innerWidth,
        editorBottom: editor ? Math.round(editor.getBoundingClientRect().bottom) : null
      }
    })()`)
    check(
      'the panel spans the window from edge to edge',
      geom && geom.left === 0 && Math.abs(geom.right - geom.width) <= 1,
      JSON.stringify(geom)
    )
    check(
      'and the editor ends where it starts, not underneath it',
      geom && geom.editorBottom !== null && geom.editorBottom <= geom.top + 1,
      JSON.stringify(geom)
    )

    // Give the terminal both focus and something to clear.
    await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    for (const ch of 'echo SMOKE_CLEAR_MARKER') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch })
    }
    await ui.key('Enter', 'Enter', 13)

    // What Cmd+K did to the scrollback can only be read off the xterm DOM,
    // which doesn't repaint while the window is behind another app (the
    // buffer clears, the rows keep the old text) - so the visible clear is a
    // manual case (docs/TEST_CASES.md Part B) and what is checked here is
    // the routing: the key reached the terminal, not the git panel.
    await sendMenu('toggle-git-panel')
    await sleep(300)
    check(
      'Cmd+K with the terminal focused leaves the git panel shut',
      !(await cdp.evaluate(`!!document.querySelector(${JSON.stringify(COMMIT_BOX)})`))
    )
    check(
      'the shell behind it keeps running',
      await cdp.evaluate(`!!document.querySelector('.xterm-helper-textarea')`)
    )

    // Same key with focus anywhere else is still the git panel toggle.
    await cdp.evaluate(`document.activeElement?.blur()`)
    await sendMenu('toggle-git-panel')
    const gitOpened = await waitFor(`!!document.querySelector(${JSON.stringify(COMMIT_BOX)})`, {
      timeoutMs: 5000
    })
    check('outside the terminal it still toggles the git panel', gitOpened)

    // Leave the app as the next case expects it: files view, panel hidden.
    await sendMenu('toggle-git-panel')
    await waitFor(`!document.querySelector(${JSON.stringify(COMMIT_BOX)})`, { timeoutMs: 5000 })
    await cdp.evaluate(`document.querySelector(${JSON.stringify(TERMINAL_BUTTON)}).click()`)
    main.close()
  }
}
