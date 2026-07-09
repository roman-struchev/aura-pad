import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

interface TerminalProps {
  termId: string
  onExit?: () => void
  isActive: boolean
  fontSize?: number
}

export const Terminal: React.FC<TerminalProps> = ({ termId, onExit, isActive, fontSize = 13 }) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new XTerm({
      theme: {
        background: '#181818',
        foreground: '#CCCCCC',
        cursor: '#FFFFFF',
        selectionBackground: '#5c5c5c'
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize,
      cursorBlink: true,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    term.onData((data) => {
      window.api.ptyWrite(termId, data)
    })

    const cleanupData = window.api.onPtyData(termId, (data) => {
      term.write(data)
    })

    const cleanupExit = window.api.onPtyExit(termId, () => {
      if (onExit) onExit()
    })

    const handleResize = () => {
      if (isActive && fitAddonRef.current) {
        fitAddonRef.current.fit()
        window.api.ptyResize(termId, term.cols, term.rows)
      }
    }

    window.addEventListener('resize', handleResize)

    // Initial fit
    if (isActive) {
      setTimeout(() => {
        fitAddon.fit()
        window.api.ptyResize(termId, term.cols, term.rows)
      }, 100)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      cleanupData()
      cleanupExit()
      term.dispose()
    }
  }, [termId])

  // Live-update font size (e.g. when the UI density mode changes) without
  // recreating the terminal/pty.
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize
      fitAddonRef.current?.fit()
      if (isActive) window.api.ptyResize(termId, xtermRef.current.cols, xtermRef.current.rows)
    }
  }, [fontSize])

  // Reliable refit when terminal becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      const performFit = () => {
        try {
          fitAddonRef.current?.fit()
          window.api.ptyResize(termId, xtermRef.current!.cols, xtermRef.current!.rows)
        } catch (e) {
          console.warn('Fit failed, retrying...', e)
        }
      }

      // Try fitting a few times as layout shifts
      performFit()
      const timer1 = setTimeout(performFit, 50)
      const timer2 = setTimeout(performFit, 200)

      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }
    return undefined
  }, [isActive, termId])

  return (
    <div
      className="w-full h-full bg-[var(--terminal-bg)]"
      ref={terminalRef}
      style={{
        visibility: isActive ? 'visible' : 'hidden',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: isActive ? 'auto' : 'none'
      }}
    />
  )
}
