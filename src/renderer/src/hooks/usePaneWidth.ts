import { useEffect, useRef, useState } from 'react'

const MIN_WIDTH = 280
// Always leave room for the editor itself, however wide the pane is dragged.
const MIN_EDITOR_WIDTH = 320

// Width of a pane whose resize handle is on its left edge (the HTTP response
// pane). Unlike useSidebarWidth this measures the drag *delta* rather than
// the pointer's distance from the window edge, because the pane doesn't touch
// that edge - the sidebar can sit to its right.
export function usePaneWidth(
  savedWidth: number,
  onCommit: (width: number) => void
): { width: number; startResizing: (event: { clientX: number }) => void } {
  const [width, setWidth] = useState(savedWidth)
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null)
  const widthRef = useRef(savedWidth)

  // Same render-time sync as useSidebarWidth: pick up a settings value that
  // arrives after mount, but never fight an in-progress drag.
  const [lastSynced, setLastSynced] = useState(savedWidth)
  if (!drag && savedWidth !== lastSynced) {
    setLastSynced(savedWidth)
    setWidth(savedWidth)
  }

  useEffect(() => {
    if (!drag) return
    // Seeded here rather than during render (refs must not be written while
    // rendering); it exists only so mouseup can read the last dragged width
    // without the listener closing over a stale `width`.
    widthRef.current = drag.startWidth

    const handleMouseMove = (e: MouseEvent): void => {
      const max = Math.max(MIN_WIDTH, window.innerWidth - MIN_EDITOR_WIDTH)
      const next = Math.min(max, Math.max(MIN_WIDTH, drag.startWidth - (e.clientX - drag.startX)))
      widthRef.current = next
      setWidth(next)
    }
    const handleMouseUp = (): void => {
      setDrag(null)
      onCommit(widthRef.current)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }
  }, [drag, onCommit])

  return {
    width,
    startResizing: (event) => setDrag({ startX: event.clientX, startWidth: width })
  }
}
