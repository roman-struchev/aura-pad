import fs from 'fs'
import os from 'os'
import path from 'path'

// A11 - the renderer's privileged surface stays exactly as designed
// (docs/TEST_CASES.md §14, and the exposure documented in docs/BUGS.md §1),
// plus the path allowlist main applies to every filesystem and pty call (§2).
export default {
  id: 'A11',
  title: 'Preload surface',
  async run({ cdp, check, ws, sleep }) {
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

    // The path allowlist (docs/BUGS.md §2). Everything below is what injected
    // script would try if it got into the renderer: name a path nobody opened
    // and act on it. The canary lives in a temp dir of its own, so a
    // regression here shows up as a real file being read or written.
    const lair = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapad-outside-'))
    const canary = path.join(lair, 'canary.txt')
    fs.writeFileSync(canary, 'untouched\n')
    const q = (value) => JSON.stringify(value)

    const read = await cdp.evaluate(`window.api.readFile(${q(canary)})`)
    check('reading a path outside every workspace is refused', read.success === false, read.error)

    const written = await cdp.evaluate(`window.api.saveFile(${q(canary)}, 'owned')`)
    check('writing to it is refused', written.success === false, written.error)
    check(
      'and the file on disk is untouched',
      fs.readFileSync(canary, 'utf-8') === 'untouched\n',
      fs.readFileSync(canary, 'utf-8')
    )

    const created = await cdp.evaluate(`window.api.createPath(${q(lair)}, 'planted.txt', 'file')`)
    check('creating a file there is refused', created.success === false, created.error)
    check('nothing was planted', !fs.existsSync(path.join(lair, 'planted.txt')))

    const deleted = await cdp.evaluate(`window.api.deletePaths([${q(canary)}])`)
    check('trashing it is refused', deleted.success === false, deleted.error)
    check('the file survived', fs.existsSync(canary))

    const moved = await cdp.evaluate(`window.api.movePath(${q(canary)}, ${q(ws)})`)
    check('moving it into the workspace is refused', moved.success === false, moved.error)

    const spawned = await cdp.evaluate(
      `window.api.createPty(${q(lair)}).then((id) => ({ id })).catch((e) => ({ error: String(e) }))`
    )
    check('a shell cannot be spawned there', !spawned.id, spawned.id || spawned.error)

    // A symlink from inside the workspace is the way around a naive prefix
    // check, so it has to be resolved before the comparison, not after.
    const bait = path.join(ws, 'bait-link.txt')
    fs.symlinkSync(canary, bait)
    await sleep(300)
    const throughLink = await cdp.evaluate(`window.api.readFile(${q(bait)})`)
    check(
      'a symlink out of the workspace does not smuggle it back in',
      throughLink.success === false,
      throughLink.error
    )
    fs.rmSync(bait, { force: true })

    // The other half: what the user actually reaches stays reachable. Quick
    // Open's listing is what opens an outside file up.
    await cdp.evaluate(`window.api.listPathMatches(${q(path.join(lair, 'can'))})`)
    const afterListing = await cdp.evaluate(`window.api.readFile(${q(canary)})`)
    check(
      'a file listed by Quick Open can then be opened',
      afterListing.success === true,
      afterListing.error
    )

    const inWorkspace = await cdp.evaluate(`window.api.readFile(${q(path.join(ws, 'notes.txt'))})`)
    check('workspace files are unaffected', inWorkspace.success === true, inWorkspace.error)

    fs.rmSync(lair, { recursive: true, force: true })
  }
}
