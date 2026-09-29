import fs from 'fs'
import path from 'path'

// A2 - open a file, edit it, let autosave persist it. The core loop.
//
// Assertions deliberately avoid Monaco's rendered text: the editor's DOM is
// empty whenever the window isn't frontmost, so app state (the persisted
// session) and the file on disk are the ground truth here.
export default {
  id: 'A2',
  title: 'Open, edit, autosave',
  async run({ cdp, ui, ws, check, waitFor, sleep, read }) {
    const active = await ui.openFile(`${ws}/notes.txt`)
    check('clicking a file opens it as the active tab', active, JSON.stringify(await ui.openTabs()))
    check(
      'the editor is mounted',
      await waitFor(`!!document.querySelector('.monaco-editor')`, { timeoutMs: 15_000 })
    )
    check(
      'the tab strip shows it',
      (await ui.openTabLabels()).some((l) => l.startsWith('notes.txt'))
    )

    const before = read('notes.txt')
    await ui.typeInEditor('typed-by-smoke ')
    const saved = await waitFor(
      `window.api.readFile(${JSON.stringify(`${ws}/notes.txt`)}).then((r) => (r.content || '').includes('typed-by-smoke'))`,
      { timeoutMs: 10_000 }
    )
    check('typing autosaves to disk', saved, JSON.stringify(read('notes.txt').slice(0, 60)))
    check(
      'the rest of the file is untouched',
      before.split('\n').every((line) => !line || read('notes.txt').includes(line))
    )

    const stillDirty = await cdp.evaluate(`!!document.querySelector('.bg-blue-500.rounded-full')`)
    check('the unsaved dot clears after autosave', !stillDirty)

    // An outside edit to a file *the app itself last saved* (docs/BUGS.md §8).
    // On macOS that write comes back as a 'rename' event, because our own
    // atomic save already marked the path as renamed and FSEvents coalesces
    // those flags per path - so the tab kept its stale buffer with no banner,
    // and the next autosave wrote it straight back over the other side's
    // change, silently.
    const readme = path.join(ws, 'readme.md')
    check('a second file opens', await ui.openFile(readme))
    await ui.focusEditor()
    await ui.key('ArrowDown', 'ArrowDown', 40, 4)
    await cdp.send('Input.insertText', { text: '\nsaved by the app\n' })
    check(
      'the app saves it once itself',
      await waitFor(
        `window.api.readFile(${JSON.stringify(readme)}).then((r) => (r.content || '').includes('saved by the app'))`,
        { timeoutMs: 10_000 }
      )
    )

    // The Markdown preview renders the tab's own buffer as ordinary React DOM,
    // which is how the reload can be observed without reading Monaco's (see
    // the note at the top of this file).
    await ui.togglePreview()
    check(
      'its preview shows what the tab holds',
      await waitFor(
        `(document.querySelector('.markdown-body')?.innerText || '').includes('saved by the app')`,
        { timeoutMs: 8000 }
      )
    )

    // Out of the self-write grace window first (1.5 s), or the watcher would
    // rightly read the outside write as the tail of our own save.
    await sleep(1800)
    fs.writeFileSync(readme, '# Title\n\nedited outside the app\n')
    check(
      'an outside edit to a file the app itself saved reaches the tab',
      await waitFor(
        `(document.querySelector('.markdown-body')?.innerText || '').includes('edited outside the app')`,
        { timeoutMs: 15_000 }
      ),
      await cdp.evaluate(`document.querySelector('.markdown-body')?.innerText || ''`)
    )
    await ui.togglePreview()

    // Two names that read as the same URI: "a%20b" is what "a b" looks like
    // once percent-encoded. Monaco models used to be keyed by Uri.parse(path),
    // which gave both files one model - the second tab showed the first
    // file's text and autosaved it over its own.
    const spaced = path.join(ws, 'uri a b.txt')
    const encoded = path.join(ws, 'uri a%20b.txt')
    fs.writeFileSync(spaced, 'first-file-body\n')
    fs.writeFileSync(encoded, 'second-file-body\n')
    check('a file with a space in its name opens', await ui.openFile(spaced))
    check('and one with %20 in its name opens too', await ui.openFile(encoded))
    await ui.focusEditor()
    await cdp.send('Input.insertText', { text: 'typed-into-encoded ' })
    const encodedSaved = await waitFor(
      `window.api.readFile(${JSON.stringify(encoded)}).then((r) => (r.content || '').includes('typed-into-encoded'))`,
      { timeoutMs: 10_000 }
    )
    check('typing into the %20 file autosaves it', encodedSaved)
    check(
      'it keeps its own text, not the look-alike file',
      fs.readFileSync(encoded, 'utf-8').includes('second-file-body') &&
        !fs.readFileSync(encoded, 'utf-8').includes('first-file-body'),
      JSON.stringify(fs.readFileSync(encoded, 'utf-8'))
    )
    check(
      'and the look-alike file is untouched',
      fs.readFileSync(spaced, 'utf-8') === 'first-file-body\n',
      JSON.stringify(fs.readFileSync(spaced, 'utf-8'))
    )
  }
}
