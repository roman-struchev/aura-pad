// A7 - Markdown/HTML preview and the JSON formatter.
export default {
  id: 'A7',
  title: 'Preview and formatting',
  async run({ cdp, ui, ws, check, waitFor }) {
    const openAndWait = async (path) => {
      await ui.clickRow(path)
      return waitFor(
        `window.api.getOpenTabs().then((s) => s.activeTabPath === ${JSON.stringify(path)})`,
        { timeoutMs: 8000 }
      )
    }

    check('a Markdown file opens', await openAndWait(`${ws}/readme.md`))
    check('the toolbar offers a preview toggle', await ui.buttonExists('Show Preview'))

    await ui.togglePreview()
    check(
      'Markdown renders as a preview',
      await waitFor(`!!document.querySelector('.markdown-body')`, { timeoutMs: 6000 })
    )
    check(
      'the rendered Markdown shows the file content',
      await cdp.evaluate(
        `(document.querySelector('.markdown-body')?.innerText || '').includes('Title')`
      )
    )

    await ui.togglePreview()
    check(
      'toggling it off returns to the source',
      await waitFor(`!document.querySelector('.markdown-body')`, { timeoutMs: 6000 })
    )

    check('an HTML file opens', await openAndWait(`${ws}/page.html`))
    await ui.togglePreview()
    check(
      'HTML renders in the preview frame',
      await waitFor(`!!document.querySelector('iframe[title="HTML Preview"]')`, {
        timeoutMs: 6000
      })
    )
    await ui.togglePreview()

    // Format Document: a menu accelerator (Option+Cmd+L) plus a toolbar button
    // that only appears for the formats it supports.
    check('a JSON file opens', await openAndWait(`${ws}/data.json`))
    // Labelled "Format JSON" for .json and "Format Document" for html/xml.
    check('the toolbar offers a Format action for it', await ui.buttonExists('Format'))
    await ui.clickButton('Format')
    const formatted = await waitFor(
      `window.api.readFile(${JSON.stringify(`${ws}/data.json`)}).then((r) => (r.content || '').includes('\\n  '))`,
      { timeoutMs: 10_000 }
    )
    check('Format Document rewrites the JSON indented, and it autosaves', formatted)
  }
}
