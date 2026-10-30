// A1 - the workspace tree: what the app shows before you touch anything.
export default {
  id: 'A1',
  title: 'Workspace tree',
  async run({ cdp, ui, ws, check }) {
    const rows = await cdp.evaluate(
      `[...document.querySelectorAll('[data-tree-row]')].map((r) => r.dataset.path)`
    )
    check('the workspace root is shown', rows.includes(ws), rows.join(', '))
    check('top-level files are listed', rows.includes(`${ws}/notes.txt`))
    check('folders are listed', rows.includes(`${ws}/src`))

    check(
      'node_modules is hidden',
      !rows.some((p) => p.includes('/node_modules')),
      rows.find((p) => p.includes('node_modules')) ?? ''
    )
    check(
      '.gitignore entries are hidden',
      !rows.some((p) => p.includes('/ignored-by-git')),
      rows.find((p) => p.includes('ignored-by-git')) ?? ''
    )

    // Folders start collapsed; clicking one expands it in place.
    check('a folder starts collapsed', !(await ui.rowExists(`${ws}/src/main.ts`)))
    await ui.clickRow(`${ws}/src`)
    check('clicking a folder expands it', await ui.rowExists(`${ws}/src/main.ts`))
    await ui.clickRow(`${ws}/src`)
    check('clicking it again collapses it', !(await ui.rowExists(`${ws}/src/main.ts`)))
  }
}
