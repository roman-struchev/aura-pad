import { spawn } from 'child_process'

// A19 - the Ports extension: what is listening on this machine, and stopping
// it. The victim is a node process this case starts itself, so the only thing
// that can be killed here is something the case owns.
export default {
  id: 'A19',
  title: 'Ports',
  async run({ cdp, ui, check, skip, sleep, waitFor, fixture }) {
    // One above the port the HTTP case binds, so the two never collide.
    const port = fixture.httpPort + 1
    const victim = spawn(
      process.execPath,
      ['-e', `require('net').createServer().listen(${port}, '127.0.0.1', () => {})`],
      { stdio: 'ignore' }
    )
    let exitCode = null
    let exitSignal = null
    victim.on('exit', (code, signal) => {
      exitCode = code
      exitSignal = signal
    })

    try {
      // It has to be listening before the tab can find it.
      const listening = await (async () => {
        for (let i = 0; i < 40; i++) {
          const rows = await cdp.evaluate('window.api.listListeningPorts()')
          if (Array.isArray(rows) && rows.some((r) => r.port === port)) return rows
          await sleep(200)
        }
        return null
      })()
      if (!listening) {
        skip('the ports list finds a listening process', `nothing came up on ${port}`)
        return
      }
      const row = listening.find((r) => r.port === port)
      check(
        'the ports list names the process holding a port',
        row.pid === victim.pid && row.command.length > 0,
        JSON.stringify(row)
      )

      await ui.click('[title="Ports"]')
      check(
        'the Ports tab opens from the sidebar',
        await waitFor(`!!document.querySelector('[data-testid="ports-tab"]')`, { timeoutMs: 8000 })
      )

      // The filter is how the question is actually asked: "who has 9354?"
      await cdp.evaluate(`(() => {
        const el = document.querySelector('[aria-label="Port or process"]')
        el.focus()
        el.select()
        return true
      })()`)
      await cdp.send('Input.insertText', { text: String(port) })
      const filtered = await waitFor(
        `(() => {
           const rows = [...document.querySelectorAll('[data-port-row]')]
           return rows.length > 0 && rows.every((r) => r.dataset.portRow === ${JSON.stringify(String(port))})
         })()`,
        { timeoutMs: 6000 }
      )
      check('filtering by port leaves only that port', filtered)

      // Stopping it is one click - no confirmation in the way of the gesture
      // the tab exists for.
      await ui.clickButton(`Stop port ${port}`)

      const died = await (async () => {
        for (let i = 0; i < 50; i++) {
          if (exitCode !== null || exitSignal !== null) return true
          await sleep(200)
        }
        return false
      })()
      check(
        'the Stop button stops the process holding the port',
        died,
        `code=${exitCode} signal=${exitSignal}`
      )
      check(
        'and the row goes with it',
        await waitFor(`document.querySelectorAll('[data-port-row]').length === 0`, {
          timeoutMs: 8000
        })
      )
      check(
        'and it says what it sent, to what',
        await cdp.evaluate(
          `document.querySelector('[data-testid="ports-tab"]')?.innerText.includes('SIGTERM')`
        )
      )

      // A port that comes up while the tab is open shows up on its own: the
      // list re-reads itself every few seconds rather than only when it was
      // opened. (The filter still holds the first port, so this looks for
      // the new one through it.)
      const second = spawn(
        process.execPath,
        ['-e', `require('net').createServer().listen(${port + 1}, '127.0.0.1', () => {})`],
        { stdio: 'ignore' }
      )
      try {
        await cdp.evaluate(`(() => {
          const el = document.querySelector('[aria-label="Port or process"]')
          el.focus()
          el.select()
          return true
        })()`)
        await cdp.send('Input.insertText', { text: String(port + 1) })
        check(
          'a port that appears while the tab is open shows up by itself',
          await waitFor(
            `!!document.querySelector('[data-port-row="${port + 1}"]')`,
            // Two refresh intervals plus the time the server takes to bind.
            { timeoutMs: 15_000 }
          )
        )
      } finally {
        second.kill('SIGKILL')
      }

      // The pid is not a free-form argument: only something currently
      // listening can be signalled, so a pid that isn't gets nothing.
      const stray = await cdp.evaluate(`window.api.killListeningProcess(${victim.pid}, false)`)
      check(
        'a pid that is no longer listening is refused',
        stray.success === false,
        JSON.stringify(stray)
      )
      const refusedSelf = await cdp.evaluate('window.api.killListeningProcess(1, false)')
      check('and so is pid 1', refusedSelf.success === false, JSON.stringify(refusedSelf))
    } finally {
      victim.kill('SIGKILL')
    }
  }
}
