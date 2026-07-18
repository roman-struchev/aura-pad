import React, { useEffect, useRef, useState } from 'react'

export type TerminalTab = { id: string; name: string }

export function useTerminals() {
  const [rawShowTerminal, setShowTerminal] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(256)
  const [isResizing, setIsResizing] = useState(false)
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [rawActiveTermId, setActiveTermId] = useState<string | null>(null)
  // Monotonic, never reused even as tabs close - `prev.length + 1` would
  // rename the next new tab "Terminal 2" after closing the *first* of three
  // open terminals, colliding with the "Terminal 2" that's still open.
  const terminalCounterRef = useRef(0)

  // Derived rather than synced back into state via an effect: if the
  // terminal that was active got closed (by the user, or because its shell
  // exited on its own) fall back to the last remaining one, and hide the
  // panel once nothing's left - computed straight from the current
  // `terminals`/`activeTermId` values instead of a separate render pass
  // that exists solely to "fix up" state after the fact.
  const activeTermId =
    rawActiveTermId && terminals.some((t) => t.id === rawActiveTermId)
      ? rawActiveTermId
      : (terminals[terminals.length - 1]?.id ?? null)
  const showTerminal = rawShowTerminal && terminals.length > 0

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newHeight = window.innerHeight - e.clientY
      if (newHeight > 150 && newHeight < window.innerHeight * 0.9) {
        setTerminalHeight(newHeight)
      }
    }
    const handleMouseUp = () => setIsResizing(false)
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ns-resize'
    } else {
      document.body.style.cursor = ''
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const openNewTerminal = async (cwd?: string, runCommand?: string): Promise<void> => {
    setShowTerminal(true)
    const termId = await window.api.createPty(cwd)
    terminalCounterRef.current += 1
    const name = `Terminal ${terminalCounterRef.current}`
    setTerminals((prev) => [...prev, { id: termId, name }])
    setActiveTermId(termId)
    if (runCommand) {
      setTimeout(() => {
        window.api.ptyWrite(termId, runCommand + '\r')
      }, 600)
    }
  }

  const removeTerminal = (termId: string): void => {
    setTerminals((prev) => prev.filter((t) => t.id !== termId))
  }

  const closeTerminal = (termId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    window.api.destroyPty(termId)
    removeTerminal(termId)
  }

  // Cmd+W while focus is inside the terminal panel: close the active
  // terminal, exactly like clicking its ✕ (see the menu-action dispatch in
  // App.tsx, which routes close-tab here instead of to the file tabs).
  const closeActiveTerminal = (): void => {
    if (!activeTermId) return
    window.api.destroyPty(activeTermId)
    removeTerminal(activeTermId)
  }

  // The shell process behind this tab exited on its own (typed `exit`, `^D`,
  // crashed, ...) - there's nothing left to destroy, just drop the now-dead
  // tab so it doesn't linger accepting input that goes nowhere.
  const handleTerminalExit = (termId: string): void => {
    removeTerminal(termId)
  }

  return {
    showTerminal,
    setShowTerminal,
    terminalHeight,
    setIsResizing,
    terminals,
    activeTermId,
    setActiveTermId,
    openNewTerminal,
    closeTerminal,
    closeActiveTerminal,
    handleTerminalExit
  }
}
