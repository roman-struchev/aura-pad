import fs from 'fs'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'

// Text-encoding detection and round-tripping. Files are decoded to a JS
// string on open and encoded back on save; without this every read assumed
// UTF-8, so a legacy cp1251/latin1 file rendered as U+FFFD replacement
// characters - and the next (auto)save wrote those replacements back over
// the original bytes, silently and irreversibly corrupting the file.
//
// The detected encoding is remembered per path (the tab path the renderer
// passes) so the matching save writes the same bytes back out. Renames and
// moves must carry entries along via remapEncodingPaths(), or the first save
// after a rename would silently fall back to UTF-8 and transcode the file.

interface FileEncoding {
  // iconv-lite encoding name, e.g. 'utf-8', 'windows-1251', 'utf-16le'.
  name: string
  hasBOM: boolean
}

const UTF8: FileEncoding = { name: 'utf-8', hasBOM: false }

// Insertion-ordered with a size cap, same shape as the watcher's
// lastSelfWrites - an entry per opened file is tiny, but a long session
// shouldn't grow it unboundedly.
const fileEncodings = new Map<string, FileEncoding>()
const ENCODING_MAP_LIMIT = 1000

function remember(filePath: string, enc: FileEncoding): void {
  fileEncodings.delete(filePath)
  fileEncodings.set(filePath, enc)
  if (fileEncodings.size > ENCODING_MAP_LIMIT) {
    fileEncodings.delete(fileEncodings.keys().next().value!)
  }
}

// Below this, jschardet is guessing rather than detecting - refusing to open
// beats decoding with the wrong table and corrupting the file on save.
const MIN_DETECT_CONFIDENCE = 0.25
// Detection needs a representative sample, not the whole (up to 10MB) file.
const DETECT_SAMPLE_BYTES = 128 * 1024

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

export interface DecodedFile {
  content?: string
  error?: string
}

export function decodeFileBuffer(filePath: string, buf: Buffer): DecodedFile {
  // BOM-marked files first: a UTF-16 file is full of NUL bytes and would
  // otherwise be rejected as binary by the sniff below.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    remember(filePath, { name: 'utf-16le', hasBOM: true })
    return { content: iconv.decode(buf, 'utf-16le') }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    remember(filePath, { name: 'utf-16be', hasBOM: true })
    return { content: iconv.decode(buf, 'utf-16be') }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    try {
      const content = strictUtf8.decode(buf.subarray(3))
      remember(filePath, { name: 'utf-8', hasBOM: true })
      return { content }
    } catch {
      // A UTF-8 BOM on non-UTF-8 bytes - fall through to detection.
    }
  }

  // NUL in the first few KB = binary, the same heuristic git.ts uses for
  // untracked-file stats (any UTF-16 text was already caught above).
  if (buf.subarray(0, 8000).includes(0)) {
    return { error: 'This looks like a binary file and cannot be opened.' }
  }

  try {
    const content = strictUtf8.decode(buf)
    remember(filePath, UTF8)
    return { content }
  } catch {
    // Not valid UTF-8 - a legacy single-byte encoding, most likely.
  }

  const detected = jschardet.detect(buf.subarray(0, DETECT_SAMPLE_BYTES))
  if (
    !detected.encoding ||
    detected.confidence < MIN_DETECT_CONFIDENCE ||
    !iconv.encodingExists(detected.encoding)
  ) {
    return { error: 'Could not detect this file’s text encoding.' }
  }
  remember(filePath, { name: detected.encoding, hasBOM: false })
  return { content: iconv.decode(buf, detected.encoding) }
}

// Nothing is remembered for this path: it was never read in this session, or
// its entry aged out of ENCODING_MAP_LIMIT while the tab stayed open. Falling
// back to UTF-8 in the latter case would silently transcode a legacy-encoded
// file on its next (auto)save, so re-detect from the bytes currently on disk
// instead - decodeFileBuffer registers what it finds, same as a real read.
// Only ever reached on the fallback path, so the extra read costs nothing in
// the normal case, and a path with no file behind it (a brand-new file) still
// ends up as UTF-8.
function detectFromDisk(filePath: string): FileEncoding {
  try {
    decodeFileBuffer(filePath, fs.readFileSync(filePath))
  } catch {
    // Missing/unreadable - nothing to preserve.
  }
  return fileEncodings.get(filePath) ?? UTF8
}

// Encodes a buffer to write back to filePath, in the same encoding (and with
// the same BOM) its last read detected; UTF-8 for never-read paths (new
// files). Characters unrepresentable in a legacy target encoding become '?' -
// iconv's standard behavior, and what most editors do.
export function encodeFileContent(filePath: string, content: string): Buffer {
  const enc = fileEncodings.get(filePath) ?? detectFromDisk(filePath)
  if (enc.name === 'utf-8') {
    const body = Buffer.from(content, 'utf-8')
    return enc.hasBOM ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
  }
  return iconv.encode(content, enc.name, { addBOM: enc.hasBOM })
}

// Decodes bytes using the encoding already detected for filePath (UTF-8 when
// none is known), without registering anything - for secondary content tied
// to the same file, e.g. the HEAD version of a working file in a git diff.
export function decodeLikeFile(filePath: string, buf: Buffer): string {
  const enc = fileEncodings.get(filePath) ?? UTF8
  return iconv.decode(buf, enc.name)
}

export function remapEncodingPaths(oldPath: string, newPath: string): void {
  for (const [key, value] of [...fileEncodings]) {
    if (key === oldPath) {
      fileEncodings.delete(key)
      fileEncodings.set(newPath, value)
    } else if (key.startsWith(oldPath + '/')) {
      fileEncodings.delete(key)
      fileEncodings.set(newPath + key.slice(oldPath.length), value)
    }
  }
}
