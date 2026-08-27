import fs from 'fs'
import os from 'os'
import path from 'path'

const QUICK_OPEN = 'input[placeholder^="Search files"]'
const IN_FILES = 'input[placeholder^="Search in all projects"]'
const SEARCH_BUTTON = 'button[aria-label="Global Search (Cmd+Shift+F)"]'

// A6 - finding things: full-text search across workspaces, and quick open.
export default {
  id: 'A6',
  title: 'Search and quick open',
  async run({ cdp, ui, ws, check, waitFor, sleep }) {
    const hits = await cdp.evaluate(`window.api.searchProjects('findmeplease')`)
    check(
      'full-text search finds a match',
      hits.some((h) => h.path === `${ws}/haystack.txt`),
      JSON.stringify(hits.slice(0, 2))
    )

    const ignoredHits = await cdp.evaluate(`window.api.searchProjects('needle-in')`)
    check(
      'search skips node_modules and .gitignore entries',
      ignoredHits.length === 0,
      JSON.stringify(ignoredHits.map((h) => h.path))
    )

    // Quick open is a renderer-level shortcut (double Shift), so unlike the
    // native-menu accelerators it can be driven from here.
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    const dialogOpen = await waitFor(`!!document.querySelector('${QUICK_OPEN}')`, {
      timeoutMs: 4000
    })
    check('double-Shift opens quick open', dialogOpen)
    if (!dialogOpen) return

    await cdp.send('Input.insertText', { text: 'haystack' })
    await sleep(400)
    check(
      'typing filters the results',
      await cdp.evaluate(`document.body.innerText.includes('haystack.txt')`)
    )

    // Only one search dialog at a time: realising mid-quick-open that the
    // file is easier found by its contents switches this dialog over rather
    // than opening a second one behind it - and the query comes along.
    // (The toolbar button, not Cmd+Shift+F: menu accelerators can't be
    // driven over CDP, and it sits in the drag region, hence .click().)
    await cdp.evaluate(`document.querySelector('${SEARCH_BUTTON}').click()`)
    const switched = await waitFor(
      `!document.querySelector('${QUICK_OPEN}') && !!document.querySelector('${IN_FILES}')`,
      { timeoutMs: 4000 }
    )
    check('switching to search-in-files replaces quick open instead of stacking', switched)
    check(
      'the typed query carries over',
      (await cdp.evaluate(`document.querySelector('${IN_FILES}')?.value`)) === 'haystack'
    )

    await ui.key('Shift', 'ShiftLeft', 16, 8)
    await ui.key('Shift', 'ShiftLeft', 16, 8)
    const switchedBack = await waitFor(
      `!!document.querySelector('${QUICK_OPEN}') && !document.querySelector('${IN_FILES}')`,
      { timeoutMs: 4000 }
    )
    check('double-Shift switches back, again leaving one dialog', switchedBack)
    check(
      'and the query comes back with it',
      (await cdp.evaluate(`document.querySelector('${QUICK_OPEN}')?.value`)) === 'haystack'
    )

    await ui.key('Escape', 'Escape', 27)
    check(
      'Escape closes it',
      await waitFor(`!document.querySelector('${QUICK_OPEN}')`, { timeoutMs: 4000 })
    )

    // ---- search options and replace-in-files ----
    const subject = path.join(ws, 'replace-me.txt')
    const original = 'Alpha alpha ALPHA\nalphabet stays\n'
    fs.writeFileSync(subject, original)
    fs.writeFileSync(path.join(ws, 'replace-me.md'), 'alpha in markdown\n')
    // The tree's watcher is debounced; searching before it settles is fine,
    // but the file has to be on disk first.
    await sleep(600)

    const search = (query, options) =>
      cdp.evaluate(
        `window.api.searchProjects(${JSON.stringify(query)}, ${JSON.stringify(options ?? {})})`
      )
    const inSubject = (hits) => hits.filter((h) => h.path === subject)

    check(
      'a plain search is case-insensitive and finds every occurrence on a line',
      inSubject(await search('alpha')).length === 4,
      JSON.stringify(inSubject(await search('alpha')).map((h) => h.col))
    )
    check(
      'Match case narrows it to the exact casing',
      inSubject(await search('alpha', { caseSensitive: true })).length === 2
    )
    check(
      'Whole word drops the substring match inside alphabet',
      inSubject(await search('alpha', { wholeWord: true })).length === 3
    )
    check(
      'a regex matches what a literal query would not',
      inSubject(await search('al[a-z]+bet', { regex: true })).length === 1
    )
    check(
      'a literal query with regex off is not treated as a pattern',
      inSubject(await search('al[a-z]+bet')).length === 0
    )
    check(
      'an unfinished regex returns nothing rather than throwing',
      (await search('alpha(', { regex: true })).length === 0
    )
    check(
      'the file filter picks the extension asked for',
      (await search('alpha', { include: '*.md' })).every((h) => h.path.endsWith('.md'))
    )
    check(
      'and excludes what it does not name',
      inSubject(await search('alpha', { include: '*.md' })).length === 0
    )

    const replace = (paths, query, replacement, options) =>
      cdp.evaluate(
        `window.api.replaceInFiles(${JSON.stringify({
          paths,
          query,
          replacement,
          options: options ?? {}
        })})`
      )

    const replaced = await replace([subject], 'alpha', 'beta', {
      caseSensitive: true,
      wholeWord: true
    })
    check(
      'replace across files reports what it changed',
      replaced.success && replaced.filesChanged === 1 && replaced.replacements === 1,
      JSON.stringify(replaced)
    )
    check(
      'it honors the options it was given',
      fs.readFileSync(subject, 'utf-8') === 'Alpha beta ALPHA\nalphabet stays\n',
      JSON.stringify(fs.readFileSync(subject, 'utf-8'))
    )

    const undone = await cdp.evaluate(`window.api.undoReplaceInFiles()`)
    check('the replacement can be taken back', undone.success && undone.filesChanged === 1)
    check(
      'and the file is byte-for-byte what it was',
      fs.readFileSync(subject, 'utf-8') === original
    )
    const secondUndo = await cdp.evaluate(`window.api.undoReplaceInFiles()`)
    check('undo is one step only', secondUndo.success === false, secondUndo.error)

    // Its own temp dir, never listed or opened: the fixture's "outside" file
    // is legitimately granted by then (A3 opens it through Quick Open), and a
    // path like /etc/hosts would be wrecked by the very regression this
    // guards against.
    const lair = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapad-replace-'))
    const offLimits = path.join(lair, 'untouchable.txt')
    fs.writeFileSync(offLimits, 'lives here\n')
    const refused = await replace([offLimits], 'lives', 'gone', {})
    check(
      'a path outside the allowed folders is refused',
      refused.success === false && refused.filesChanged === 0,
      refused.error
    )
    check('and that file is untouched', fs.readFileSync(offLimits, 'utf-8') === 'lives here\n')
    fs.rmSync(lair, { recursive: true, force: true })

    // ---- the same thing through the UI ----
    await cdp.evaluate(`document.querySelector('${SEARCH_BUTTON}').click()`)
    const overlay = await waitFor(`!!document.querySelector('${IN_FILES}')`, { timeoutMs: 4000 })
    check('the search overlay opens for the replace pass', overlay)

    const clickLabel = (label) =>
      cdp.evaluate(
        `(() => { const b = document.querySelector('[aria-label=${JSON.stringify(label)}]');
          if (!b) return false; b.click(); return true })()`
      )
    check('the matcher toggles are there', await clickLabel('Regular expression'))
    check(
      'a toggle reports its state',
      (await cdp.evaluate(
        `document.querySelector('[aria-label="Regular expression"]').getAttribute('aria-pressed')`
      )) === 'true'
    )
    await ui.click(IN_FILES)
    await cdp.send('Input.insertText', { text: 'alpha(' })
    await sleep(500)
    check(
      'an invalid regex says so instead of searching',
      await cdp.evaluate(`document.body.innerText.includes('Invalid regular expression')`)
    )
    await clickLabel('Regular expression')

    // Clear the field and search for the real thing.
    await cdp.evaluate(
      `(() => { const i = document.querySelector('${IN_FILES}');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
    await ui.click(IN_FILES)
    await cdp.send('Input.insertText', { text: 'alphabet' })
    await sleep(700)
    check('the replace row opens from the overlay', await clickLabel('Show Replace'))
    const replaceField = 'input[placeholder^="Replace with"]'
    check(
      'it has a replacement field',
      await waitFor(`!!document.querySelector('${replaceField}')`, { timeoutMs: 3000 })
    )
    await ui.click(replaceField)
    await cdp.send('Input.insertText', { text: 'omega' })
    await sleep(300)
    check(
      'the preview shows the line as it will be written',
      await cdp.evaluate(`document.body.innerText.includes('omega stays')`)
    )

    await ui.clickButton('Replace All')
    const applied = await waitFor(`document.body.innerText.includes('Replaced 1 occurrence')`, {
      timeoutMs: 6000
    })
    check('Replace All applies and reports', applied, await ui.bodyText())
    check(
      'the file on disk carries the replacement',
      fs.readFileSync(subject, 'utf-8') === 'Alpha alpha ALPHA\nomega stays\n',
      JSON.stringify(fs.readFileSync(subject, 'utf-8'))
    )

    await ui.clickButton('Undo')
    const reverted = await waitFor(`document.body.innerText.includes('Reverted 1 file')`, {
      timeoutMs: 6000
    })
    check('Undo puts it back', reverted && fs.readFileSync(subject, 'utf-8') === original)

    await ui.key('Escape', 'Escape', 27)
    fs.rmSync(subject, { force: true })
    fs.rmSync(path.join(ws, 'replace-me.md'), { force: true })
    await sleep(400)
  }
}
