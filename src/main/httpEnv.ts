import fs from 'fs'
import path from 'path'
import { isAllowedPath } from './pathAccess'
import type { HttpEnvironments } from '../shared/http'

// Environments for `.http` files: the same file run against dev, stage or
// prod, and the secrets that go with each kept out of the repository.
//
// The format is JetBrains' HTTP Client one, unchanged, so files move between
// the two:
//
//   http-client.env.json           committed - hosts, ports, non-secrets
//   http-client.private.env.json   gitignored - tokens, passwords
//
//   { "dev":  { "host": "http://localhost:8080" },
//     "prod": { "host": "https://api.example.com" } }
//
// Both files hold the same environment names; the private one's values win
// where they overlap, which is how a committed `"token": ""` placeholder gets
// filled in locally.

const PUBLIC_FILE = 'http-client.env.json'
const PRIVATE_FILE = 'http-client.private.env.json'

// How far up from the request file to look. Env files sit next to the
// requests or at the project root; anything past that is somebody else's
// directory tree.
const MAX_LEVELS = 12

function readEnvFile(filePath: string): Record<string, Record<string, string>> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, Record<string, string>> = {}
    for (const [name, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) continue
      const flat: Record<string, string> = {}
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        // Numbers and booleans are ordinary in these files (ports, flags);
        // nested objects are not something {{name}} can stand in for.
        if (value === null || typeof value === 'object') continue
        flat[key] = String(value)
      }
      out[name] = flat
    }
    return out
  } catch {
    // A malformed env file means "no environments", not a broken editor: the
    // request still runs with whatever the file itself defines.
    return {}
  }
}

// The nearest directory at or above the request file that has either env
// file. Nearest wins outright rather than merging up the tree: two env files
// in one repository are two different projects' worth of settings, and
// silently blending them is worse than picking the closer one.
function environmentDir(filePath: string): string | null {
  let dir = path.dirname(path.resolve(filePath))
  for (let level = 0; level < MAX_LEVELS; level++) {
    // Never walks out of what the renderer is allowed to reach (BUGS §2).
    if (!isAllowedPath(dir)) return null
    if (fs.existsSync(path.join(dir, PUBLIC_FILE)) || fs.existsSync(path.join(dir, PRIVATE_FILE))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

export function readHttpEnvironments(filePath: string): HttpEnvironments {
  const dir = environmentDir(filePath)
  if (!dir) return { dir: null, names: [], variables: {}, hasPrivate: false }

  const publicEnvs = readEnvFile(path.join(dir, PUBLIC_FILE))
  const hasPrivate = fs.existsSync(path.join(dir, PRIVATE_FILE))
  const privateEnvs = hasPrivate ? readEnvFile(path.join(dir, PRIVATE_FILE)) : {}

  const variables: Record<string, Record<string, string>> = {}
  // The public file's order first (that's the one written to be read), then
  // any environment only the private file knows about.
  for (const name of [...Object.keys(publicEnvs), ...Object.keys(privateEnvs)]) {
    if (name in variables) continue
    variables[name] = { ...publicEnvs[name], ...privateEnvs[name] }
  }

  return { dir, names: Object.keys(variables), variables, hasPrivate }
}
