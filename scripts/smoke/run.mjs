#!/usr/bin/env node
// Automated smoke suite: launches AuraPad against a throwaway profile and
// drives it over CDP, so the baseline cases in docs/TEST_CASES.md can be run
// in about a minute instead of by hand.
//
//   npm run smoke            all cases
//   npm run smoke -- A3 A7   only these ids (prefix match)
//   npm run smoke -- --keep  leave the app running and the fixture on disk
//
// Deliberately one app launch for the whole suite: startup dominates the
// runtime, so cases are written to leave the app in a usable state rather
// than to get a fresh one.

import { execFileSync, spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { connect, connectMain, waitFor, sleep } from './cdp.mjs'
import { makeUi } from './ui.mjs'
import { createFixture } from './fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
// Not 9222/9223: those are what a human debugging session grabs, and a clash
// would attach the suite to the wrong app.
const PORT = Number(process.env.SMOKE_CDP_PORT || 9333)
const MAIN_PORT = PORT + 1

const argv = process.argv.slice(2)
const keepAlive = argv.includes('--keep')
const filters = argv.filter((a) => !a.startsWith('--'))

const CASE_FILES = [
  'workspace.mjs',
  'editing.mjs',
  'tabs.mjs',
  'tree-ops.mjs',
  'encoding.mjs',
  'search.mjs',
  'preview.mjs',
  'markdown-images.mjs',
  'local-history.mjs',
  'spellcheck.mjs',
  'terminal.mjs',
  'settings.mjs',
  'git.mjs',
  'http.mjs',
  'security.mjs',
  'update-toast.mjs',
  'windows.mjs',
  // Last: it closes and reopens the window, so anything after it would be
  // talking to a renderer target that no longer exists.
  'lifecycle.mjs'
]

const results = []
let currentCase = null
// Held at module scope so the crash handler below can take the app and the
// fixture down with it: a run that dies half way used to leave an Electron
// holding the CDP port, and the *next* run then failed for a reason that had
// nothing to do with the code being tested.
let running = null

function check(name, ok, detail = '') {
  results.push({ case: currentCase, name, ok: !!ok, detail })
  const mark = ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL \x1b[0m'
  console.log(`  ${mark} ${name}${detail && !ok ? `\n         ${detail}` : ''}`)
}

function skip(name, why) {
  results.push({ case: currentCase, name, skipped: true, detail: why })
  console.log(`  \x1b[90m skip\x1b[0m ${name} (${why})`)
}

function launch(fixture) {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--', `--remote-debugging-port=${PORT}`, `--inspect=${MAIN_PORT}`],
    {
      cwd: repoRoot,
      env: { ...process.env, AURAPAD_USER_DATA_DIR: fixture.profile },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  const log = []
  child.stdout.on('data', (d) => log.push(String(d)))
  child.stderr.on('data', (d) => log.push(String(d)))
  return { child, log }
}

// Chromium throttles rendering (and, with it, Monaco's edit events) in a
// window it considers occluded, which is exactly what a test window behind a
// terminal is. Raising it without stealing focus is the difference between a
// suite that measures the app and one that measures window stacking.
async function raiseWindow() {
  const main = await connectMain(MAIN_PORT, { timeoutMs: 15_000 })
  if (!main) return false
  const raised = await main.evaluate(`(() => {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return false
    win.showInactive()
    win.moveTop()
    return true
  })()`)
  main.close()
  return !!raised
}

async function quitApp() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    const { webSocketDebuggerUrl } = await res.json()
    const ws = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
        setTimeout(resolve, 800)
      }
      ws.onerror = resolve
      setTimeout(resolve, 3000)
    })
  } catch {
    // Already gone.
  }
}

// A previous `--keep` run (or a debugging session) still holding the port
// would otherwise be silently adopted as "the app under test", and every
// check would then run against a stale build and a deleted fixture.
async function assertPortFree() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
  } catch {
    return
  }
  // Naming the process saves the next person the lsof: nine times out of ten
  // it is a --keep run (or an aborted one) still holding the port.
  let holder = ''
  try {
    const pids = execFileSync('lsof', ['-ti', `tcp:${PORT}`], { encoding: 'utf-8' }).trim()
    if (pids) holder = `\nIt is pid ${pids.split('\n').join(', ')} - \`kill ${pids.split('\n').join(' ')}\`.`
  } catch {
    // No lsof, or nothing to report - the message below still stands.
  }
  console.error(
    `Something is already listening on CDP port ${PORT} - most likely a smoke run\n` +
      `started with --keep. Quit it (or set SMOKE_CDP_PORT) and try again.${holder}`
  )
  process.exit(1)
}

// A case file nobody listed here never runs, and nothing else would say so -
// the suite would just quietly cover less than it looks like it does.
function assertEveryCaseRegistered() {
  const onDisk = fs
    .readdirSync(path.join(here, 'cases'))
    .filter((f) => f.endsWith('.mjs'))
    .sort()
  const missing = onDisk.filter((f) => !CASE_FILES.includes(f))
  if (missing.length === 0) return
  console.error(
    `These case files are not listed in CASE_FILES, so they never run:\n  ${missing.join('\n  ')}`
  )
  process.exit(1)
}

