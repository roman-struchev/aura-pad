// Must stay the first import: pins the app name (and thus the userData dir)
// before any module resolves paths under it at import time.
import './appIdentity'
import { app, shell, BrowserWindow, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { handleInvokeWithEvent, handleSend } from './ipc'
import { registerIpcHandlers } from './ipcHandlers'
import { setupWatchers, closeAllWatchers, broadcast } from './watcher'
import { registerCreatePtyHandler, killAllPtys, killPtysOf } from './terminals'
import { grantPath } from './pathAccess'
import { registerWorkTogetherWindowProvider, disconnectAllSessions } from './workTogether'
import { buildAppMenu } from './menu'
import { initAutoUpdater } from './updater'

// Opening a file via "Open With" (or dropping one on the dock icon on macOS)
// only reaches this process, not the renderer directly - forward it over
// IPC so App.tsx can just call tabs.openTab() with it, the same as opening
// a file from the tree. Queued if the window doesn't exist yet (macOS can
// fire 'open-file' before the app is ready; Windows/Linux pass the path as
// a plain CLI arg on the very first launch, before any window exists).
// The first window opened, and the only one that persists (and restores) the
// tab session: with several windows open, two of them writing openTabs.json
// would each overwrite the other's list. If it closes, nothing persists until
// a fresh primary window is opened - a detached window is a view onto files,
// not the session of record.
let primaryWindowRef: BrowserWindow | null = null
// Per window, keyed by its webContents id: whether it owns the session, and
// the files it was created with. Those are delivered as 'open-file-request'
// events once its renderer announces itself, exactly like a file handed over
// by the OS - opening a file twice is harmless (the tab is just activated),
// whereas an init the renderer reads once is lost if React's double-invoked
// mount effect reads it twice.
const windowInits = new Map<number, { paths: string[]; primary: boolean }>()
const pendingFileOpens: string[] = []
// Windows that the renderer has confirmed are safe to close (no unsaved
// tabs, or the user chose to discard them) - see the 'close' handler below.
const windowsAllowedToClose = new WeakSet<BrowserWindow>()
// Windows whose renderer has stopped responding (busy-looped or OOM-stalled
// JS). The close handler must not wait for a 'confirm-close' from these -
// it would never arrive, leaving the window (and Cmd+Q) permanently stuck.
const unresponsiveWindows = new WeakSet<BrowserWindow>()
// True once App.tsx has mounted and subscribed to 'open-file-request' (see
// the 'renderer-ready' handler below). 'ready-to-show' fires as soon as the
// page has painted a first frame, which isn't guaranteed to be after React
// has mounted and run its effects - sending straight to 'ready-to-show' could
// fire before anything is listening, silently dropping the very file the
// user tried to open. Queuing until the renderer actively asks for pending
// opens removes that race entirely.
// Per window: 'ready-to-show' fires as soon as the page has painted a first
// frame, which isn't guaranteed to be after React has mounted and run its
// effects - sending straight to 'ready-to-show' could fire before anything is
// listening, silently dropping the very file the user tried to open.
const readyWindows = new WeakSet<BrowserWindow>()
// Set while a quit (Cmd+Q / menu Quit / updater) is in progress. The window
// 'close' event a quit triggers gets prevented like any other while the
// renderer checks for unsaved tabs - and preventing it makes Electron abort
// the whole quit sequence. 'confirm-close' must therefore resume the quit
// instead of just closing the window, or Quit on macOS (where
// window-all-closed doesn't quit) silently degrades into "close window".
let quitRequested = false
app.on('before-quit', () => {
  quitRequested = true
})

// Dev only: electron-vite restarts the app by killing this process (and Ctrl+C
// in its terminal signals the whole process group), which Electron turns into
// a normal quit - close events included. The unsaved-changes veto above is
// meant for a user closing a window, not for a parent that is already gone: a
// vetoed signal leaves this process alive with its window on screen, while the
// replacement instance exits immediately on the single-instance lock and takes
// the dev server down with it. The result is an orphaned window that outlives
// the terminal that started it. A terminating signal is not negotiable, so
// tear the ptys down and go.
if (is.dev) {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      killAllPtys()
      disconnectAllSessions()
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
      app.exit(0)
    })
  }
}

// Only protocols that open in a browser or mail client - renderer content
// (e.g. a link in a previewed Markdown file from an untrusted repo) must not
// be able to launch arbitrary protocol handlers (file:, smb:, vscode:, ...).
function openExternalSafe(url: string): void {
  if (/^(https?|mailto):/i.test(url)) {
    shell.openExternal(url).catch(() => {})
  }
}

