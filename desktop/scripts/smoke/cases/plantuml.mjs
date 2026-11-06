import fs from 'fs'
import path from 'path'

// A24 - PlantUML files preview as a diagram, rendered by the bundled engine:
// no Java, no server. Changes reach the preview through the file on disk
// (the same path an edit takes - both land in the tab's content).
export default {
  id: 'A24',
  title: 'PlantUML preview',
  async run({ cdp, ui, ws, check, waitFor, sleep }) {
    // The SVG travels as a data: URL; decoding it is the ground truth for
    // what was drawn.
    const diagramHas = (word) =>
      `(() => {
        const i = document.querySelector('[data-testid="plantuml-preview"] [data-testid="zoomable-image"]')
        return !!i && decodeURIComponent(i.src).includes(${JSON.stringify(word)})
      })()`
    const errorShown = `!!document.querySelector('[data-testid="plantuml-error"]')`
    const errorText = () =>
      cdp.evaluate(`document.querySelector('[data-testid="plantuml-error"]')?.innerText || ''`)

    check(
      'the engine is not loaded before the first diagram',
      (await cdp.evaluate('typeof globalThis.PLANTUML_VIZ')) === 'undefined'
    )

    const doc = path.join(ws, 'sequence.puml')
    fs.writeFileSync(doc, '@startuml\nAlice -> Bob : hello\n@enduml\n')
    check('a .puml file opens', await ui.openFile(doc))
    check('it offers a preview toggle', await ui.buttonExists('Show Preview'))
    await ui.togglePreview()
    // The first preview loads the engine (a few MB), so allow for it.
    check(
      'the diagram renders',
      await waitFor(diagramHas('Alice'), { timeoutMs: 30_000 }),
      await errorText()
    )
    check(
      'and the engine got Graphviz handed over',
      (await cdp.evaluate('typeof globalThis.PLANTUML_VIZ')) === 'object'
    )

    fs.writeFileSync(doc, '@startuml\nAlice -> Bob : hello\nBob -> Carol : hi\n@enduml\n')
    check(
      'a change to the source reaches the preview',
      await waitFor(diagramHas('Carol'), { timeoutMs: 15_000 }),
      await errorText()
    )

    fs.writeFileSync(doc, 'Dave -> Erin : no start/end lines\n')
    check(
      'a diagram without @startuml still renders',
      await waitFor(diagramHas('Erin'), { timeoutMs: 15_000 }),
      await errorText()
    )

    fs.writeFileSync(doc, '@startuml\nAlice -> Bob\nthis is { not plantuml ((\n@enduml\n')
    check(
      'an invalid source shows the error in place, with its line',
      await waitFor(
        `${errorShown} && /Line 3/.test(document.querySelector('[data-testid="plantuml-error"]').innerText)`,
        {
          timeoutMs: 15_000
        }
      ),
      await errorText()
    )

    // A local include, resolved against the diagram's folder.
    // It includes a file of its own from a subfolder: that one resolves next
    // to common.iuml, not next to the diagram.
    const shared = path.join(ws, 'common.iuml')
    const nestedDir = path.join(ws, 'puml-inner')
    fs.mkdirSync(nestedDir, { recursive: true })
    fs.writeFileSync(path.join(nestedDir, 'deep.iuml'), 'Xia -> Wren : nested include\n')
    fs.writeFileSync(shared, 'Zed -> Yan : from include\n!include puml-inner/deep.iuml\n')
    fs.writeFileSync(doc, '@startuml\n!include common.iuml\nAlice -> Bob\n@enduml\n')
    check(
      'a local !include is read from disk',
      await waitFor(diagramHas('Yan'), { timeoutMs: 15_000 }),
      await errorText()
    )
    check(
      'an include inside an included file resolves against that file',
      await waitFor(diagramHas('Wren'), { timeoutMs: 15_000 }),
      await errorText()
    )

    // The standard library would come off the network: refused instead.
    fs.writeFileSync(doc, '@startuml\n!include <C4/C4_Context>\nPerson(u, "User")\n@enduml\n')
    check(
      'a standard-library include is reported, not fetched',
      await waitFor(
        `${errorShown} && document.querySelector('[data-testid="plantuml-error"]').innerText.includes('C4/C4_Context')`,
        { timeoutMs: 15_000 }
      ),
      await errorText()
    )

    fs.writeFileSync(doc, '@startuml\n!include nope.iuml\nAlice -> Bob\n@enduml\n')
    check(
      'a missing local include is named in the error',
      await waitFor(
        `${errorShown} && document.querySelector('[data-testid="plantuml-error"]').innerText.includes('nope.iuml')`,
        { timeoutMs: 15_000 }
      ),
      await errorText()
    )

    await ui.togglePreview()
    check(
      'toggling back shows the source',
      await waitFor(`!document.querySelector('[data-testid="plantuml-preview"]')`, {
        timeoutMs: 4000
      })
    )

    await ui.closeTab('sequence.puml').catch(() => {})
    await sleep(200)
    fs.rmSync(doc, { force: true })
    fs.rmSync(shared, { force: true })
    fs.rmSync(nestedDir, { recursive: true, force: true })
    await sleep(300)
  }
}
