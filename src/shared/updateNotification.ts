export interface UpdateNotification {
  version: string
  // 'install': the update is downloaded and can be applied by restarting
  // (Windows NSIS / Linux AppImage). 'manual': this build can't self-update
  // (unsigned macOS, .deb/snap) - offer a link to the releases page instead.
  mode: 'install' | 'manual'
}