// Where a file the OS handed us should land: the window the user is looking
// at, falling back to the primary one.
function targetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && readyWindows.has(focused)) return focused
  if (primaryWindowRef && !primaryWindowRef.isDestroyed() && readyWindows.has(primaryWindowRef)) {
    return primaryWindowRef
  }
  return null
}

function flushPendingFileOpens(): void {
  const win = targetWindow()
  if (!win) return
  while (pendingFileOpens.length > 0) {
    win.webContents.send('open-file-request', pendingFileOpens.shift())
  }
}

function openFileInApp(filePath: string): void {
  // The OS (double-click, `open -a`, drag onto the dock icon) asked for this
  // file, so the renderer is allowed to read and save it even though it sits
  // outside every workspace - see pathAccess.
  grantPath(filePath)
  const win = targetWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send('open-file-request', filePath)
  } else {
    pendingFileOpens.push(filePath)
  }
}

// Only a real, existing file counts - guards against dev-mode args
// (electron-vite's own flags/paths) being mistaken for a file to open.
function getFilePathFromArgv(argv: string[]): string | null {
  const candidate = argv[argv.length - 1]
  if (!candidate || candidate.startsWith('-')) return null
  // A bare launch (Dock/Finder, or a second instance started without a file)
  // has the executable itself as the only argument - never treat the app
  // binary as a document the user asked to open.
  if (argv.length < 2 || candidate === process.execPath) return null
  try {
    return fs.statSync(candidate).isFile() ? candidate : null
  } catch (e) {
    return null
  }
}

// macOS-only: must be registered before whenReady, since launching the app
// fresh by double-clicking/opening-with a file fires this before it's ready.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  openFileInApp(filePath)
})

// Opening a file while AuraPad is already running (Windows/Linux file
// associations, or a second macOS open-file) should reuse this window
// rather than spawn another instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = getFilePathFromArgv(argv)
    if (filePath) openFileInApp(filePath)
  })
}

// `init.paths` are the files a new window opens with (a tab torn off another
// window, or a file the OS handed a fresh launch); `init.primary` marks the
// one window that owns the persisted session - see primaryWindowRef.
function createWindow(init: { paths: string[]; primary?: boolean } = { paths: [] }): void {
  const isPrimary = init.primary ?? (!primaryWindowRef || primaryWindowRef.isDestroyed())
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // Read now, not in the 'closed' handler: by then the window is destroyed and
  // touching webContents throws - an uncaught exception in main, which on a
  // quit leaves the process alive with its single-instance lock held.
  const windowId = mainWindow.webContents.id
  windowInits.set(windowId, { paths: init.paths, primary: isPrimary })
  if (isPrimary) primaryWindowRef = mainWindow
  mainWindow.on('closed', () => {
    windowInits.delete(windowId)
    if (primaryWindowRef === mainWindow) primaryWindowRef = null
  })

  // Ask the renderer whether it's safe to close (unsaved tabs) instead of
  // discarding work silently - it responds via 'confirm-close' below, either
  // immediately (nothing unsaved) or after the user confirms a prompt. A
  // crashed or hung renderer can't respond at all, so it gets no veto: there
  // is nothing left to save, and preventing the close would leave the window
  // (and the whole quit sequence) permanently stuck behind a dead page.
  mainWindow.on('close', (event) => {
    if (windowsAllowedToClose.has(mainWindow)) return
    if (mainWindow.webContents.isCrashed() || unresponsiveWindows.has(mainWindow)) return
    // A renderer that hasn't announced itself yet has no 'request-close'
    // subscription, so the message below would go nowhere and the veto would
    // never be lifted - the window becomes unclosable. That window of time is
    // real: the page is still loading right after launch, and again after
    // every reload (see 'did-start-navigation' below). It also has nothing
    // to protect, since a page that never mounted holds no unsaved buffers.
    if (!readyWindows.has(mainWindow)) return
    event.preventDefault()
    mainWindow.webContents.send('request-close')
  })

  mainWindow.on('unresponsive', () => unresponsiveWindows.add(mainWindow))
  mainWindow.on('responsive', () => unresponsiveWindows.delete(mainWindow))

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // A renderer reload (View > Reload / Cmd+R) wipes the page's terminal state
  // and pty-data listeners, but the shells in the ptys map would keep running
  // headless forever - kill them whenever the main frame navigates, same as
  // when the last window closes. The initial load also fires this, when the
  // map is still empty.
  //
  mainWindow.webContents.on('did-navigate', () => {
    // Only this window's shells: another window's terminals are still very
    // much alive and attached to a renderer that never navigated.
    killPtysOf(mainWindow.webContents)
  })

  // A navigation also wipes the page's subscriptions - and it does so the
  // moment it starts, not when the new document commits, so the flag has to
  // drop here rather than on 'did-navigate'. In between, main would still
  // believe a listener exists: a file opened via Finder mid-reload would be
  // sent into the void instead of queued, and a close would be vetoed while
  // waiting for a 'confirm-close' no one is left to send.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) readyWindows.delete(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url)
    return { action: 'deny' }
  })

  // A plain in-page navigation (e.g. clicking a link in the Markdown preview,
  // which isn't a new-window open and so never reaches setWindowOpenHandler
  // above) would otherwise replace the whole app with the target site. Electron
  // never fires this for the app's own initial loadURL/loadFile call below -
  // only for content-triggered navigations - so any occurrence here is a link
  // that should open in the OS browser instead, with the app's own window
  // left in place.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Dev-mode full reloads (vite's location.reload() when HMR can't patch)
    // navigate back to the dev server's own URL - those must go through,
    // everything else opens externally.
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    openExternalSafe(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

handleSend('confirm-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  windowsAllowedToClose.add(win)
  if (quitRequested) {
    // Re-enter the quit that the prevented 'close' aborted - this time the
    // window is allowed to close, so the quit runs to completion (and
    // autoInstallOnAppQuit updates actually get applied).
    app.quit()
  } else {
    win.close()
  }
})

