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
    file: (...parts) => path.join(ws, ...parts),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}
