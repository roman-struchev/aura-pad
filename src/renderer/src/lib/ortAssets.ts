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
// it alone. `import.meta.url` here is this module's own chunk URL; every worker
// chunk (and any shared chunk vite splits this into) lands in assets/, one
// level below ort-dist/, so `../ort-dist/` resolves the same no matter which
// worker imported it.
const ortDistDir = '../ort-dist/'

// Base URL of the ort-dist/ directory, trailing slash included.
export function ortWasmBase(): string {
  return import.meta.env.DEV
    ? `${self.location.origin}/ort-dist/`
    : new URL(ortDistDir, import.meta.url).href
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
