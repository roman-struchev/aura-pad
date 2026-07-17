import fs from 'fs'
import path from 'path'

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
  } catch (e) {
    console.warn(`Failed to save ${path.basename(filePath)}:`, e)
  }
}
