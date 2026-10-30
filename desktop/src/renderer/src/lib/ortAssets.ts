// Shared onnxruntime-web asset resolution for the three model workers
// (whisper + translate via transformers.js, piper via piper-tts-web).
//
// transformers.js/piper default to pulling ort's wasm runtime from a CDN at
// load time; this points them at the copies the ort-assets vite plugin (see
// electron.vite.config.ts) ships with the app, so the features work offline
// and within the app's CSP. The plugin serves them on the dev server and, in
// production, copies them into out/renderer/ort-dist/.
//
// The relative path lives in a variable so vite's build-time new URL() asset
// analysis - which would fail, since the path only exists at runtime - leaves
// it alone.
//
// Anchored on `self.location` (the running worker script's own URL), NOT on
// `import.meta.url`. import.meta.url is the URL of whatever *chunk* this code
// ends up in, which - now that this module is shared - depends on vite's
// chunking (inline vs. a separate shared chunk, possibly at another depth),
// so `../ort-dist/` off it could silently break in a packaged build after a
// bundler change. self.location is always the worker entry in assets/,
// regardless of how the module is chunked, so `../ort-dist/` off it is stable.
// The one remaining assumption - workers are emitted into assets/, one level
// below ort-dist/ - is controlled by the renderer build layout, not by
// chunk-splitting heuristics.
const ortDistDir = '../ort-dist/'

// Base URL of the ort-dist/ directory, trailing slash included.
export function ortWasmBase(): string {
  return import.meta.env.DEV
    ? `${self.location.origin}/ort-dist/`
    : new URL(ortDistDir, self.location.href).href
}

// The asyncify wasm runtime files transformers.js's ort initializes webgpu
// through (the whisper and translate workers point onnxruntime at these). It
// must be the asyncify build - the jsep build is its predecessor and lacks
// webgpuInit.
export function asyncifyWasmPaths(): { mjs: string; wasm: string } {
  const base = ortWasmBase()
  return {
    mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`
  }
}
