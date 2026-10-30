import fs from 'fs'
import path from 'path'

const J = JSON.stringify

// A tiny Hunspell dictionary, planted where a downloaded one would live. The
// download itself is the one part that needs the network (Part B §20); every
// thing after it - loading, checking, the toolbar count - is the same code
// path a real dictionary takes.
const AFF = 'SET UTF-8\nTRY esianrtolcdugmphbyfvkwz\n\nSFX S Y 1\nSFX S 0 s .\n'
const DIC = '5\nhello/S\nworld/S\nnote/S\ncheck/S\nspelling\n'

// A18 - offline spell checking: unknown words in prose, counted in the
// toolbar, and never in a file that isn't prose.
export default {
  id: 'A18',
  title: 'Spell checking',
  async run({ cdp, ui, ws, fixture, check, waitFor, sleep }) {
    const dictDir = path.join(fixture.profile, 'dictionaries', 'en')
    fs.mkdirSync(dictDir, { recursive: true })
    fs.writeFileSync(path.join(dictDir, 'index.aff'), AFF)
    fs.writeFileSync(path.join(dictDir, 'index.dic'), DIC)
    fs.writeFileSync(path.join(dictDir, 'license'), 'test fixture\n')

    check(
      'main lists the installed dictionary',
      (await cdp.evaluate('window.api.spellDictionaries()')).includes('en')
    )
    const bogus = await cdp.evaluate(`window.api.spellReadDictionary('../../../etc/passwd')`)
    check('a language the catalog does not know is refused', bogus.success === false, bogus.error)

    // Turn it on the way a user does: Settings -> Voice & Language -> Spelling.
    await ui.clickButton('Settings')
    await waitFor(`document.body.innerText.includes('Appearance')`, { timeoutMs: 5000 })
    await ui.clickButton('Voice & Language')
    const opened = await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('div')].find(
        (d) => d.children.length === 2 && d.innerText.startsWith('Spelling')
      )
      const button = row && row.querySelector('button')
      if (!button) return false
      button.click()
      return true
    })()`)
    check('Settings offers a Spelling section', opened === true)
    check(
      'it opens the dictionary list',
      await waitFor(`document.body.innerText.includes('Download once')
         || document.body.innerText.includes('Installed')`, { timeoutMs: 5000 })
    )
    check(
      'the planted dictionary shows as installed',
      await cdp.evaluate(`document.body.innerText.includes('Installed')`)
    )

    await cdp.evaluate(`document.querySelector('[aria-label="Check Spelling"]').click()`)
    await cdp.evaluate(`document.querySelector('[aria-label="Use English"]').click()`)
    check(
      'enabling it is remembered like any other setting',
      await waitFor(
        `window.api.getSettings().then((s) => s.spellcheckEnabled && s.spellLanguages.includes('en'))`,
        { timeoutMs: 5000 }
      )
    )
    await ui.key('Escape', 'Escape', 27)
    await ui.key('Escape', 'Escape', 27)
    await sleep(300)

    // Five words the dictionary knows (one only through its suffix rule) and
    // two typos.
    const doc = path.join(ws, 'spelling.md')
    fs.writeFileSync(doc, 'hello world\n\nnotes check spelling\n\nhelo wrld\n')
    await ui.openFile(doc)

    const count = () =>
      cdp.evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((b) =>
          (b.getAttribute('aria-label') || '').startsWith('Spelling issues:'))
        return b ? Number(b.getAttribute('aria-label').replace(/\\D/g, '')) : null
      })()`)

    const found = await waitFor(
      `(() => {
        const b = [...document.querySelectorAll('button')].find((b) =>
          (b.getAttribute('aria-label') || '').startsWith('Spelling issues:'))
        return b && b.getAttribute('aria-label') !== 'Spelling issues: 0'
          ? b.getAttribute('aria-label') : null
      })()`,
      { timeoutMs: 15_000 }
    )
    check('the toolbar reports the unknown words', found === 'Spelling issues: 2', String(found))

    // A word the dictionary only knows through an affix rule ("notes" from
    // "note/S") is not one of them, and neither is the correctly spelled rest.
    check('and only those - affixed forms count as known', (await count()) === 2)

    // It re-checks as the text changes, not only when a file opens. Typed at
    // the very end of the file (Cmd+Down parks the cursor there), so the new
    // word can't land inside an existing one.
    await ui.focusEditor()
    await ui.key('ArrowDown', 'ArrowDown', 40, 4)
    await cdp.send('Input.insertText', { text: ' zzz' })
    const grew = await waitFor(
      `(() => {
        const b = [...document.querySelectorAll('button')].find((b) =>
          (b.getAttribute('aria-label') || '').startsWith('Spelling issues:'))
        return b && b.getAttribute('aria-label') === 'Spelling issues: 3' ? true : null
      })()`,
      { timeoutMs: 15_000 }
    )
    check('typing another unknown word is picked up', grew === true, String(await count()))

    // A file whose every word is known reports nothing.
    const clean = path.join(ws, 'clean.md')
    fs.writeFileSync(clean, 'hello world\n\nnotes check spelling\n')
    await ui.openFile(clean)
    const none = await waitFor(
      `(() => {
        const b = [...document.querySelectorAll('button')].find((b) =>
          (b.getAttribute('aria-label') || '').startsWith('Spelling issues:'))
        return b && b.getAttribute('aria-label') === 'Spelling issues: 0' ? true : null
      })()`,
      { timeoutMs: 15_000 }
    )
    check('a file with nothing unknown in it reports none', none === true, String(await count()))

    // Source files are left alone: every identifier in them would be a typo.
    await ui.openFile(`${ws}/data.json`)
    await sleep(500)
    check('a file that is not prose is not checked', (await count()) === null)

    // Leave the app as the later cases expect it: off, through the same
    // switch that turned it on.
    await ui.clickButton('Settings')
    await waitFor(`document.body.innerText.includes('Appearance')`, { timeoutMs: 5000 })
    await ui.clickButton('Voice & Language')
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('div')].find(
        (d) => d.children.length === 2 && d.innerText.startsWith('Spelling')
      )
      row?.querySelector('button')?.click()
      return true
    })()`)
    await sleep(300)
    await cdp.evaluate(`document.querySelector('[aria-label="Check Spelling"]')?.click()`)
    await ui.key('Escape', 'Escape', 27)
    await ui.key('Escape', 'Escape', 27)
    await sleep(300)
    await ui.closeTab('spelling.md')
    await ui.closeTab('clean.md')
    fs.rmSync(doc, { force: true })
    fs.rmSync(clean, { force: true })
    await sleep(400)
  }
}
