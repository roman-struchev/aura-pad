import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)

// A5 - non-UTF-8 files survive a read/write round-trip (docs/TEST_CASES.md §1).
// Pure IPC, so it is both the cheapest and the highest-stakes case here: the
// bug it guards silently destroyed file contents.
export default {
  id: 'A5',
  title: 'Text encodings',
  async run({ cdp, ws, check, readBytes }) {
    const iconv = require(path.join(process.cwd(), 'node_modules', 'iconv-lite'))

    const cp1251 = await cdp.evaluate(`window.api.readFile(${JSON.stringify(`${ws}/cp1251.txt`)})`)
    check(
      'a cp1251 file reads as real text',
      cp1251.success && cp1251.content.startsWith('Привет мир'),
      JSON.stringify(cp1251.content?.slice(0, 20) ?? cp1251.error)
    )

    await cdp.evaluate(
      `window.api.saveFile(${JSON.stringify(`${ws}/cp1251.txt`)}, 'Привет мир!\\nправка\\n')`
    )
    const bytes = readBytes('cp1251.txt')
    check(
      'saving it keeps the file in cp1251',
      iconv.decode(bytes, 'windows-1251') === 'Привет мир!\nправка\n',
      bytes.subarray(0, 8).toString('hex')
    )
    check(
      'no UTF-8 BOM is introduced',
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    )

    const utf16 = await cdp.evaluate(`window.api.readFile(${JSON.stringify(`${ws}/utf16.txt`)})`)
    check('a UTF-16 file reads correctly', utf16.success && utf16.content.includes('UTF16 Привет'))
    await cdp.evaluate(
      `window.api.saveFile(${JSON.stringify(`${ws}/utf16.txt`)}, 'UTF16 Привет!\\n')`
    )
    const utf16Bytes = readBytes('utf16.txt')
    check(
      'its BOM and encoding survive the save',
      utf16Bytes[0] === 0xff && utf16Bytes[1] === 0xfe,
      utf16Bytes.subarray(0, 4).toString('hex')
    )

    const binary = await cdp.evaluate(`window.api.readFile(${JSON.stringify(`${ws}/binary.dat`)})`)
    check(
      'a binary file is refused rather than mangled',
      !binary.success && /binary/i.test(binary.error ?? ''),
      binary.error ?? ''
    )
  }
}
