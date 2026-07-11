import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const ORT_DIST = resolve('node_modules/onnxruntime-web/dist')
// The wasm runtimes the app's workers point onnxruntime at: the dictation
// worker (whisperWorker.ts) needs the asyncify build - what transformers.js's
// bundled ort initializes webgpu through - while the read-aloud worker
// (piperWorker.ts) imports plain onnxruntime-web, whose 1.26 entry loads the
// jsep build.
const ORT_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm'
]
// espeak-based phonemizer used by the Piper voices (read aloud).
const PIPER_DIST = resolve('node_modules/@diffusionstudio/piper-wasm/build')
const PIPER_FILES = ['piper_phonemize.wasm', 'piper_phonemize.data']

// Exposes onnxruntime's wasm runtime under a stable /ort-dist/ path: served
// from node_modules in dev, copied into the renderer output in build. A plain
// `?url` import can't do this - vite's dev dependency optimizer chokes on
// ?url imports of .mjs files out of node_modules, killing the worker at
// startup ("optimized info should be defined").
function ortAssets(): Plugin {
  return {
    name: 'ort-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const serve = (dir: string, file: string): void => {
          res.setHeader(
            'Content-Type',
            file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : 'application/wasm'
          )
          res.end(readFileSync(join(dir, file)))
        }
        const ortFile = ORT_FILES.find((f) => req.url === `/ort-dist/${f}`)
        if (ortFile) return serve(ORT_DIST, ortFile)
        const piperFile = PIPER_FILES.find((f) => req.url === `/piper-dist/${f}`)
        if (piperFile) return serve(PIPER_DIST, piperFile)
        next()
      })
    },
    generateBundle(_options, bundle) {
      for (const file of ORT_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `ort-dist/${file}`,
          source: readFileSync(join(ORT_DIST, file))
        })
      }
      for (const file of PIPER_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `piper-dist/${file}`,
          source: readFileSync(join(PIPER_DIST, file))
        })
      }
      // transformers.js's bundle carries its own new URL() reference to the
      // same wasm binary, which makes vite emit a second, hashed copy under
      // assets/. The runtime never fetches it (wasmPaths always points at
      // ort-dist/), so drop the ~23MB duplicate from the output.
      for (const key of Object.keys(bundle)) {
        if (/^assets\/ort-wasm-.*\.wasm$/.test(key)) delete bundle[key]
      }
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // The dictation worker (whisperWorker.ts) needs ES output: transformers.js
    // dynamically import()s onnxruntime's wasm loader at runtime, which vite's
    // default iife worker format can't represent.
    worker: {
      format: 'es'
    },
    // transformers.js is only ever imported inside the dictation worker, so
    // vite's dev server doesn't discover it until the first mic press - which
    // triggers a mid-session re-optimization that kills the just-started
    // worker. Pre-bundling it up front avoids that.
    optimizeDeps: {
      include: ['@huggingface/transformers']
    },
    plugins: [react(), ortAssets()]
  }
})
