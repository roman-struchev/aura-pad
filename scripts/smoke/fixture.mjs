// The throwaway user-data dir + workspace every smoke run starts from.
//
// Nothing here touches the real profile: the app is launched with
// AURAPAD_USER_DATA_DIR pointed at this directory (honored by
// src/main/appIdentity.ts), and the workspace list is planted directly rather
// than going through the native folder picker.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapad-smoke-'))
  const profile = path.join(root, 'profile')
  const ws = path.join(root, 'workspace')
  fs.mkdirSync(profile)
  fs.mkdirSync(ws)

  // Plain text files: the everyday editing path.
  fs.writeFileSync(path.join(ws, 'notes.txt'), 'first line\nsecond line\n')
  fs.writeFileSync(path.join(ws, 'readme.md'), '# Title\n\nSome **bold** prose.\n')
  fs.writeFileSync(path.join(ws, 'data.json'), '{"b":2,"a":[1,2,3]}')
  fs.writeFileSync(path.join(ws, 'page.html'), '<h1>Hello</h1>\n')

  // Folders, for tree navigation and copy/paste targets.
  fs.mkdirSync(path.join(ws, 'src'))
  fs.writeFileSync(path.join(ws, 'src', 'main.ts'), 'export const answer = 42\n')
  fs.mkdirSync(path.join(ws, 'dest'))

  // Ignored content: must stay out of the tree and out of search results.
  fs.writeFileSync(path.join(ws, '.gitignore'), 'ignored-by-git/\n')
  fs.mkdirSync(path.join(ws, 'ignored-by-git'))
  fs.writeFileSync(path.join(ws, 'ignored-by-git', 'secret.txt'), 'needle-in-ignored\n')
  fs.mkdirSync(path.join(ws, 'node_modules'))
  fs.writeFileSync(path.join(ws, 'node_modules', 'dep.js'), 'needle-in-node-modules\n')

  // Request files for the HTTP client. Their port is fixed rather than
  // ephemeral because the files have to exist before the app launches (so the
  // tree lists them without waiting on a watcher round-trip) - the case binds
  // the same port and skips itself if something else already has it.
  const httpPort = Number(process.env.SMOKE_CDP_PORT || 9333) + 20
  fs.writeFileSync(
    path.join(ws, 'requests.http'),
    `@host = http://127.0.0.1:${httpPort}\n` +
      `\n### ping\n` +
      `GET {{host}}/ping\n` +
      `Accept: application/json\n` +
      `\n### echo\n` +
      `POST {{host}}/echo\n` +
      `Content-Type: application/json\n` +
      `\n{"hello":"world"}\n`
  )
  fs.writeFileSync(
    path.join(ws, 'snippet.sh'),
    `#!/bin/sh\n# runnable in place, with the cursor anywhere inside it\n` +
      `curl -X POST http://127.0.0.1:${httpPort}/echo \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  --data-raw '{"from":"curl"}'\n`
  )
  // The same format under its other conventional extension - VS Code's REST
  // Client uses .rest as readily as .http, and both must be treated alike.
  fs.writeFileSync(
    path.join(ws, 'requests.rest'),
    `### ping again\nGET http://127.0.0.1:${httpPort}/ping\n`
  )
  // One runnable command and one that needs a shell: the Run lens must offer
  // itself for the first and stay away from the second.
  fs.writeFileSync(
    path.join(ws, 'mixed-curl.sh'),
    `curl http://127.0.0.1:${httpPort}/ping\n` + `curl http://127.0.0.1:${httpPort}/ping | jq .\n`
  )
  // A command the client must refuse rather than half-honor (-o writes a file).
  fs.writeFileSync(
    path.join(ws, 'bad-curl.sh'),
    `curl -o out.txt http://127.0.0.1:${httpPort}/ping\n`
  )

  // Searchable needle in a real file.
  fs.writeFileSync(path.join(ws, 'haystack.txt'), 'nothing\nfindmeplease here\nnothing\n')

  // Non-UTF-8 and binary files for the encoding cases, written with the app's
  // own iconv-lite so the bytes match what it will read back.
  const iconv = require(path.join(process.cwd(), 'node_modules', 'iconv-lite'))
  fs.writeFileSync(
    path.join(ws, 'cp1251.txt'),
    iconv.encode('Привет мир\nвторая строка\n', 'windows-1251')
  )
  fs.writeFileSync(
    path.join(ws, 'utf16.txt'),
    iconv.encode('UTF16 Привет\n', 'utf-16le', { addBOM: true })
  )
  fs.writeFileSync(path.join(ws, 'binary.dat'), Buffer.from([1, 0, 2, 0, 3, 0, 4]))

  // A file outside every workspace, for "opened from outside" behavior.
  const outside = path.join(root, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'external.txt'), 'lives outside the workspace\n')

  // A git repo, so git status/branch surfaces have something real to show.
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: ws,
      stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
    })
  let gitReady = false
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'smoke@example.com')
    git('config', 'user.name', 'Smoke Test')
    git('add', '-A')
    git('commit', '-q', '-m', 'fixture')
    fs.appendFileSync(path.join(ws, 'notes.txt'), 'a change git can see\n')
    gitReady = true
  } catch {
    // git missing or refusing to run - the git cases skip themselves.
  }

  fs.writeFileSync(path.join(profile, 'workspaces.json'), JSON.stringify([ws]))

  return {
    root,
    profile,
    ws,
    outside,
    gitReady,
    httpPort,
    file: (...parts) => path.join(ws, ...parts),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}
