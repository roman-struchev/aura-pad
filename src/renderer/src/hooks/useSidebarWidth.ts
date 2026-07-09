import { useEffect, useRef, useState } from 'react'
import type { SidebarPosition } from '../../../shared/settings'

const MIN_WIDTH = 180
const MAX_WIDTH = 480

// Live width updates as a local state (for smooth drag feedback); the
// persisted setting is only written once, when the drag actually ends -
// calling onCommit on every mousemove would spam settings.json writes.
export function useSidebarWidth(
  savedWidth: number,
  sidebarPosition: SidebarPosition,
  onCommit: (width: number) => void
) {
  const [width, setWidth] = useState(savedWidth)
  const [isResizing, setIsResizing] = useState(false)
  const widthRef = useRef(savedWidth)

  // Stay in sync if the persisted value changes elsewhere (e.g. settings
  // arriving async after mount) - but never fight an in-progress drag.
  // Adjusted directly during render (rather than in an effect) so this
  // doesn't trigger an extra render pass.
  const [lastSyncedWidth, setLastSyncedWidth] = useState(savedWidth)
  if (!isResizing && savedWidth !== lastSyncedWidth) {
    setLastSyncedWidth(savedWidth)
    setWidth(savedWidth)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent): void => {
      const raw = sidebarPosition === 'right' ? window.innerWidth - e.clientX : e.clientX
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw))
      widthRef.current = clamped
      setWidth(clamped)
    }
    const handleMouseUp = (): void => {
      setIsResizing(false)
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
  }, [isResizing, sidebarPosition, onCommit])

  return { width, startResizing: () => setIsResizing(true) }
}
