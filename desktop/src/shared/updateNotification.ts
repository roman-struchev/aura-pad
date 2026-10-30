export interface UpdateNotification {
  version: string
  // 'install': the update is downloaded and can be applied by restarting
  // (Windows NSIS / Linux AppImage). 'script': unsigned macOS - the install
  // script re-installs and relaunches the app. 'manual': .deb/snap - offer
  // a link to the releases page instead.
  mode: 'install' | 'script' | 'manual'
  // A previous install attempt failed before it got as far as replacing the
  // app (e.g. offline) - the toast shows an error and offers a retry.
  failed?: boolean
}

// Progress of a 'script' (macOS) install, streamed from the install script
// while it runs so the toast can show more than a spinner.
export interface UpdateProgress {
  // 'download': fetching the .dmg, `percent` follows curl's progress meter.
  // 'install': mounting the image and copying the bundle - a few seconds with
  // no percentage to report.
  phase: 'download' | 'install'
  percent?: number
}
