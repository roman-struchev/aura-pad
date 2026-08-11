// Central file-type predicates. These extension checks were previously
// re-derived inline across App.tsx, AppHeader.tsx, useDiagnostics.ts and
// elsewhere; keeping them here means one place to change when a language or
// preview type is added. Each predicate keeps the exact behavior its inline
// origin had.

export const isHtmlPath = (path: string | null): boolean =>
  !!path && (path.endsWith('.html') || path.endsWith('.htm'))

// Files with a rendered preview mode (the toolbar's Show Preview toggle and
// the tree's hover eye icon): Markdown, plus raw HTML in a sandboxed iframe.
export const isPreviewablePath = (path: string | null): boolean =>
  !!path && (path.endsWith('.md') || isHtmlPath(path))

export const isMarkdownPath = (path: string | null): boolean => !!path && path.endsWith('.md')

// Voice features target prose, not code: dictation inserts into (and the
// read-aloud button reads from) Markdown and plain-text files only.
export const isProsePath = (path: string | null): boolean =>
  !!path && (path.endsWith('.md') || path.endsWith('.markdown') || path.endsWith('.txt'))

export const isPythonPath = (path: string | null): boolean => !!path && path.endsWith('.py')

// Request collections for the HTTP client: the `.http`/`.rest` convention
// JetBrains' HTTP Client and VS Code's REST Client share.
export const isHttpPath = (path: string | null): boolean =>
  !!path && (path.endsWith('.http') || path.endsWith('.rest'))

// Documents the "Format Document" action can pretty-print: JSON (via
// JSON.parse/stringify) and markup (HTML/XML via prettyPrintMarkup).
export const isFormattablePath = (path: string | null): boolean =>
  !!path && /\.(json|html|htm|xml)$/.test(path.toLowerCase())

// Files eligible for ESLint diagnostics (Monaco handles TS/JS type-checking
// itself; this is for the project's own ESLint pass).
export const isEslintablePath = (path: string | null): boolean =>
  !!path && /\.(ts|tsx|js|jsx)$/.test(path)
