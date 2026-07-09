import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface MarkdownPreviewProps {
  content: string
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [content])

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="markdown-body max-w-3xl mx-auto" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
