import fs from 'fs'
import os from 'os'
import path from 'path'

const J = JSON.stringify

// A17 - local history: every write the app makes on the user's behalf stores
// the state it replaced, and the tab can be put back to any of them.
export default {
  id: 'A17',
  title: 'Local history',
  async run({ cdp, ui, ws, check, waitFor, sleep }) {
    const doc = path.join(ws, 'history.txt')
    fs.writeFileSync(doc, 'version one\n')
    // Before the saves below: they record self-writes, and the watcher
    // suppresses the tree rebuild for those - so a file first seen *after*
    // them would never reach the tree.
    check('the new file reaches the tree', await ui.waitForRow(doc))

    const list = () => cdp.evaluate(`window.api.localHistoryList(${J(doc)})`)
    const read = (id) => cdp.evaluate(`window.api.localHistoryRead(${J(doc)}, ${J(id)})`)
    // The same call autosave makes.
    const save = (text) => cdp.evaluate(`window.api.saveFile(${J(doc)}, ${J(text)})`)

    check('a file with no history yet has no versions', (await list()).length === 0)

    await save('version two\n')
    let entries = await list()
    check(
      'saving stores the state it replaced',
      entries.length === 1 && entries[0].label === 'Save',
      JSON.stringify(entries)
    )
    check(
      'and that version reads back byte-for-byte',
      (await read(entries[0].id)).content === 'version one\n'
    )

    // Autosave fires seconds apart; a snapshot per keystroke-pause would bury
    // the one from before the editing session started.
    await save('version three\n')
    const coalesced = await list()
    check(
      'a second save moments later does not stack another version',
      coalesced.length === 1 && coalesced[0].id === entries[0].id,
      JSON.stringify(coalesced)
    )

    // A bulk rewrite is worth a version regardless of how recent the last one
    // is - it is the change nobody notices until tomorrow.
    const replaced = await cdp.evaluate(
      `window.api.replaceInFiles(${J({
        paths: [doc],
        query: 'three',
        replacement: 'four',
        options: {}
      })})`
    )
    check('the replace ran', replaced.success && replaced.filesChanged === 1, replaced.error)
    entries = await list()
    check(
      'replace across files always stores a version',
      entries.length === 2 && entries[0].label === 'Replace in files',
      JSON.stringify(entries)
    )
    check(
      'holding what the replace overwrote',
      (await read(entries[0].id)).content === 'version three\n'
    )

    // The id names a file inside the app's own history folder, so it is
    // checked against that file's own list rather than joined onto a path.
    const bogus = await read('../../../etc/passwd')
    check('an id the history does not know is refused', bogus.success === false, bogus.error)

    // History is behind the same allowlist as every other path (BUGS §2).
    const lair = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapad-history-'))
    const offLimits = path.join(lair, 'elsewhere.txt')
    fs.writeFileSync(offLimits, 'not yours\n')
    check(
      'a file outside the allowed folders has no history to read',
      (await cdp.evaluate(`window.api.localHistoryList(${J(offLimits)})`)).length === 0
    )
    const refused = await cdp.evaluate(
      `window.api.localHistoryRead(${J(offLimits)}, ${J(entries[0].id)})`
    )
    check('and reading one is refused', refused.success === false, refused.error)
    fs.rmSync(lair, { recursive: true, force: true })

    // ---- through the UI ----
    check('the file opens', await ui.openFile(doc))
    const tab = await ui.rectOf(`[data-tab-path="${doc}"]`)
    await ui.clickAt(tab.x + 20, tab.cy, { button: 'right' })
    await ui.clickButton('Local History')
    const opened = await waitFor(`document.querySelectorAll('[data-history-entry]').length === 2`, {
      timeoutMs: 6000
    })
    check('the tab menu opens the history for that file', opened, await ui.bodyText())

    // The oldest version - the one from before any of this - restored into
    // the tab, which autosave then carries to disk.
    const picked = await cdp.evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-history-entry]')]
      const oldest = items[items.length - 1]
      if (!oldest) return false
      oldest.click()
      return true
    })()`)
    check('a version can be picked from the list', picked === true)
    await sleep(400)
    await ui.clickButton('Restore This Version')

    const restored = await (async () => {
      for (let i = 0; i < 40; i++) {
        if (fs.readFileSync(doc, 'utf-8') === 'version one\n') return true
        await sleep(200)
      }
      return fs.readFileSync(doc, 'utf-8')
    })()
    check('restoring puts the file back to that version', restored === true, String(restored))

    await ui.closeTab('history.txt')
    fs.rmSync(doc, { force: true })
    await sleep(400)
  }
}