async function main() {
  const started = Date.now()
  assertEveryCaseRegistered()
  await assertPortFree()
  const fixture = createFixture()
  console.log(`workspace: ${fixture.ws}\n`)

  let app = launch(fixture)
  running = { app, fixture }
  let cdp
  try {
    cdp = await connect(PORT)
  } catch (e) {
    console.error(`\nApp never came up: ${e.message}\n${app.log.join('')}`)
    app.child.kill('SIGKILL')
    fixture.cleanup()
    process.exit(1)
  }

  await raiseWindow()

  // The tree rendering is the app's own "I'm ready" signal: it means main
  // answered get-workspaces and React has mounted.
  const ready = await waitFor(cdp, `!!document.querySelector('[data-tree-row]')`, {
    timeoutMs: 30_000
  })
  if (!ready) {
    console.error(`\nThe file tree never rendered.\n${app.log.join('')}`)
    await quitApp()
    fixture.cleanup()
    process.exit(1)
  }

  // Cold start: the dev server may still be pre-bundling Monaco, and the first
  // editor mount can take tens of seconds. Absorbing that here - once, outside
  // any case - keeps the per-check timeouts tight enough to catch real
  // regressions instead of being padded for the worst case.
  const warmStart = Date.now()
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-tree-row]')]
      .find((r) => /\\.(txt|md|json)$/.test(r.dataset.path || ''))
    row?.click()
    return true
  })()`)
  const warm = await waitFor(cdp, `!!document.querySelector('.monaco-editor')`, {
    timeoutMs: 90_000
  })
  const warmSeconds = ((Date.now() - warmStart) / 1000).toFixed(1)
  if (!warm) {
    console.error(`\nThe editor never mounted (${warmSeconds}s).\n${app.log.join('')}`)
    await quitApp()
    fixture.cleanup()
    process.exit(1)
  }
  if (Number(warmSeconds) > 5) console.log(`\x1b[90m(editor warm-up took ${warmSeconds}s)\x1b[0m\n`)

  const ctx = {
    cdp,
    ui: makeUi(cdp),
    fixture,
    ws: fixture.ws,
    check,
    skip,
    sleep,
    waitFor: (expression, options) => waitFor(cdp, expression, options),
    read: (...parts) => fs.readFileSync(fixture.file(...parts), 'utf-8'),
    readBytes: (...parts) => fs.readFileSync(fixture.file(...parts)),
    // For cases that reach past the renderer into Electron itself - the
    // caller owns the connection and closes it.
    connectMain: () => connectMain(MAIN_PORT),
    // Same process, new window (closed and reopened): the old page target is
    // gone, so the suite's CDP connection has to be re-pointed at the new one.
    reconnectRenderer: async () => {
      cdp.close()
      cdp = await connect(PORT)
      await raiseWindow()
      ctx.cdp = cdp
      ctx.ui = makeUi(cdp)
      return cdp
    },
    // Cases that need a fresh process (session restore, settings applied at
    // startup) ask for this rather than assuming one.
    restart: async () => {
      cdp.close()
      await quitApp()
      await sleep(1500)
      app.child.kill('SIGKILL')
      app = launch(fixture)
      running = { app, fixture }
      cdp = await connect(PORT)
      await raiseWindow()
      ctx.cdp = cdp
      ctx.ui = makeUi(cdp)
      await waitFor(cdp, `!!document.querySelector('[data-tree-row]')`, { timeoutMs: 30_000 })
      // A relaunch restores the previous session, so the editor comes back on
      // its own - wait for it rather than letting the next case race it.
      await waitFor(cdp, `!!document.querySelector('.monaco-editor')`, { timeoutMs: 60_000 })
      return cdp
    }
  }

  // Loaded up front rather than inside the loop: the full id list is what
  // makes `-- A1` mean A1 and not also A10..A18 (an id that matches a filter
  // exactly wins; a filter that names no case falls back to prefix matching,
  // so `-- A` still runs everything).
  const cases = []
  for (const file of CASE_FILES) cases.push((await import(path.join(here, 'cases', file))).default)
  const ids = cases.map((c) => c.id)
  const selected = (id) =>
    filters.length === 0 ||
    filters.some((f) => (ids.includes(f) ? id === f : id.startsWith(f)))

  for (const mod of cases) {
    if (!selected(mod.id)) continue
    currentCase = mod.id
    console.log(`\x1b[1m${mod.id} ${mod.title}\x1b[0m`)
    const caseStart = Date.now()
    try {
      await mod.run(ctx)
    } catch (e) {
      check('case ran to completion', false, e.message)
    }
    console.log(`\x1b[90m  (${((Date.now() - caseStart) / 1000).toFixed(1)}s)\x1b[0m\n`)
  }

  const failed = results.filter((r) => !r.ok && !r.skipped)
  const skipped = results.filter((r) => r.skipped)
  const passed = results.filter((r) => r.ok)
  console.log(
    `${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped ` +
      `in ${((Date.now() - started) / 1000).toFixed(0)}s`
  )
  if (failed.length > 0) {
    console.log('\nFailures:')
    for (const f of failed) console.log(`  ${f.case}  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
  }

  if (keepAlive) {
    console.log(`\nLeft running on port ${PORT}; fixture at ${fixture.root}`)
  } else {
    ctx.cdp.close()
    await quitApp()
    app.child.kill('SIGKILL')
    fixture.cleanup()
  }
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  if (running) {
    running.app.child.kill('SIGKILL')
    running.fixture.cleanup()
  }
  process.exit(1)
})
