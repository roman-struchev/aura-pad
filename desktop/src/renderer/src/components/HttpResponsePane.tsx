import React from 'react'
import { HttpResponseView } from './HttpResponseView'
import type { HttpExchange } from '../hooks/useHttpClient'

interface HttpResponsePaneProps {
  exchange: HttpExchange
  width: number
  onStartResize: (event: { clientX: number }) => void
  onCancel: () => void
  onClose: () => void
}

// The response to a request run from a file, docked to the right of the
// editor: a resizable frame around the shared HttpResponseView. Request and
// response stay visible together, which is the whole reason it isn't a tab.
export const HttpResponsePane: React.FC<HttpResponsePaneProps> = ({
  exchange,
  width,
  onStartResize,
  onCancel,
  onClose
}) => (
  <div
    className="relative flex flex-col shrink-0 border-l border-fleet-border bg-fleet-sidebar"
    style={{ width: `${width}px` }}
    data-testid="http-response-pane"
  >
    <div
      className="absolute top-0 bottom-0 left-0 w-1.5 -translate-x-1/2 cursor-ew-resize hover:bg-blue-500/50 transition-colors z-10"
      onMouseDown={(e) => {
        e.preventDefault()
        onStartResize(e)
      }}
    />
    <HttpResponseView exchange={exchange} onCancel={onCancel} onClose={onClose} />
  </div>
)
