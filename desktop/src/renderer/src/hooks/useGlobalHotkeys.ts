import { useEffect, useRef } from 'react'
import { TREE_SURFACE_SELECTOR } from '../lib/treeRows'

interface UseGlobalHotkeysOptions {
  // Escape, checked first (context menu, translation popup, dictation,
  // read-aloud, in that priority order in App). Returns true when it
  // consumed the key.
  onEscape: () => boolean
  // Double-Shift quick open (JetBrains-style toggle).
  onToggleQuickOpen: () => void
  // The three keys the native menu only displays (registerAccelerator:false
  // in src/main/menu.ts) and this handles instead: Find Action, Go to Line,
  // File Structure.
  onCommandPalette: () => void
  onGoToLine: () => void
  onGoToSymbol: () => void
  // Whether the file tree currently has a selection to act on. Live value -
  // the keydown effect re-subscribes when it changes.
  hasTreeSelection: boolean
  onCopySelection: () => void
  onPasteIntoSelection: () => void
  onDeleteSelection: () => void
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

// Whether this key press is the platform's "command" chord. On macOS that is
// Cmd only: Ctrl+L there (and on Linux/Windows) is the shell's clear-screen,
// which the terminal panel must keep receiving.
function isCommandChord(e: KeyboardEvent): boolean {
  return window.api.platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

// The window-level keydown handling that isn't owned by the native menu:
// Escape priority chain, double-Shift quick open, the navigation keys the
// menu only displays, and tree copy/paste/delete.
export function useGlobalHotkeys(options: UseGlobalHotkeysOptions): void {
  const { hasTreeSelection } = options

  const lastShiftTime = useRef<number>(0)
  // Tracks whether some other key fired between the last lone Shift press and
  // now, so two Shift keydowns close together only count as "double-Shift"
  // when nothing happened in between - not e.g. two Shift+<letter> presses
  // from fast CamelCase typing, each of which also fires its own Shift
  // keydown right before the letter.
  const keyPressedSinceShift = useRef<boolean>(false)

  // Whether the last pointer interaction landed in the tree. DOM focus alone
  // can't answer this: picking an item from the tree's context menu leaves
  // focus on a button that is then unmounted, so document.activeElement falls
  // back to <body> and every tree shortcut would go dead right after a
  // right-click - which is exactly when Cmd+V gets pressed.
  const treeSurfaceActive = useRef(false)

  // Stable accessors for the callbacks that don't participate in the effect's
  // dependency list.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      treeSurfaceActive.current = !!target?.closest?.(TREE_SURFACE_SELECTOR)
    }
    // Capture: the tree stops propagation on its own row clicks.
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [])

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

      const active = document.activeElement

      // Find Action / Go to Line / File Structure. Not taken while the
      // terminal has focus: Ctrl+L belongs to the shell running in it.
      if (isCommandChord(e) && !active?.closest?.('.xterm')) {
        const key = e.key.toLowerCase()
        if (e.shiftKey && key === 'a') {
          e.preventDefault()
          optionsRef.current.onCommandPalette()
          return
        }
        if (!e.shiftKey && !e.altKey && key === 'l') {
          e.preventDefault()
          optionsRef.current.onGoToLine()
          return
        }
        if (e.key === 'F12') {
          e.preventDefault()
          optionsRef.current.onGoToSymbol()
          return
        }
      }

      // Copy/paste/delete for the file tree. Scoped to "the tree is the
      // surface the user is working in": something is selected there, the
      // last click was inside it, and focus isn't in a text field (Monaco and
      // xterm both park it on a hidden textarea) - so this never steals
      // Cmd+C/V from the editor, the terminal, or the git commit box.
      // The remembered surface must also still be on screen: hiding the
      // sidebar (Cmd+B) right after clicking a row would otherwise leave the
      // shortcuts armed over a tree nobody can see.
      const treeIsActive =
        hasTreeSelection &&
        !isTextEntry(active) &&
        !!document.querySelector(TREE_SURFACE_SELECTOR) &&
        (treeSurfaceActive.current || !!active?.closest?.(TREE_SURFACE_SELECTOR))
      if (!treeIsActive) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        optionsRef.current.onCopySelection()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        optionsRef.current.onPasteIntoSelection()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        optionsRef.current.onDeleteSelection()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasTreeSelection])
}
