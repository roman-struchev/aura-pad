import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import type { FileNode } from '../../../shared/fileNode'

// TS/JS diagnostics are Monaco's own bundled worker - free once each file has
// a stable path-based model (see the Editor's `path` prop in App.tsx). Python
// (via ast.parse) and ESLint (via the opened project's own local install, if
// any) aren't live like that - and ESLint in particular is genuinely slow to
// spawn (over a second on a type-aware config, even for a single file), so
// they're only re-checked the first time a file is opened and again after a
// save actually completes - not on every plain tab switch back to a file
// that's already been checked and hasn't changed since.
export function useDiagnostics(
  selectedPath: string | null,
  isSaved: boolean,
  rootNodes: FileNode[]
): void {
  // Marks the active path as needing a re-check whenever it becomes unsaved,
  // so the next time it's saved (isSaved flips back to true) the check effect
  // below knows this is a fresh save rather than just switching back to an
  // already-clean tab.
  const needsCheckRef = useRef<Map<string, boolean>>(new Map())
  useEffect(() => {
    if (selectedPath && !isSaved) needsCheckRef.current.set(selectedPath, true)
  }, [selectedPath, isSaved])

  useEffect(() => {
    if (!selectedPath || !isSaved) return
    const path = selectedPath
    // Defaults to true (needs a check) the first time a path is ever seen.
    if (needsCheckRef.current.get(path) === false) return
    needsCheckRef.current.set(path, false)

    const model = monaco.editor.getModel(monaco.Uri.parse(path))
    if (!model) return

    const run = async (): Promise<void> => {
      if (path.endsWith('.py')) {
        const marker = await window.api.lintPython(path)
        monaco.editor.setModelMarkers(
          model,
          'aura-python',
          marker
            ? [
                {
                  severity: monaco.MarkerSeverity.Error,
                  startLineNumber: marker.line,
                  startColumn: marker.column,
                  endLineNumber: marker.line,
                  endColumn: marker.column + 1,
                  message: marker.message
                }
              ]
            : []
        )
      } else if (/\.(ts|tsx|js|jsx)$/.test(path)) {
        const root = rootNodes.find((r) => path.startsWith(r.path + '/'))
        if (!root) return
        const markers = await window.api.lintEslint(path, root.path)
        monaco.editor.setModelMarkers(
          model,
          'aura-eslint',
          markers.map((m) => ({
            severity:
              m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            startLineNumber: m.line,
            startColumn: m.column,
            endLineNumber: m.endLine || m.line,
            endColumn: m.endColumn || m.column + 1,
            message: m.message
          }))
        )
      }
    }
    run()
  }, [selectedPath, isSaved, rootNodes])
}
