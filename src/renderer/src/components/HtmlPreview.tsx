import React from 'react'

// Renders an .html tab's content in a fully sandboxed iframe (no scripts, no
// same-origin access), mirroring the Markdown preview toggle. srcDoc inherits
// the app's CSP, so inline styles work but remote resources (external images,
// stylesheets, fonts) stay blocked - it's a markup preview, not a browser.
export const HtmlPreview: React.FC<{ content: string }> = ({ content }) => (
  <iframe
    sandbox=""
    srcDoc={content}
    title="HTML Preview"
    className="w-full h-full border-0 bg-white"
  />
)
