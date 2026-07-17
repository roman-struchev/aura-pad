export interface UpdateNotification {
  version: string
  // 'install': the update is downloaded and can be applied by restarting
  // (Windows NSIS / Linux AppImage). 'script': unsigned macOS - the install
  // script re-installs and relaunches the app. 'manual': .deb/snap - offer
  // a link to the releases page instead.
  mode: 'install' | 'script' | 'manual'
}
