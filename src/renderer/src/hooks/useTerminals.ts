import React, { useEffect, useState } from 'react'

export type TerminalTab = { id: string; name: string }

export function useTerminals() {
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(256)
  const [isResizing, setIsResizing] = useState(false)
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [activeTermId, setActiveTermId] = useState<string | null>(null)

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
    setTerminals((prev) => [...prev, { id: termId, name: `Terminal ${prev.length + 1}` }])
    setActiveTermId(termId)
    if (runCommand) {
      setTimeout(() => {
        window.api.ptyWrite(termId, runCommand + '\r')
      }, 600)
    }
  }

  const closeTerminal = (termId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    window.api.destroyPty(termId)
    setTerminals((prev) => {
      const filtered = prev.filter((t) => t.id !== termId)
      if (activeTermId === termId) {
        setActiveTermId(filtered.length > 0 ? filtered[filtered.length - 1].id : null)
      }
      if (filtered.length === 0) setShowTerminal(false)
      return filtered
    })
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
    closeTerminal
  }
}
