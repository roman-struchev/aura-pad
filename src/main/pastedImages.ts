import { clipboard } from 'electron'
import fs from 'fs'
import path from 'path'
import { readFilesFromClipboard } from './clipboardFiles'
import { pathDenial } from './pathAccess'
import type { PastedImageResult } from '../shared/ipc'

// Pasting an image into a Markdown file: the bytes are written next to the
// document and the editor gets a relative link to them, which is what keeps
// the note portable - it and its images move together, and nothing depends on
// wherever the screenshot happened to be taken.
//
// The clipboard is read here rather than in the renderer: a screenshot arrives
// as raw image data (Electron's own clipboard.readImage), while a file copied
// in Finder/Explorer arrives as a path (clipboardFiles.ts). Both are the same
// gesture to the user, so both are handled, and the renderer only has to say
// "there is an image on the clipboard, put it beside this file".

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
// Where images go, relative to the Markdown file. A folder rather than a
// sibling file keeps a note's images together and out of the tree's way.
const ASSETS_DIR = 'assets'

function timestampName(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

// "image-20260827-174501.png", and "-2", "-3"… if that second already has one.
function freeName(dir: string, base: string, ext: string): string {
  let candidate = `${base}${ext}`
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) {
    candidate = `${base}-${n}${ext}`
  }
  return candidate
}

// The clipboard's image, as bytes plus the extension to store it under.
function clipboardImage(): { data: Buffer; ext: string } | null {
  const image = clipboard.readImage()
  if (!image.isEmpty()) return { data: image.toPNG(), ext: '.png' }

  // A file copied in the OS file manager: keep its own format (and its
  // extension) rather than re-encoding it as PNG.
  for (const filePath of readFilesFromClipboard()) {
    const ext = path.extname(filePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) continue
    try {
      return { data: fs.readFileSync(filePath), ext }
    } catch {
      // Unreadable (permissions, or it moved since the copy) - try the next.
    }
  }
  return null
}

// The Markdown preview's side of the same feature: the renderer's CSP allows
// data: images but not file:, and loosening it would let a previewed document
// pull in any local file it names. Instead main hands back the bytes of an
// image the preview is allowed to see - inside a workspace, or wherever else
// the path allowlist already permits.
const MAX_PREVIEW_IMAGE_BYTES = 10 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

export function readImageDataUrl(imagePath: string): { success: boolean; dataUrl?: string } {
  if (pathDenial(imagePath)) return { success: false }
  const mime = MIME_BY_EXT[path.extname(imagePath).toLowerCase()]
  if (!mime) return { success: false }
  try {
    const stat = fs.statSync(imagePath)
    if (!stat.isFile() || stat.size > MAX_PREVIEW_IMAGE_BYTES) return { success: false }
    return {
      success: true,
      dataUrl: `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`
    }
  } catch {
    return { success: false }
  }
}

export function savePastedImage(documentPath: string): PastedImageResult {
  const denial = pathDenial(documentPath)
  if (denial) return { success: false, error: denial }

  const image = clipboardImage()
  if (!image) return { success: false, error: 'There is no image on the clipboard.' }

  const dir = path.join(path.dirname(documentPath), ASSETS_DIR)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const name = freeName(dir, `image-${timestampName()}`, image.ext)
    fs.writeFileSync(path.join(dir, name), image.data)
    // Posix separators and percent-encoded spaces: this goes into Markdown,
    // which is read as a URL, not as a filesystem path.
    return {
      success: true,
      relativePath: `${ASSETS_DIR}/${encodeURIComponent(name)}`,
      absolutePath: path.join(dir, name)
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Could not save the image.' }
  }
}
