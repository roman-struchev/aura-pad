export function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf('/'))
}

export function isUnderAnyRoot(filePath: string, rootPaths: string[]): boolean {
  return rootPaths.some((root) => filePath === root || filePath.startsWith(root + '/'))
}

// The path as it reads inside its project: `src/main/index.ts` rather than
// `/Users/me/work/app/src/main/index.ts`. The longest matching root wins, so
// a workspace opened inside another workspace still gives the nearer of the
// two. Outside every root there is nothing to be relative to, so the absolute
// path is the honest answer.
export function relativeToRoot(filePath: string, rootPaths: string[]): string {
  const root = rootPaths
    .filter((r) => filePath === r || filePath.startsWith(r + '/'))
    .sort((a, b) => b.length - a.length)[0]
  if (!root) return filePath
  return filePath === root
    ? (filePath.split('/').pop() ?? filePath)
    : filePath.slice(root.length + 1)
}
