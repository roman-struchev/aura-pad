import React from 'react'

// Renders an .html tab's content in a sandboxed iframe, mirroring the
// Markdown preview toggle. `allow-scripts allow-same-origin` lets the page's
// own <script> tags run - including ones pulling a library off a CDN, or
// ones that write into a nested iframe of their own (var d =
// iframe.contentWindow.document; d.write(...) - without allow-same-origin,
// that nested iframe gets its own distinct opaque origin and the write
// throws "Blocked a frame with origin 'null' from accessing a cross-origin
// frame").
//
// allow-scripts + allow-same-origin together is a known sandbox-escape
// combo: previewed content can now reach window.parent with same-origin
// access to this app's own top-level DOM. Accepted deliberately - see
// index.html's CSP comment for the matching script-src tradeoff - since this
// previews files the user opens themselves, not arbitrary remote content.
//
// This srcDoc document inherits the app's own CSP (see index.html), which is
// deliberately loosened (script-src 'unsafe-inline' https:) to let previewed
// scripts actually run.
export const HtmlPreview: React.FC<{ content: string }> = ({ content }) => (
  <iframe
    sandbox="allow-scripts allow-same-origin"
    srcDoc={content}
    title="HTML Preview"
    className="w-full h-full border-0 bg-white"
  />
)
