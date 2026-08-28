import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { loadWorkspaces } from './workspaces'
import { loadRecentExternalFiles } from './recentExternalFiles'

// Which paths main will act on for the renderer (docs/BUGS.md §2).
//
// Every filesystem and pty handler used to take whatever absolute path it was
// handed, so anything that could run script in the renderer - a preview
// escape, a compromised dependency in the bundle - could read, overwrite or
// trash any file on the machine and spawn a login shell anywhere. The renderer
// is still trusted with the *contents* of what the user opened; it is no
// longer trusted to name arbitrary paths.
//
// Allowed is: an open workspace, the app's own userData, and paths main itself
// handed out or was handed by the OS - a file dropped on the window, a file the
// OS asked us to open, an entry listed by Quick Open's path mode, or one still
// in the recent-external list from an earlier session. Everything resolves
// through realpath first, so a symlink pointing out of a workspace does not
// get in on its parent's name.
//
// The deliberate limit: Quick Open's path mode is how a file outside every
// workspace gets opened at all (see README), and its listings grant the paths
// they return. Injected script could walk directories the same way rather than
// naming a path outright - that costs it a round trip per directory instead of
// being free, and it is the price of the feature. What it can no longer do is
// touch a path nobody ever listed.

export const PATH_DENIED =
  'That path is outside the open workspaces and the files you opened yourself.'

// Session-scoped: cleared with the process, so a grant never outlives the
// window that earned it. The recent-external list is the only part that
// persists, and it is capped and time-limited by its own retention policy.
const grants = new Set<string>()

// Resolves symlinks so two names for the same file can't disagree about
// whether they are allowed. A path that doesn't exist yet - the target of a
// create, a rename, or a save into a folder that is about to be made along
// with it - resolves through its nearest existing ancestor instead, with the
// missing tail appended.
//
// Walking up rather than looking only at the parent is what lets "api/
// orders.http" be checked before either the file or its folder exists. It
// gives nothing away: `resolve` above has already collapsed every `..`, so
// the tail can only go deeper, and every symlink in the part that does exist
// is still followed before the decision is made.
function realPath(target: string): string | null {
  if (typeof target !== 'string' || target.length === 0) return null
  const absolute = path.resolve(target)
  try {
    return fs.realpathSync(absolute)
  } catch {
    // Not there (yet).
  }
  const tail: string[] = []
  let dir = absolute
  while (true) {
    const parent = path.dirname(dir)
    if (parent === dir) return null
    tail.unshift(path.basename(dir))
    dir = parent
    try {
      return path.join(fs.realpathSync(dir), ...tail)
    } catch {
      // Keep walking up.
    }
  }
}

function contains(root: string, candidate: string): boolean {
  return (
    candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
  )
}

// Recomputed per call rather than cached: workspaces are added and removed
// while the app runs, and a stale root list would either reject a folder the
// user just opened or keep honoring one they just removed.
function allowedRoots(): string[] {
  const roots = [...loadWorkspaces(), app.getPath('userData')]
  return roots.map((root) => realPath(root)).filter((root): root is string => root !== null)
}

// Paths main has handed out. Kept as a function (not a snapshot) for the same
// reason as allowedRoots: the recent list changes underneath.
function grantedPaths(): string[] {
  const persisted = loadRecentExternalFiles().map((entry) => realPath(entry.path))
  return [...grants, ...persisted].filter((entry): entry is string => entry !== null)
}

// Opens a path up for this session. Only main calls this: the OS handing us a
// file to open, a native dialog's result, a drop on the window (routed through
// preload, which the page cannot reach), or a directory listing main itself
// produced.
export function grantPath(target: string): void {
  const resolved = realPath(target)
  if (resolved) grants.add(resolved)
}

export function grantPaths(targets: string[]): void {
  for (const target of targets) grantPath(target)
}

export function isAllowedPath(target: string): boolean {
  const resolved = realPath(target)
  if (!resolved) return false
  if (allowedRoots().some((root) => contains(root, resolved))) return true
  // A granted directory covers what's under it (Quick Open listing a folder,
  // then opening a file from it); a granted file covers only itself.
  return grantedPaths().some((granted) => contains(granted, resolved))
}

// The one-line guard every handler uses: null when all the paths are fine,
// otherwise the message to hand back as `error`. Undefined entries pass - an
// optional argument that wasn't given (create-pty's cwd) is not a violation.
export function pathDenial(...targets: (string | undefined | null)[]): string | null {
  for (const target of targets) {
    if (target === undefined || target === null) continue
    if (!isAllowedPath(target)) return PATH_DENIED
  }
  return null
}

// Repo-relative arguments (git stage/diff/discard) must stay inside the repo
// they name: `../../../etc/passwd` under a legitimate root would otherwise
// walk straight back out of it.
export function relativeDenial(root: string, relPaths: string[]): string | null {
  const rootDenial = pathDenial(root)
  if (rootDenial) return rootDenial
  const base = path.resolve(root)
  for (const relPath of relPaths) {
    const resolved = path.resolve(base, relPath)
    if (!contains(base, resolved)) return PATH_DENIED
  }
  return null
}
