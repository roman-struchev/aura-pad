import React, { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface MarkdownPreviewProps {
  content: string
  // The file being previewed: relative image links are resolved against its
  // folder, which is where a pasted image lands (see src/main/pastedImages.ts).
  documentPath?: string | null
}

// A link the preview has to fetch itself. Anything with a scheme (or rooted at
// the server) is left to the page: http(s) images load under the CSP, data:
// ones are already inline, and file: is deliberately not an allowed source.
function isLocalRelative(src: string): boolean {
  return !!src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(src)
}

function resolveAgainst(documentPath: string, src: string): string {
  const dir = documentPath.slice(0, documentPath.lastIndexOf('/'))
  const parts = `${dir}/${decodeURIComponent(src.split(/[?#]/)[0])}`.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return `/${stack.join('/')}`
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, documentPath }) => {
  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [content])

  // Local images, keyed by the src as written in the document. main reads them
  // (and refuses anything outside the allowed folders), so the preview gets
  // data: URLs rather than a CSP loosened to file:.
  const [inlined, setInlined] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!documentPath) return
    let cancelled = false
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const wanted = [...doc.querySelectorAll('img')]
      .map((img) => img.getAttribute('src') ?? '')
      .filter(isLocalRelative)
    ;(async () => {
      const found: Record<string, string> = {}
      for (const src of new Set(wanted)) {
        const result = await window.api.readImageDataUrl(resolveAgainst(documentPath, src))
        if (result.success && result.dataUrl) found[src] = result.dataUrl
      }
      // Replaced wholesale rather than merged: a document that no longer
      // references an image shouldn't keep its bytes alive in state.
      if (!cancelled) setInlined(found)
    })()
    return () => {
      cancelled = true
    }
  }, [html, documentPath])

  const rendered = useMemo(() => {
    if (Object.keys(inlined).length === 0) return html
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? ''
      const dataUrl = inlined[src]
      if (dataUrl) img.setAttribute('src', dataUrl)
    }
    return doc.body.innerHTML
  }, [html, inlined])

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div
        className="markdown-body max-w-3xl mx-auto"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  )
}
