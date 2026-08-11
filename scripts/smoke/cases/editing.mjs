// A2 - open a file, edit it, let autosave persist it. The core loop.
//
// Assertions deliberately avoid Monaco's rendered text: the editor's DOM is
// empty whenever the window isn't frontmost, so app state (the persisted
// session) and the file on disk are the ground truth here.
export default {
  id: 'A2',
  title: 'Open, edit, autosave',
  async run({ cdp, ui, ws, check, waitFor, read }) {
    await ui.clickRow(`${ws}/notes.txt`)
    const active = await waitFor(
      `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(`${ws}/notes.txt`)})`,
      { timeoutMs: 8000 }
    )
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
  }
}
