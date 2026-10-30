import * as monaco from 'monaco-editor'

// The one place a file path becomes a Monaco model URI. Every lookup
// (getModel, dispose, the <Editor path> prop) has to agree on it, or a tab
// ends up talking to somebody else's model.
//
// `Uri.file`, not `Uri.parse`: parse reads the path as an already-encoded
// URI, so "a%20b.md" and "a b.md" both became file:///…/a%20b.md - one
// model for two files, and the second file's tab showed (and autosaved) the
// first one's text. It also misreads a Windows "C:\…" path as a URI with a
// "c:" scheme. `file` escapes the path instead, so each path gets its own URI.
export function modelUri(path: string): monaco.Uri {
  return monaco.Uri.file(path)
}

// For @monaco-editor/react's `path` prop, which runs its value through
// `Uri.parse` itself: the string form of modelUri parses back to exactly it.
export function modelPath(path: string): string {
  return modelUri(path).toString()
}
