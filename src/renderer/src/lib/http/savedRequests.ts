import { buildRequest, parseHttpFile, type HttpBlock } from './httpFile'
import { dirname } from '../path'
import type { FileNode } from '../../../../shared/fileNode'
import type { HttpRequestSpec } from '../../../../shared/http'

// The requests a project has already written down: every `###` block in every
// .http/.rest file the workspace tree shows. The files are the storage - this
// is only the index the HTTP Client tab needs to list them and put one back
// into the form.

export interface SavedRequest {
  // Stable across reloads, and unique: one file can hold two blocks with the
  // same name.
  id: string
  file: string
  name: string
  // 1-based, for the jump when the block is opened in its file.
  line: number
  // What the row shows and the search matches on, without having to rebuild
  // the spec for every keystroke.
  method: string
  url: string
  // Null when the block can't be turned into a request (a curl with a flag
  // this client refuses, a `< body.json` that isn't there); `error` says why,
  // and the row still lists it rather than hiding a request that exists.
  spec: HttpRequestSpec | null
  error?: string
}

const REQUEST_FILE = /\.(http|rest)$/i
// A tree with thousands of request files is not a workspace anyone is working
// in; reading them all on a panel switch would be.
const MAX_FILES = 200
const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g

export function requestFilesIn(nodes: FileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'file' && REQUEST_FILE.test(node.name)) out.push(node.path)
    if (node.children) requestFilesIn(node.children, out)
  }
  return out
}

// A file's own `@variables` are part of the request and get substituted the
// way running it would. A `{{token}}` that only an environment defines is
// not: left as itself, it survives into the form, where the tab's own
// environment fills it in at send time - which is exactly what a request
// saved against one environment and re-run against another needs.
function keepUnknownPlaceholders(block: HttpBlock): HttpBlock {
  const variables = { ...block.variables }
  for (const line of block.lines) {
    for (const match of line.matchAll(PLACEHOLDER)) {
      const name = match[1].trim()
      // `{{$uuid}}` and friends are generated, not looked up.
      if (name.startsWith('$') || name in variables) continue
      variables[name] = `{{${name}}}`
    }
  }
  return { ...block, variables }
}

function methodAndUrl(spec: HttpRequestSpec | null, block: HttpBlock): [string, string] {
  if (spec) return [spec.method, spec.url]
  const first = block.lines.find((l) => l.trim() !== '' && !/^\s*(#|\/\/)/.test(l)) ?? ''
  const [, method = '', url = ''] = /^\s*(\w+)?\s*(.*)$/.exec(first.trim()) ?? []
  return [method.toUpperCase(), url]
}

export async function loadSavedRequests(
  rootNodes: FileNode[],
  readFile: (path: string) => Promise<{ success: boolean; content?: string }>
): Promise<SavedRequest[]> {
  const files = requestFilesIn(rootNodes).slice(0, MAX_FILES)
  const perFile = await Promise.all(
    files.map(async (file) => {
      const read = await readFile(file)
      if (!read.success || read.content === undefined) return []
      const cwd = dirname(file)
      return parseHttpFile(read.content).map((block) => {
        const built = buildRequest(keepUnknownPlaceholders(block), cwd)
        const spec = built.ok ? built.spec : null
        const [method, url] = methodAndUrl(spec, block)
        return {
          id: `${file}:${block.startLine}`,
          file,
          name: block.name,
          line: block.requestLine + 1,
          method,
          url,
          spec,
          error: built.ok ? undefined : built.error
        }
      })
    })
  )
  return perFile.flat()
}
