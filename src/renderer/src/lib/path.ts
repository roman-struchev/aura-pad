export function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf('/'))
}
