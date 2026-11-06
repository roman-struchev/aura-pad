// PlantUML, rendered on this machine: @plantuml/core is the PlantUML engine
// compiled to JavaScript (TeaVM), with Graphviz as wasm - no Java, no server,
// nothing about the diagram leaves the app.
//
// It builds its SVG through `document` and measures text on a canvas, so it
// needs a DOM and can't go into a Web Worker; it runs on the renderer thread,
// asynchronously and one render at a time. Nothing here is loaded until the
// first diagram preview: the engine is a few MB of script.

import { dirname } from './path'

type RenderToString = (
  lines: string[],
  onSuccess: (svg: string) => void,
  onError: (message: string) => void,
  options?: { dark?: boolean; maxSvgSize?: number }
) => void

type Loader = (
  path: string,
  from: string | null,
  ok: (id: string, text: string) => void,
  err: (message: string) => void
) => void | false

interface PlantUmlGlobals {
  PLANTUML_VIZ?: unknown
  PLANTUML_STDLIB_LOADER?: (url: string, ok: () => void, err: (message: string) => void) => void
  PLANTUML_FILE_LOADER?: Loader
}

// A diagram PlantUML couldn't make sense of still comes back as an SVG: its
// classic error picture (the offending line underlined, the message in red).
// That picture is kept, and `error` carries the message for a banner above it.
export type PlantUmlResult = { svg: string; error?: string } | { error: string }

// The error picture is recognisable by its "[From … (line N) ]" caption; the
// message is the text drawn in red.
function errorOfSvg(svg: string): string | undefined {
  const where = /\[From [^\]]*\(line (\d+)\)\s*\]/.exec(svg)
  if (!where) return undefined
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const message = [...doc.querySelectorAll('text')]
    .filter((t) => /^#?f{2}0{4}$/i.test(t.getAttribute('fill') ?? ''))
    .map((t) => (t.textContent ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return `Line ${where[1]}: ${message || 'syntax error'}`
}

// Runs a classic (non-module) script's source in the page's global scope -
// how the engine's two UMD/IIFE side files expect to be loaded. Bundling them
// as modules would hand `Viz` to the bundle's exports instead of globalThis.
// The CSP allows this ('unsafe-eval'; see index.html).
function runClassicScript(source: string): void {
  new Function(source).call(globalThis)
}

// The document a render is for: top-level relative includes resolve against
// its folder. Safe as module state because renders are serialised below.
let currentDocumentPath: string | null = null

function resolveInclude(path: string, from: string | null): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('<')) return null
  const isAbsolute = path.startsWith('/') || /^[a-z]:[\\/]/i.test(path)
  // `from` is the id handed back for the including file - its path, so its
  // folder is the base; a top-level include resolves next to the document.
  const base =
    from !== null ? dirname(from) : currentDocumentPath ? dirname(currentDocumentPath) : null
  if (!isAbsolute && !base) return null
  const parts = (isAbsolute ? path : `${base}/${path}`).replace(/\\/g, '/').split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  // Keep a Windows drive letter as the root rather than prefixing a '/'.
  return /^[a-z]:$/i.test(stack[0] ?? '') ? stack.join('/') : `/${stack.join('/')}`
}

const fileLoader: Loader = (path, from, ok, err) => {
  const resolved = resolveInclude(path, from)
  if (!resolved) {
    err(`Cannot include ${path}: only local files are available.`)
    return
  }
  // readFile goes through main's path allowlist and binary/size checks, the
  // same as opening the file in a tab would.
  window.api.readFile(resolved).then(
    (result) => {
      if (result.success) ok(resolved, result.content ?? '')
      else err(`Cannot include ${path}: ${result.error ?? 'not readable'}`)
    },
    () => err(`Cannot include ${path}`)
  )
}

let enginePromise: Promise<RenderToString> | null = null

export function loadPlantUmlEngine(): Promise<RenderToString> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [viz, themes, engine] = await Promise.all([
        import('@plantuml/core/viz-global.js?raw'),
        import('@plantuml/core/themes.js?raw'),
        import('@plantuml/core')
      ])
      const g = globalThis as typeof globalThis & PlantUmlGlobals & { Viz?: unknown }
      runClassicScript(viz.default)
      runClassicScript(themes.default)
      g.PLANTUML_VIZ = g.Viz
      // The standard library (C4, AWS…), emoji and icon sprites would be
      // fetched from next to the page or a URL: decline them up front so a
      // diagram that uses one fails at once with a message, and nothing is
      // requested.
      g.PLANTUML_STDLIB_LOADER = (url, _ok, err) =>
        err(`${url.replace(/\.min\.js$/, '')} is not available offline.`)
      g.PLANTUML_FILE_LOADER = fileLoader
      return engine.renderToString as RenderToString
    })()
    // A failed load (it shouldn't, it's bundled) must not stick forever.
    enginePromise.catch(() => {
      enginePromise = null
    })
  }
  return enginePromise
}

// A diagram typed without its @startuml/@enduml pair renders as if it had
// them - PlantUML itself would otherwise report "no diagram found".
function withStartEnd(text: string): string[] {
  const lines = text.split(/\r?\n/)
  return lines.some((l) => /^\s*@start/.test(l)) ? lines : ['@startuml', ...lines, '@enduml']
}

// The engine's own default (8192 px) refuses ordinary large class diagrams.
const MAX_SVG_SIZE = 16384

let queue: Promise<unknown> = Promise.resolve()

export function renderPlantUml(
  text: string,
  options: { dark: boolean; documentPath: string | null }
): Promise<PlantUmlResult> {
  const run = async (): Promise<PlantUmlResult> => {
    let renderToString: RenderToString
    try {
      renderToString = await loadPlantUmlEngine()
    } catch (e) {
      return { error: `The PlantUML engine could not be loaded: ${String(e)}` }
    }
    currentDocumentPath = options.documentPath
    return new Promise<PlantUmlResult>((resolve) => {
      try {
        renderToString(
          withStartEnd(text),
          (svg) => resolve({ svg, error: errorOfSvg(svg) }),
          (message) => resolve({ error: message || 'The diagram could not be rendered.' }),
          { dark: options.dark, maxSvgSize: MAX_SVG_SIZE }
        )
      } catch (e) {
        resolve({ error: String(e) })
      }
    })
  }
  const result = queue.then(run, run)
  queue = result
  return result
}
