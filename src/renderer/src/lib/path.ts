export function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf('/'))
}

export function isUnderAnyRoot(filePath: string, rootPaths: string[]): boolean {
  return rootPaths.some((root) => filePath === root || filePath.startsWith(root + '/'))
}
