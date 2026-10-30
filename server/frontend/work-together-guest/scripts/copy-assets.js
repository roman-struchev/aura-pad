#!/usr/bin/env node
/**
 * Copies build outputs to the exact locations the Java backend expects:
 *
 *   dist/app.js                          -> src/main/resources/static/work-together/app.js
 *   src/app.css                          -> src/main/resources/static/work-together/app.css
 *   node_modules/monaco-editor/min/vs/*  -> src/main/resources/static/work-together/vs/
 *   src/guest-template.html              -> src/main/resources/templates/worktogether/guest-template.html
 *
 * This script only touches files under those four destinations (plus
 * creating the parent directories if missing) - it never touches Java
 * source or build.gradle.
 */

const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
// aura-server repo root is two levels up from frontend/work-together-guest
const repoRoot = path.resolve(projectRoot, '..', '..')

const staticDir = path.join(repoRoot, 'src', 'main', 'resources', 'static', 'work-together')
const resourcesDir = path.join(repoRoot, 'src', 'main', 'resources', 'templates', 'worktogether')

function rmrf (dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function copyFile (src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log('copied', path.relative(repoRoot, src), '->', path.relative(repoRoot, dest))
}

function copyDir (src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

fs.mkdirSync(staticDir, { recursive: true })
fs.mkdirSync(resourcesDir, { recursive: true })

// 1. bundled app.js (already built by `npm run bundle` into dist/app.js)
copyFile(
  path.join(projectRoot, 'dist', 'app.js'),
  path.join(staticDir, 'app.js')
)

// 2. app.css
copyFile(
  path.join(projectRoot, 'src', 'app.css'),
  path.join(staticDir, 'app.css')
)

// 3. monaco AMD assets (min/vs) - replace wholesale so stale files don't linger
const vsSrc = path.join(projectRoot, 'node_modules', 'monaco-editor', 'min', 'vs')
const vsDest = path.join(staticDir, 'vs')
rmrf(vsDest)
copyDir(vsSrc, vsDest)
console.log('copied', path.relative(repoRoot, vsSrc), '->', path.relative(repoRoot, vsDest), '(directory)')

// 4. HTML template (server-side placeholder substitution happens in Java)
copyFile(
  path.join(projectRoot, 'src', 'guest-template.html'),
  path.join(resourcesDir, 'guest-template.html')
)

console.log('\nAll assets copied successfully.')
