import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { LintMarker } from '../shared/lint'

// Parses the file with ast.parse instead of py_compile, so this never writes
// a __pycache__ directory into the user's project as a side effect.
const PYTHON_SYNTAX_CHECK = `
import ast, sys
p = sys.argv[1]
try:
    with open(p, 'r', encoding='utf-8') as f:
        src = f.read()
    ast.parse(src, filename=p)
except SyntaxError as e:
    print(f"{e.lineno or 1}:{e.offset or 1}:{e.msg}")
    sys.exit(1)
except Exception:
    sys.exit(0)
`

export function lintPython(absPath: string): Promise<LintMarker | null> {
  return new Promise((resolve) => {
    execFile('python3', ['-c', PYTHON_SYNTAX_CHECK, absPath], (error, stdout) => {
      if (!error) return resolve(null)
      const match = stdout.trim().match(/^(\d+):(\d+):(.*)$/)
      if (!match) return resolve(null)
      resolve({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        message: match[3],
        severity: 'error'
      })
    })
  })
}

// Only lints using the opened project's own local ESLint install (never
// Aura's own eslint.config.mjs) - if the project has none, skip silently
// rather than shelling out to `npx` (which can prompt an install/hit the
// network) or applying Aura's own React/Electron-flavored rules to an
// unrelated project.
export function lintEslint(absPath: string, workspaceRoot: string): Promise<LintMarker[]> {
  return new Promise((resolve) => {
    const binPath = path.join(
      workspaceRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
    )
    if (!fs.existsSync(binPath)) return resolve([])

    execFile(
      binPath,
      ['--format', 'json', '--no-color', absPath],
      { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
      (_error, stdout) => {
        try {
          const results = JSON.parse(stdout || '[]') as Array<{
            messages: Array<{
              line: number
              column: number
              endLine?: number
              endColumn?: number
              message: string
              severity: number
            }>
          }>
          const markers: LintMarker[] = []
          for (const result of results) {
            for (const m of result.messages) {
              markers.push({
                line: m.line,
                column: m.column,
                endLine: m.endLine,
                endColumn: m.endColumn,
                message: m.message,
                severity: m.severity === 2 ? 'error' : 'warning'
              })
            }
          }
          resolve(markers)
        } catch (e) {
          resolve([])
        }
      }
    )
  })
}
