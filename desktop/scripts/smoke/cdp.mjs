// Chrome DevTools Protocol client for the smoke suite. Node's built-in
// WebSocket (Node 22+), no dependencies.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url) {
  const res = await fetch(url)
  return res.json()
}

// The renderer's page target. Polled rather than read once: electron-vite's
// dev server and the window itself come up a couple of seconds after the
// process starts.
async function waitForPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no page target'
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
      if (page) return page.webSocketDebuggerUrl
    } catch (e) {
      lastError = e.message
    }
    await sleep(300)
  }
  throw new Error(`CDP page target never appeared on port ${port} (${lastError})`)
}

export async function connect(port, { timeoutMs = 45_000 } = {}) {
  const url = await waitForPageTarget(port, timeoutMs)
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP websocket failed to open'))
  })

  let nextId = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const resolve = msg.id && pending.get(msg.id)
    if (resolve) {
      pending.delete(msg.id)
      resolve(msg)
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, resolve)
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP ${method} timed out`))
      }, 30_000)
      const done = (msg) => {
        clearTimeout(timer)
        resolve(msg)
      }
      pending.set(id, done)
      ws.send(JSON.stringify({ id, method, params }))
    })

  // Every expression is awaited and returned by value, so a check can just
  // `await evaluate('window.api.getSettings()')` and get the settled result.
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    })
    const details = res.result?.exceptionDetails
    if (details) {
      throw new Error(details.exception?.description || details.text || 'evaluate failed')
    }
    return res.result?.result?.value
  }

  return { send, evaluate, close: () => ws.close() }
}

// The main process's Node inspector (--inspect), which is the only way to
// reach Electron APIs the renderer can't - the suite uses it to raise the
// window, without which Chromium treats it as occluded and throttles Monaco
// into never rendering or reporting edits.
export async function connectMain(port, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const target = targets.find((t) => t.webSocketDebuggerUrl)
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          ws.onopen = resolve
          ws.onerror = () => reject(new Error('main inspector websocket failed'))
        })
        let nextId = 0
        const pending = new Map()
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data)
          const resolve = msg.id && pending.get(msg.id)
          if (resolve) {
            pending.delete(msg.id)
            resolve(msg)
          }
        }
        const evaluate = (expression) =>
          new Promise((resolve) => {
            const id = ++nextId
            pending.set(id, (msg) => resolve(msg.result?.result?.value))
            ws.send(
              JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: {
                  expression,
                  returnByValue: true,
                  awaitPromise: true,
                  includeCommandLineAPI: true
                }
              })
            )
            setTimeout(() => pending.delete(id) && resolve(undefined), 5000)
          })
        return { evaluate, close: () => ws.close() }
      }
    } catch {
      // Not listening yet.
    }
    await sleep(300)
  }
  return null
}

// Polls an expression until it returns something truthy - for "the app has
// finished doing X" waits, which are far cheaper and far less flaky than
// sleeping for a fixed worst case.
export async function waitFor(cdp, expression, { timeoutMs = 10_000, every = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await cdp.evaluate(expression)
    if (last) return last
    await sleep(every)
  }
  return last ?? false
}

export { sleep }
