import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ZoomableImage } from './ZoomableImage'
import { renderPlantUml, type PlantUmlResult } from '../lib/plantuml'

// A .puml tab's preview: the buffer (unsaved edits included) rendered by the
// bundled PlantUML engine (see lib/plantuml.ts). Only the newest render's
// result is ever shown - a slow one for older text that finishes last is
// dropped.

const DEBOUNCE_MS = 250

const ErrorText: React.FC<{ message: string }> = ({ message }) => (
  <pre
    data-testid="plantuml-error"
    className="shrink-0 whitespace-pre-wrap px-3 py-1.5 font-mono text-xs text-accent-error"
  >
    {message}
  </pre>
)

interface PlantUmlPreviewProps {
  content: string
  documentPath: string
  dark: boolean
}

export const PlantUmlPreview: React.FC<PlantUmlPreviewProps> = ({
  content,
  documentPath,
  dark
}) => {
  // Tagged with the input it was rendered from: the preview is "rendering"
  // exactly while that differs from the current input.
  const input = `${dark}\0${documentPath}\0${content}`
  const [shown, setShown] = useState<{ input: string; result: PlantUmlResult } | null>(null)
  const result = shown?.result ?? null
  const rendering = shown?.input !== input
  const latest = useRef(0)
  const hasResult = shown !== null

  useEffect(() => {
    const id = ++latest.current
    // The first render goes out at once; only follow-ups are debounced.
    const timer = window.setTimeout(
      () => {
        renderPlantUml(content, { dark, documentPath }).then((r) => {
          if (id === latest.current) setShown({ input, result: r })
        })
      },
      hasResult ? DEBOUNCE_MS : 0
    )
    return () => window.clearTimeout(timer)
    // `hasResult` only picks the delay; it must not trigger a render itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  return (
    <div className="relative h-full" data-testid="plantuml-preview">
      {result && 'svg' in result ? (
        <div className="h-full flex flex-col">
          {result.error && <ErrorText message={result.error} />}
          <div className="flex-1 min-h-0">
            <ZoomableImage
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`}
              alt="PlantUML diagram"
            />
          </div>
        </div>
      ) : result ? (
        <div className="h-full overflow-auto p-6">
          <div className="text-xs text-fleet-text mb-2">This diagram could not be rendered:</div>
          <ErrorText message={result.error} />
        </div>
      ) : null}
      {rendering && (
        <div
          data-testid="plantuml-rendering"
          className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-fleet-header/80 px-2 py-0.5 text-[11px] text-fleet-text backdrop-blur-sm"
        >
          <Loader2 size={12} className="animate-spin" />
          Rendering…
        </div>
      )}
    </div>
  )
}
