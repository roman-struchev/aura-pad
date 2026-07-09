import { useEffect } from 'react'
import * as monaco from 'monaco-editor'
import type { FileNode } from '../../../shared/fileNode'

// TS/JS diagnostics are Monaco's own bundled worker - free once each file has
// a stable path-based model (see the Editor's `path` prop in App.tsx). Python
// (via ast.parse) and ESLint (via the opened project's own local install, if
// any) aren't live like that, so they're re-checked once a tab becomes active
// and again whenever a save completes.
export function useDiagnostics(
  diagnosticsEnabled: boolean,
  selectedPath: string | null,
  isSaved: boolean,
  rootNodes: FileNode[]
): void {
  useEffect(() => {
    const diagnosticsOptions = {
      noSyntaxValidation: !diagnosticsEnabled,
      noSemanticValidation: !diagnosticsEnabled
    }
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
    monaco.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
  }, [diagnosticsEnabled])

  useEffect(() => {
    if (!diagnosticsEnabled || !selectedPath || !isSaved) return
    const path = selectedPath
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
  }, [diagnosticsEnabled, selectedPath, isSaved, rootNodes])
}
