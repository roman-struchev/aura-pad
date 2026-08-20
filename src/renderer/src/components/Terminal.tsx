import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { MONO_FONT_FAMILY } from '../lib/fonts'

interface TerminalProps {
  termId: string
  onExit?: () => void
  isActive: boolean
  fontSize?: number
  // Hands the panel a way to clear this terminal's scrollback (Cmd+K), and
  // takes it back with null when the terminal goes away.
  onRegisterClear?: (termId: string, clear: (() => void) | null) => void
}

export const Terminal: React.FC<TerminalProps> = ({
  termId,
  onExit,
  isActive,
  fontSize = 13,
  onRegisterClear
}) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  // The mount effect below runs once per termId, so its resize handler would
  // otherwise close over the isActive of the mount render (always true) and
  // keep fitting/IPC-resizing hidden terminals on every window resize.
  const isActiveRef = useRef(isActive)
  useEffect(() => {
    isActiveRef.current = isActive
  })
  // Same reason: the registration callback is a fresh function on every App
  // render, but it may only be read at mount and unmount.
  const onRegisterClearRef = useRef(onRegisterClear)
  useEffect(() => {
    onRegisterClearRef.current = onRegisterClear
  })

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new XTerm({
      theme: {
        background: '#181818',
        foreground: '#CCCCCC',
        cursor: '#FFFFFF',
        selectionBackground: '#5c5c5c'
      },
      fontFamily: MONO_FONT_FAMILY,
      fontSize,
      cursorBlink: true,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // xterm's own clear(): drops the scrollback and everything above the
    // cursor's line, leaving the prompt the user is standing on. The shell
    // never sees it, so a half-typed command survives.
    onRegisterClearRef.current?.(termId, () => term.clear())

    // Shift+Enter sends ESC+CR - what iTerm2/VSCode send after Claude CLI's
    // /terminal-setup - so TUIs (Claude Code, aider) insert a newline instead
    // of submitting. xterm.js would otherwise send a plain CR, identical to
    // Enter. Plain shells treat ESC+CR as accept-line, no worse than Enter.
    // Blocks keypress/keyup for the same chord too, or xterm would still
    // emit its own CR alongside ours.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.key === 'Enter' && ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        if (ev.type === 'keydown') window.api.ptyWrite(termId, '\x1b\r')
        return false
      }
      return true
    })

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
      if (isActiveRef.current && fitAddonRef.current) {
        fitAddonRef.current.fit()
        window.api.ptyResize(termId, term.cols, term.rows)
      }
    }

    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(terminalRef.current)

    // Initial fit
    if (isActive) {
      setTimeout(() => {
        fitAddon.fit()
        window.api.ptyResize(termId, term.cols, term.rows)
      }, 100)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      cleanupData()
      cleanupExit()
      onRegisterClearRef.current?.(termId, null)
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
