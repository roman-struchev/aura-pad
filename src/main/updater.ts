import { app, shell } from 'electron'
import { spawn } from 'child_process'
import { autoUpdater } from 'electron-updater'
import { broadcast } from './watcher'
import type { UpdateNotification } from '../shared/updateNotification'

const RELEASES_URL = 'https://github.com/roman-struchev/aura-pad/releases/latest'
const INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/roman-struchev/aura-pad/main/scripts/install.sh'

// Checked on launch and then every few hours, so long-running sessions still
// hear about new releases.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// Squirrel.Mac refuses to install updates into an unsigned app (it validates
// the downloaded bundle's code signature), and these builds aren't signed -
// so on macOS the updater only *checks* for a new version and the update is
// applied by the install script instead (see applyUpdate). Same for Linux
// installs that aren't AppImage (.deb/snap), which electron-updater can't
// replace in place either - those get a manual releases-page link.
const canAutoInstall =
  process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

let updateDownloaded = false
// Each version is announced once; a dismissed banner doesn't come back on
// every periodic re-check, only when the next version appears.
let lastNotifiedVersion: string | null = null

function notify(update: UpdateNotification): void {
  if (update.version === lastNotifiedVersion) return
  lastNotifiedVersion = update.version
  broadcast('update-notification', update)
}

function checkForUpdates(): void {
  // Best-effort: offline, GitHub down, etc. - just skip this check.
  autoUpdater.checkForUpdates().catch((e) => {
    console.warn('Auto-update check failed:', e?.message ?? e)
  })
}

export function initAutoUpdater(): void {
  // Dev builds have no app-update.yml (and nothing meaningful to update).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = canAutoInstall
  // Even if the user dismisses the restart prompt, apply the downloaded
  // update on whatever quit comes next.
  autoUpdater.autoInstallOnAppQuit = canAutoInstall

  autoUpdater.on('update-available', (info) => {
    // The auto-install path stays quiet here and notifies once the download
    // is ready (update-downloaded below).
    if (canAutoInstall) return
    notify({
      version: info.version,
      mode: process.platform === 'darwin' ? 'script' : 'manual'
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    notify({ version: info.version, mode: 'install' })
  })

  autoUpdater.on('error', (e) => {
    console.warn('Auto-update check failed:', e.message)
  })

  checkForUpdates()
  setInterval(checkForUpdates, CHECK_INTERVAL_MS)
}

// The renderer's "Restart" / "Install" / "Download" button lands here. If
// quitting gets blocked by the unsaved-changes close guard,
// autoInstallOnAppQuit still applies the update once the user does let the
// app close.
export function applyUpdate(): void {
  if (updateDownloaded) {
    autoUpdater.quitAndInstall()
    return
  }
  if (process.platform === 'darwin') {
    // Hand the reinstall to the install script: it quits this app, swaps
    // /Applications/AuraPad.app for the new version, and relaunches it.
    // Detached + unref'd so it keeps running after this process exits.
    const child = spawn('/bin/bash', ['-c', `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`], {
      detached: true,
      stdio: 'ignore'
    })
    // On success the script kills this process before these can fire, so
    // they only ever report an early failure (offline, GitHub down) - the
    // renderer's "Installing…" spinner would otherwise spin forever over
    // nothing happening.
    child.once('error', notifyApplyFailed)
    child.once('exit', (code) => {
      if (code !== 0) notifyApplyFailed()
    })
    child.unref()
    return
  }
  shell.openExternal(RELEASES_URL)
}

// Bypasses notify()'s once-per-version dedupe on purpose: a retry that fails
// again must re-announce, or the toast stays stuck on its spinner.
function notifyApplyFailed(): void {
  const update: UpdateNotification = {
    version: lastNotifiedVersion ?? '',
    mode: 'script',
    failed: true
  }
  broadcast('update-notification', update)
}
