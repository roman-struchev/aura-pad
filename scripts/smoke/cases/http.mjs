import http from 'http'

// A12 - the HTTP client: .http request files, curl snippets, and the
// response pane. Everything runs against a throwaway server on loopback, so
// the case never depends on the network being up (or on someone's staging
// environment answering).
export default {
  id: 'A12',
  title: 'HTTP client',
  async run({ cdp, ui, ws, fixture, check, skip, sleep, waitFor }) {
    const requests = []
    const server = http.createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers })
        if (req.url === '/ping') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'X-Smoke': 'yes' })
          res.end('{"pong":true,"nested":{"a":1}}')
          return
        }
        if (req.url === '/echo') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(Buffer.concat(chunks).toString('utf8') || '{}')
          return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('nope')
      })
    })

    const listening = await new Promise((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(fixture.httpPort, '127.0.0.1', () => resolve(true))
    })
    if (!listening) {
      skip('HTTP client', `port ${fixture.httpPort} is already in use`)
      return
    }

    // Replaces what a form field holds, with the real input events React
    // listens for (select-all, then type over the selection).
    const fill = async (selector, text) => {
      await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        el.focus()
        el.select()
        return true
      })()`)
      await cdp.send('Input.insertText', { text })
      await sleep(120)
    }

    // A <select> opens a native popup that CDP's synthetic mouse can't reach,
    // so the method picker is the one control driven through the DOM - via
    // the native value setter, or React's onChange never sees it.
    const setSelect = async (selector, value) => {
      await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return el.value
      })()`)
      await sleep(120)
    }

    // The pane is plain React DOM (not Monaco), so reading it back is safe -
    // see the note about occluded windows in CLAUDE.md.
    const paneText = () =>
      cdp.evaluate(`document.querySelector('[data-testid="http-response-pane"]')?.innerText || ''`)
    const waitForStatus = (text) =>
      waitFor(
        `(document.querySelector('[data-testid="http-response-pane"]')?.innerText || '')
           .includes(${JSON.stringify(text)})`,
        { timeoutMs: 15_000 }
      )

    try {
      await ui.clickRow(`${ws}/requests.http`)
      const opened = await waitFor(
        `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(`${ws}/requests.http`)})`,
        { timeoutMs: 8000 }
      )
      check('a .http file opens', opened)
      check('the toolbar offers a Run action for it', await ui.buttonExists('Run Request'))

      // Nothing selected and the cursor at the top of the file: the first
      // block is the one that runs.
      await ui.clickButton('Run Request')
      check('running a request shows a 200 in the response pane', await waitForStatus('200'))

      const afterGet = await paneText()
      check('the response body is shown', afterGet.includes('"pong"'), afterGet.slice(0, 200))
      check(
        'a JSON body comes back pretty-printed',
        /\n\s+"pong"/.test(afterGet),
        JSON.stringify(afterGet.slice(0, 120))
      )
      check(
        'the request that arrived carried the .http headers',
        requests.at(-1)?.url === '/ping' && requests.at(-1)?.headers.accept === 'application/json',
        JSON.stringify(requests.at(-1)?.headers ?? {})
      )

      await ui.clickButton('Headers (')
      const headersText = await paneText()
      check(
        'the Headers tab lists the response headers',
        headersText.toLowerCase().includes('x-smoke'),
        headersText.slice(0, 200)
      )

      // Copy body: back on the Body tab, the copy button puts the shown text
      // on the clipboard.
      await ui.clickButton('body')
      await ui.clickButton('Copy body')
      let clipboard = null
      try {
        clipboard = await cdp.evaluate('navigator.clipboard.readText()')
      } catch {
        clipboard = null
      }
      if (clipboard === null)
        skip('the body can be copied to the clipboard', 'clipboard read denied')
      else
        check(
          'the body can be copied to the clipboard',
          clipboard.includes('"pong"'),
          clipboard.slice(0, 120)
        )

      // Cmd+Down parks the cursor in the last block, Cmd+Enter is the editor's
      // own Run action (the native menu accelerator can't be driven over CDP).
      // Retried because a Cmd-modified keystroke injected over CDP is
      // occasionally swallowed - the same flake the tree's Cmd+C shows - and
      // one dropped key should not read as a broken feature.
      const runAtEndOfFile = async (matcher, attempts = 3) => {
        for (let i = 0; i < attempts; i++) {
          await ui.focusEditor()
          await ui.key('ArrowDown', 'ArrowDown', 40, 4)
          await ui.key('Enter', 'Enter', 13, 4)
          const hit = await waitFor(
            `(document.querySelector('[data-testid="http-response-pane"]')?.innerText || '')
               .includes(${JSON.stringify(matcher)})`,
            { timeoutMs: 8000 }
          )
          if (hit) return true
        }
        return false
      }

      const echoed = await runAtEndOfFile('hello')
      check('Cmd+Enter runs the block the cursor is in', echoed)
      check(
        'a POST sends its body and content type',
        requests.at(-1)?.method === 'POST' &&
          requests.at(-1)?.headers['content-type'] === 'application/json',
        JSON.stringify(requests.at(-1) ?? {})
      )

      // Closing the pane is per tab, and the response is not restored by
      // switching tabs.
      await cdp.evaluate(`(() => {
        const pane = document.querySelector('[data-testid="http-response-pane"]')
        const close = [...pane.querySelectorAll('button')]
          .find((b) => (b.getAttribute('aria-label') || '') === 'Close')
        close.click()
        return true
      })()`)
      await sleep(300)
      check(
        'the response pane closes',
        !(await cdp.evaluate(`!!document.querySelector('[data-testid="http-response-pane"]')`))
      )

      // A curl command living in an ordinary shell script. Cmd+Down parks the
      // cursor on its *last* continuation line, which is the interesting case:
      // the command is found by walking back up the backslashes. (Selecting it
      // with Cmd+A would be the other supported route, but a select-all racing
      // a just-clicked editor is flaky - the run then sees no selection.)
      const openFile = async (file) => {
        await ui.clickRow(`${ws}/${file}`)
        await waitFor(
          `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(`${ws}/${file}`)})`,
          { timeoutMs: 8000 }
        )
      }

      // .rest is the same format under VS Code REST Client's extension.
      await openFile('requests.rest')
      check('a .rest file gets the same Run action', await ui.buttonExists('Run Request'))
      await ui.clickButton('Run Request')
      check('a request in a .rest file runs', await waitForStatus('200'))

      // A curl in a plain shell script gets the same ▶ Run lens as a request
      // block does - without it, running one is discoverable only by knowing
      // the shortcut.
      await openFile('snippet.sh')
      const lens = await waitFor(
        `[...document.querySelectorAll('.codelens-decoration a')]
           .some((a) => a.textContent.includes('Run'))`,
        { timeoutMs: 10_000 }
      )
      check('a curl in an ordinary file gets a Run lens', lens)

      await openFile('mixed-curl.sh')
      const lensCount = await waitFor(
        `(() => {
          const n = [...document.querySelectorAll('.codelens-decoration a')]
            .filter((a) => a.textContent.includes('Run')).length
          return n > 0 ? n : null
        })()`,
        { timeoutMs: 10_000 }
      )
      check(
        'no Run lens over a command that needs a shell (curl … | jq)',
        lensCount === 1,
        `lenses: ${lensCount}`
      )

      await openFile('snippet.sh')
      check('a curl command in a .sh file runs', await runAtEndOfFile('200'))
      const curlBody = await paneText()
      check('the curl body reaches the server', curlBody.includes('"from"'), curlBody.slice(0, 200))

      // Flags that would write to disk are refused rather than half-honored.
      await openFile('bad-curl.sh')
      const refused = await runAtEndOfFile('not supported')
      check('curl flags that write files are refused with a reason', refused, await paneText())

      // The form route: the HTTP Client extension tab, for a request that
      // isn't worth putting in a file.
      await ui.click('[title="HTTP Client"]')
      const tabOpened = await waitFor(
        `window.api.getOpenTabs().then((s) => s.activeTabPath === 'ext://http-client')`,
        { timeoutMs: 8000 }
      )
      check('the HTTP Client tab opens from the sidebar', tabOpened)
      check(
        'it shows a request form',
        await cdp.evaluate(`!!document.querySelector('[data-testid="http-client-tab"]')`)
      )

      await cdp.evaluate(`(() => {
        const el = document.querySelector('[aria-label="URL"]')
        el.focus()
        return true
      })()`)
      await cdp.send('Input.insertText', { text: `http://127.0.0.1:${fixture.httpPort}/ping` })
      await sleep(150)
      await ui.clickButton('Send')
      const formResponse = await waitFor(
        `(document.querySelector('[data-testid="http-response-view"]')?.innerText || '')
           .includes('"pong"')`,
        { timeoutMs: 15_000 }
      )
      check('a request sent from the form comes back into the same tab', formResponse)
      check(
        'the form request reached the server',
        requests.at(-1)?.url === '/ping',
        JSON.stringify(requests.at(-1) ?? {})
      )

      // Repeated headers: Chromium's setHeader overwrites, so the engine folds
      // them before sending. Driven through window.api because no UI can
      // express "the same header twice" as compactly as the spec can.
      await cdp.evaluate(`window.api.httpSend('smoke-dup', {
        method: 'GET',
        url: 'http://127.0.0.1:${fixture.httpPort}/ping',
        headers: [
          { name: 'Cookie', value: 'a=1' },
          { name: 'Cookie', value: 'b=2' },
          { name: 'X-Multi', value: 'one' },
          { name: 'X-Multi', value: 'two' }
        ],
        followRedirects: true,
        insecure: false,
        timeoutMs: 10000
      })`)
      check(
        'repeated request headers are folded, not dropped',
        requests.at(-1)?.headers.cookie === 'a=1; b=2' &&
          requests.at(-1)?.headers['x-multi'] === 'one, two',
        JSON.stringify(requests.at(-1)?.headers ?? {})
      )

      // The history starts collapsed to a rail - the form is what the tab is
      // for - and the History icon opens it.
      check(
        'the history list starts collapsed',
        await cdp.evaluate(`!document.querySelector('[data-testid="http-history"]')`)
      )
      await ui.clickButton('Show history')
      check(
        'the History icon opens it',
        await cdp.evaluate(`!!document.querySelector('[data-testid="http-history"]')`)
      )
      check(
        'the choice is remembered, not per-mount',
        await cdp.evaluate(
          `window.api.getSettings().then((s) => s.extensions.httpClient.historyCollapsed === false)`
        )
      )

      // History is recorded in main, so it holds everything sent in this
      // session - the requests run from files as well as the form's.
      const historyText = await waitFor(
        `(() => {
          const el = document.querySelector('[data-testid="http-history"]')
          const text = el?.innerText || ''
          return text.includes('/ping') && text.includes('/echo') ? text : null
        })()`,
        { timeoutMs: 8000 }
      )
      check('the history lists requests from both the form and the files', !!historyText)

      const stored = await cdp.evaluate('window.api.httpHistory()')
      check(
        'each entry keeps enough to re-run it',
        Array.isArray(stored) && stored.length > 0 && typeof stored[0].spec?.url === 'string',
        JSON.stringify(stored?.[0] ?? {}).slice(0, 160)
      )

      // Send one request with every field the form has, so what comes back
      // out of the history can be compared against something specific.
      await fill('[aria-label="URL"]', `http://127.0.0.1:${fixture.httpPort}/echo`)
      await setSelect('[aria-label="Method"]', 'POST')
      await ui.clickButton('Add header')
      await fill('[aria-label="Header 1 name"]', 'X-Refill')
      await fill('[aria-label="Header 1 value"]', 'yes')
      await ui.clickButton('Body')
      await fill('[aria-label="Request body"]', '{"refill":true}')
      await ui.clickButton('Send')
      await waitForStatus('200')

      // Dirty every field first: a form that still holds what was just sent
      // would pass the checks below without the click doing anything at all.
      await fill('[aria-label="URL"]', 'http://127.0.0.1:1/stale')
      await setSelect('[aria-label="Method"]', 'DELETE')
      await fill('[aria-label="Request body"]', 'stale')

      // Clicking an entry loads all of it back, or Send would re-run
      // something other than what the entry says. The newest is that request.
      await cdp.evaluate(`(() => {
        document.querySelector('[data-testid="http-history"] button')?.click()
        return true
      })()`)
      await sleep(250)
      const refilled = await cdp.evaluate(`({
        url: document.querySelector('[aria-label="URL"]')?.value || '',
        method: document.querySelector('[aria-label="Method"]')?.value || '',
        body: document.querySelector('[aria-label="Request body"]')?.value ?? null,
        headers: [...document.querySelectorAll('[aria-label$="name"]')].map((i) => i.value)
      })`)
      check(
        'clicking an entry refills the form',
        refilled.url.endsWith('/echo') && refilled.method === 'POST',
        JSON.stringify(refilled)
      )
      check(
        'the body comes back with it, on the tab that shows it',
        refilled.body === '{"refill":true}',
        JSON.stringify(refilled.body)
      )
      await ui.clickButton('Headers')
      const backHeaders = await cdp.evaluate(
        `[...document.querySelectorAll('[aria-label$="name"]')].map((i) => i.value)`
      )
      check('the headers come back with it', backHeaders.includes('X-Refill'), String(backHeaders))

      await ui.clickButton('Clear history')
      const cleared = await waitFor(`window.api.httpHistory().then((h) => h.length === 0)`, {
        timeoutMs: 6000
      })
      check('the history can be cleared', cleared)
    } finally {
      server.close()
    }
  }
}
