import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { FileNode } from '../../../shared/fileNode'

interface UseGlobalHotkeysOptions {
  // Escape, checked first (translation popup, dictation, read-aloud, in that
  // priority order in App). Returns true when it consumed the key.
  onEscape: () => boolean
  // Double-Shift quick open (JetBrains-style toggle).
  onToggleQuickOpen: () => void
  // The sidebar container, for "is a tree row focused" detection.
  sidebarRef: RefObject<HTMLDivElement | null>
  // Tree focus/clipboard state for keyboard copy/paste/delete. Live values -
  // the keydown effect re-subscribes when they change, same as before the
  // extraction.
  focusedNode: FileNode | null
  hasClipboard: boolean
  onCopyNode: (node: FileNode) => void
  onPasteIntoNode: (node: FileNode) => void
  onDeleteNode: (node: FileNode) => void
}

// The window-level keydown handling that isn't owned by the native menu:
// Escape priority chain, double-Shift quick open, and tree copy/paste/delete.
export function useGlobalHotkeys(options: UseGlobalHotkeysOptions): void {
  // focusedNode/hasClipboard gate the branch logic and drive the effect's
  // re-subscription, so they're read directly. The callbacks go through
  // optionsRef (below) like onEscape/onToggleQuickOpen, so a keypress always
  // hits the current render's handler with no stale-closure risk.
  const { sidebarRef, focusedNode, hasClipboard } = options

  const lastShiftTime = useRef<number>(0)
  // Tracks whether some other key fired between the last lone Shift press and
  // now, so two Shift keydowns close together only count as "double-Shift"
  // when nothing happened in between - not e.g. two Shift+<letter> presses
  // from fast CamelCase typing, each of which also fires its own Shift
  // keydown right before the letter.
  const keyPressedSinceShift = useRef<boolean>(false)

  // Stable accessors for the callbacks that don't participate in the effect's
  // dependency list.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && optionsRef.current.onEscape()) return

      // Double-Shift quick open - toggles rather than just opening, so
      // pressing it again closes the dialog too.
      if (e.key === 'Shift') {
        const now = Date.now()
        if (now - lastShiftTime.current < 300 && !keyPressedSinceShift.current) {
          optionsRef.current.onToggleQuickOpen()
          lastShiftTime.current = 0
        } else {
          lastShiftTime.current = now
        }
        keyPressedSinceShift.current = false
      } else {
        keyPressedSinceShift.current = true
      }

      // Copy/paste/delete for the file tree - only when a tree row actually
      // has focus, so this never steals Cmd+C/V from the editor or terminal,
      // and never fires while typing in an input/textarea inside the sidebar
      // (e.g. the Git panel's commit message box).
      const isTreeFocused =
        !!sidebarRef.current?.contains(document.activeElement) &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      if (isTreeFocused && focusedNode) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault()
          optionsRef.current.onCopyNode(focusedNode)
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && hasClipboard) {
          e.preventDefault()
          optionsRef.current.onPasteIntoNode(focusedNode)
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !focusedNode.isRoot) {
          e.preventDefault()
          optionsRef.current.onDeleteNode(focusedNode)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedNode, hasClipboard])
}
