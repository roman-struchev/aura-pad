import { SquareCheckBig, Puzzle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { parseExtensionPath } from '../../../shared/extensionTab'

// Built-in extensions: modules that render inside an ordinary tab under a
// synthetic ext:// path. This is deliberately not a plugin system - no
// dynamic loading, no API surface - just one registry entry + one component
// per extension, all living in this repository. The tab *bodies* aren't
// registered here (they may need App-owned state), App wires them up by id;
// this registry covers everything path-derived: tab strip icon + label.
// (Git deliberately lives in the sidebar panel, not here - committing while
// seeing the code beats a full-window git view.)
interface ExtensionDescriptor {
  icon: LucideIcon
  // root is null for extensions not bound to a project (e.g. Google Tasks).
  title: (root: string | null) => string
}

export const EXTENSIONS: Record<string, ExtensionDescriptor> = {
  'google-tasks': {
    icon: SquareCheckBig,
    title: () => 'Google Tasks'
  }
}

// Tab-strip presentation for an ext:// path; null for ordinary file paths.
// Unknown extension ids (e.g. restored from a session of a newer version)
// still get a generic label rather than leaking the raw ext:// path.
export function extensionTabInfo(path: string): { icon: LucideIcon; label: string } | null {
  const parsed = parseExtensionPath(path)
  if (!parsed) return null
  const descriptor = EXTENSIONS[parsed.id]
  if (!descriptor) return { icon: Puzzle, label: parsed.id }
  return { icon: descriptor.icon, label: descriptor.title(parsed.root) }
}
