// Extension tabs live in the ordinary open-tabs list under a synthetic
// `ext://<id>/<root>` path (or just `ext://<id>` for extensions not bound to
// a project). Deriving everything from the path - rather than a separate
// field - matters because tab persistence stores only paths.
export const EXTENSION_PATH_PREFIX = 'ext://'

export function isExtensionPath(path: string): boolean {
  return path.startsWith(EXTENSION_PATH_PREFIX)
}

export function makeExtensionPath(extensionId: string, root?: string): string {
  return root
    ? `${EXTENSION_PATH_PREFIX}${extensionId}/${root}`
    : `${EXTENSION_PATH_PREFIX}${extensionId}`
}

// `ext://git//Users/x/repo` → { id: 'git', root: '/Users/x/repo' };
// `ext://google-tasks` → { id: 'google-tasks', root: null }.
export function parseExtensionPath(path: string): { id: string; root: string | null } | null {
  if (!isExtensionPath(path)) return null
  const rest = path.slice(EXTENSION_PATH_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return { id: rest, root: null }
  return { id: rest.slice(0, slash), root: rest.slice(slash + 1) }
}