// The renderer's unsaved-changes prompt was declined - the user kept working.
// A quit that was pending must be forgotten, or the next plain window close
// would wrongly quit the whole app.
handleSend('decline-close', () => {
  quitRequested = false
})

// App.tsx sends this right after mounting and subscribing to
// 'open-file-request' - only from this point on is it safe to deliver a file
// open directly instead of queuing it.
handleInvokeWithEvent('get-window-init', (event) => ({
  primary: windowInits.get(event.sender.id)?.primary ?? false
}))

// Tearing a tab off.
handleSend('open-in-new-window', (_event, paths) => {
  createWindow({ paths: paths.filter((p) => typeof p === 'string') })
})

// And pushing one back: the main window opens the file the way it opens any
// other, and the window it came from goes away once it has nothing left.
handleSend('move-tab-to-primary', (event, filePath, closeSender) => {
  const target = primaryWindowRef
  if (target && !target.isDestroyed()) {
    if (target.isMinimized()) target.restore()
    target.focus()
    target.webContents.send('open-file-request', filePath)
  }
  if (!closeSender) return
  const sender = BrowserWindow.fromWebContents(event.sender)
  if (sender && sender !== primaryWindowRef) sender.close()
})

handleSend('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && win !== primaryWindowRef) win.close()
})

handleSend('renderer-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) readyWindows.add(win)
  // The files this window was torn off with, now that something is listening.
  // Cleared as they go out: a later reload of this window restores whatever
  // the user has since opened in it, not the original file again.
  const init = windowInits.get(event.sender.id)
  if (init && init.paths.length > 0) {
    for (const filePath of init.paths) event.sender.send('open-file-request', filePath)
    windowInits.set(event.sender.id, { paths: [], primary: init.primary })
  }
  flushPendingFileOpens()
})

registerIpcHandlers()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.struchev.aurapad')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  Menu.setApplicationMenu(
    buildAppMenu((action) => {
      const win = BrowserWindow.getFocusedWindow() ?? primaryWindowRef
      win?.webContents.send('menu-action', action)
    })
  )

  // Registered once for the app's lifetime - always resolves to whatever
  // window is current, so it keeps working across a macOS close-then-reopen
  // (dock activate) cycle instead of staying bound to a destroyed window.
  registerCreatePtyHandler()
  registerWorkTogetherWindowProvider(() => primaryWindowRef)

  createWindow({ paths: [], primary: true })
  setupWatchers()
  initAutoUpdater()

  const initialFilePath = getFilePathFromArgv(process.argv)
  if (initialFilePath) openFileInApp(initialFilePath)

  nativeTheme.on('updated', () => {
    broadcast('theme-updated', nativeTheme.shouldUseDarkColors)
  })

  app.on('activate', function () {
    // On macOS, closing the last window doesn't quit the app - it tears down
    // watchers below (window-all-closed) since nothing was around to receive
    // their events. Reopening one (dock click) needs them re-armed, or the
    // file tree/git status/external-change detection in the new window would
    // just silently never update again.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      setupWatchers()
    }
  })
})

app.on('window-all-closed', () => {
  killAllPtys()
  disconnectAllSessions()
  closeAllWatchers()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
