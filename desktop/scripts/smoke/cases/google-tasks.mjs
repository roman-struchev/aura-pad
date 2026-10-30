// A22 - Google Tasks: moving a task to another connected account. Runs
// against the mock in gtasks-mock.mjs (two accounts planted by the fixture),
// so the ground truth is what the "server" holds afterwards, not the DOM.
export default {
  id: 'A22',
  title: 'Google Tasks: move a task to another account',
  async run({ cdp, ui, check, skip, sleep, waitFor, gtasks }) {
    if (!gtasks) {
      skip('moving a task between accounts', 'the Google Tasks mock could not bind its port')
      return
    }

    await cdp.evaluate(
      `document.querySelector('[title="Google Tasks"]').scrollIntoView({ block: 'center' })`
    )
    await ui.click('[title="Google Tasks"]')
    const row = (id) => `[data-gtask-id="${id}"]`
    check(
      'the Google Tasks tab lists the first account’s tasks',
      await waitFor(`!!document.querySelector('${row('t1')}')`, { timeoutMs: 10_000 })
    )

    const moveButton = `${row('t1')} [title="Move to another account"]`
    check(
      'with two accounts, a task offers “Move to another account”',
      await cdp.evaluate(`!!document.querySelector('${moveButton}')`)
    )

    // Right-click opens the same menu; Escape dismisses it untouched.
    await cdp.evaluate(`(() => {
      const el = document.querySelector('${row('t4')}')
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5
      }))
    })()`)
    const menuOpen = `document.body.innerText.includes('Move to account')`
    check('right-clicking a task opens the move menu', await waitFor(menuOpen, { timeoutMs: 3000 }))
    check(
      'the menu lists the other account’s task lists',
      await waitFor(
        `document.body.innerText.includes('second@example.com') &&
         [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Work')`,
        { timeoutMs: 5000 }
      )
    )
    check(
      'the menu does not offer the task’s own account',
      !(await cdp.evaluate(`(() => {
        const menu = [...document.querySelectorAll('div.fixed')].find((d) =>
          d.innerText.includes('Move to account'))
        return menu ? menu.innerText.includes('first@example.com') : true
      })()`))
    )
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    check('Escape closes the move menu', await waitFor(`!(${menuOpen})`, { timeoutMs: 3000 }))

    // The hover icon -> pick "Work" of the second account: two clicks.
    await cdp.evaluate(`document.querySelector('${moveButton}').click()`)
    await waitFor(menuOpen, { timeoutMs: 3000 })
    await cdp.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Work').click()`
    )

    const settled = async () => {
      for (let i = 0; i < 50; i++) {
        if (!gtasks.tasksOf('first@example.com', 'first-default').some((t) => t.id === 't1'))
          return true
        await sleep(100)
      }
      return false
    }
    check('the task is removed from the source account', await settled())
    const source = gtasks.tasksOf('first@example.com', 'first-default')
    check(
      'its subtasks went with it, the rest of the list stayed',
      source.length === 1 && source[0].title === 'Stay put',
      JSON.stringify(source.map((t) => t.title))
    )

    const target = gtasks.tasksOf('second@example.com', 'second-work')
    const moved = target.find((t) => !t.parent)
    check(
      'the task arrives in the picked list with its notes and due date',
      moved?.title === 'Move me across' &&
        moved.notes === 'with notes' &&
        moved.due === '2026-12-01T00:00:00.000Z',
      JSON.stringify(target)
    )
    const children = target
      .filter((t) => t.parent === moved?.id)
      .sort((a, b) => a.position.localeCompare(b.position))
      .map((t) => t.title)
    check(
      'its subtasks arrive under it, in order',
      JSON.stringify(children) === JSON.stringify(['first child', 'second child']),
      JSON.stringify(children)
    )
    check(
      'the other lists of the target account are untouched',
      gtasks.tasksOf('second@example.com', 'second-default').length === 1
    )
    check(
      'the moved task disappears from the tab',
      await waitFor(
        `!document.querySelector('${row('t1')}') && !document.querySelector('${row('t2')}') &&
         !!document.querySelector('${row('t4')}')`,
        { timeoutMs: 5000 }
      )
    )
  }
}
