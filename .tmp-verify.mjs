import { _electron as electron } from 'playwright-core'

const APP_DIR = '/Users/struchev-rk/Downloads/fleet-editor'
const SCRATCH = process.argv[2]

const app = await electron.launch({
  executablePath: `${APP_DIR}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: [APP_DIR, `--user-data-dir=${SCRATCH}/userdata`],
  timeout: 30000
})

await new Promise((r) => setTimeout(r, 3000))
const page = await app.firstWindow()
await page.waitForTimeout(2000)

async function sendOpen(filePath) {
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file-request', fp)
  }, filePath)
  await page.waitForTimeout(1000)
}

await sendOpen(`${SCRATCH}/external-dir/outside.ts`)
await page.screenshot({ path: `${SCRATCH}/shots/a-opened.png` })

// Close the tab via the tab bar's X (not the sidebar) - entry should remain.
const closeResult = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.group')].filter((el) =>
    el.textContent?.includes('outside.ts')
  )
  return tabs.length
})
console.log('tab-like elements containing outside.ts:', closeResult)

// Use keyboard shortcut Cmd+W to close the active tab instead of guessing selectors.
await page.keyboard.down('Meta')
await page.keyboard.press('KeyW')
await page.keyboard.up('Meta')
await page.waitForTimeout(1000)
await page.screenshot({ path: `${SCRATCH}/shots/b-after-tab-close.png` })

let text = await page.evaluate(() => document.body.innerText)
console.log('--- after closing tab (should still list outside.ts) ---')
console.log(text.slice(0, 1000))

// Now hover the sidebar row and click its X to remove-and-close.
const hoverBox = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span, div')].find(
    (e) => e.textContent?.trim() === 'outside.ts' && e.children.length === 0
  )
  const row = el?.closest('.group')
  const rect = row?.getBoundingClientRect()
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
})
console.log('row rect:', hoverBox)

if (hoverBox) {
  await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SCRATCH}/shots/c-hover.png` })

  const clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span, div')].find(
      (e) => e.textContent?.trim() === 'outside.ts' && e.children.length === 0
    )
    const row = el?.closest('.group')
    const btn = row?.querySelector('button')
    if (!btn) return 'NO_BUTTON'
    btn.click()
    return 'CLICKED'
  })
  console.log('remove click:', clicked)
  await page.waitForTimeout(1000)
}

await page.screenshot({ path: `${SCRATCH}/shots/d-after-remove.png` })
text = await page.evaluate(() => document.body.innerText)
console.log('--- after clicking X (should be gone) ---')
console.log(text.slice(0, 1000))

await app.close()
