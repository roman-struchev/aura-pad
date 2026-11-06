import React, { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { ZoomableImage } from './ZoomableImage'
import { formatBytes } from '../lib/formatBytes'
import type { ImageDataUrlResult } from '../../../shared/ipc'

// An image file's tab. Read-only: the bytes come from main as a data: URL
// (the CSP has no file: source), re-fetched whenever `revision` moves - that
// is how a change on disk reaches an image tab (see useTabs).

const LIMIT_MB = 10

function failureText(result: ImageDataUrlResult): string {
  switch (result.reason) {
    case 'too-large':
      return `This image is too large to preview (${((result.size ?? 0) / (1024 * 1024)).toFixed(1)} MB, limit is ${LIMIT_MB} MB).`
    case 'missing':
      return 'This image is no longer available.'
    case 'denied':
      return 'This image is outside the open workspaces and the files you opened yourself.'
    default:
      return 'This image format cannot be previewed.'
  }
}

export const ImageViewer: React.FC<{ path: string; revision?: number }> = ({ path, revision }) => {
  const [result, setResult] = useState<ImageDataUrlResult | null>(null)
  const [decodeFailed, setDecodeFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.readImageDataUrl(path).then((r) => {
      if (cancelled) return
      setDecodeFailed(false)
      setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [path, revision])

  if (!result) return <div className="h-full" data-testid="image-viewer" />

  const error = !result.success
    ? failureText(result)
    : decodeFailed
      ? 'This image could not be decoded.'
      : null

  if (error) {
    return (
      <div
        data-testid="image-viewer"
        className="h-full flex flex-col items-center justify-center gap-3 text-sm text-fleet-text px-6 text-center"
      >
        <ImageOff size={32} className="text-gray-500" />
        <span data-testid="image-error">{error}</span>
        {result.reason !== 'denied' && result.reason !== 'missing' && (
          <button
            className="rounded border border-fleet-border px-3 py-1 text-xs hover:text-fleet-textHover hover:bg-fleet-active"
            onClick={() => window.api.openInDefaultApp(path)}
          >
            Open in Default App
          </button>
        )}
      </div>
    )
  }

  return (
    <div data-testid="image-viewer" className="h-full">
      <ZoomableImage
        src={result.dataUrl!}
        alt={path.slice(path.lastIndexOf('/') + 1)}
        checkerboard
        extraInfo={result.size !== undefined ? formatBytes(result.size) : undefined}
        onError={() => setDecodeFailed(true)}
      />
    </div>
  )
}
