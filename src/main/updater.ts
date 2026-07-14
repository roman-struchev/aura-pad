import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { broadcast } from './watcher'
import type { UpdateNotification } from '../shared/updateNotification'

const RELEASES_URL = 'https://github.com/roman-struchev/editor/releases/latest'

// Squirrel.Mac refuses to install updates into an unsigned app (it validates
// the downloaded bundle's code signature), and these builds aren't signed -
// so on macOS the updater only *checks* for a new version and the renderer
// offers a manual download. Same for Linux installs that aren't AppImage
// (.deb/snap), which electron-updater can't replace in place either.
const canAutoInstall =
  process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

let updateDownloaded = false

function notify(update: UpdateNotification): void {
  broadcast('update-notification', update)
}

export function initAutoUpdater(): void {
  // Dev builds have no app-update.yml (and nothing meaningful to update).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = canAutoInstall
  // Even if the user dismisses the restart prompt, apply the downloaded
  // update on whatever quit comes next.
  autoUpdater.autoInstallOnAppQuit = canAutoInstall

  autoUpdater.on('update-available', (info) => {
    if (!canAutoInstall) notify({ version: info.version, mode: 'manual' })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    notify({ version: info.version, mode: 'install' })
  })

  // Best-effort: offline, GitHub down, etc. - just skip this session's check.
  autoUpdater.on('error', (e) => {
    console.warn('Auto-update check failed:', e.message)
  })

  autoUpdater.checkForUpdates().catch((e) => {
    console.warn('Auto-update check failed:', e?.message ?? e)
  })
}

// The renderer's "Restart" / "Download" button lands here. If quitting gets
// blocked by the unsaved-changes close guard, autoInstallOnAppQuit still
// applies the update once the user does let the app close.
export function applyUpdate(): void {
  if (updateDownloaded) autoUpdater.quitAndInstall()
  else shell.openExternal(RELEASES_URL)
}
