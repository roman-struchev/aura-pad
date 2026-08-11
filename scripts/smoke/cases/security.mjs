// A11 - the renderer's privileged surface stays exactly as designed
// (docs/TEST_CASES.md §14, and the exposure documented in docs/BUGS.md §1).
export default {
  id: 'A11',
  title: 'Preload surface',
  async run({ cdp, check }) {
    const surface = await cdp.evaluate(`({
      electron: typeof window.electron,
      require: typeof window.require,
      process: typeof window.process,
      api: typeof window.api,
      platform: window.api?.platform,
      methods: Object.keys(window.api || {}).length
    })`)

    check(
      'the generic electronAPI bridge is not exposed',
      surface.electron === 'undefined',
      surface.electron
    )
    check('node require is not reachable from the page', surface.require === 'undefined')
    check(
      'the typed api is exposed',
      surface.api === 'object' && surface.methods > 0,
      String(surface.methods)
    )
    check(
      'platform is available for the OS-specific labels',
      ['darwin', 'win32', 'linux'].includes(surface.platform),
      String(surface.platform)
    )
  }
}
