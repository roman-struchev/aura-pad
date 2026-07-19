import { useEffect, useRef } from 'react'
import type { MenuAction } from '../../../shared/menuAction'

// The native macOS/Windows/Linux menu owns the app's accelerators (Cmd+S,
// Cmd+W, etc.) instead of a renderer-side keydown handler, so each key press
// only ever triggers one handler - see src/main/menu.ts. This subscribes to
// the forwarded actions once, reading the current render's handlers through
// a ref so they never act on stale state.
export function useMenuActions(handlers: Record<MenuAction, () => void>): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const unsubscribe = window.api.onMenuAction((action) => {
      handlersRef.current[action]?.()
    })
    return unsubscribe
  }, [])
}
