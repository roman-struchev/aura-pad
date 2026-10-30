import fs from 'fs'
import path from 'path'

// Parsed-config cache. The main process is the only writer of these files
// (single instance lock), so a cached parse stays valid until our own
// writeConfigFile() below replaces it - no invalidation beyond that is
// needed. This matters because several loaders are called from hot paths
// (every fs.watch event, every git IPC call); without the cache each of
// those was a fresh readFileSync + JSON.parse.
//
// Callers get the cached value by reference and must not mutate it - the
// exported loaders each return their own copy.
const configCache = new Map<string, unknown>()

// The shared existsSync -> readFileSync -> JSON.parse -> warn-and-fallback
// dance every config loader used to hand-roll. `fallback` is a factory so a
// missing/corrupt file yields a fresh default each time, never a shared
// mutable singleton.
export function readConfigFile<T>(filePath: string, fallback: () => T): T {
  if (configCache.has(filePath)) return configCache.get(filePath) as T
  let value: T
  try {
    value = fs.existsSync(filePath)
      ? (JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T)
      : fallback()
  } catch (e) {
    console.warn(`Failed to load ${path.basename(filePath)}:`, e)
    value = fallback()
  }
  configCache.set(filePath, value)
  return value
}

// Same temp-file + rename dance as writeFileContent() in workspaces.ts, for
// the app's own config JSONs: a crash or power loss mid-write must leave the
// previous config intact, not a truncated file the loaders would silently
// reset to defaults (losing the workspace list / open tabs / settings).
export function writeConfigFile(filePath: string, data: unknown): void {
  try {
    const tmpPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.tmp`
    )
    fs.writeFileSync(tmpPath, JSON.stringify(data))
    try {
      fs.renameSync(tmpPath, filePath)
    } catch (e) {
      fs.rmSync(tmpPath, { force: true })
      throw e
    }
    // Only reflect the write in the cache once it actually reached disk - on
    // failure the file still holds the old content, and so must the cache.
    configCache.set(filePath, data)
  } catch (e) {
    console.warn(`Failed to save ${path.basename(filePath)}:`, e)
  }
}
