import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchResultChangeEvent } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { MONO_FONT_FAMILY } from '../lib/fonts'

// Colors for xterm's own match highlighting (a fixed dark palette, like the
// rest of this panel - the terminal always renders dark regardless of the
// app theme, see --terminal-* in main.css).
const SEARCH_DECORATIONS = {
  matchBackground: '#3a3d41',
  matchBorder: '#6b6b6b',
  matchOverviewRuler: '#3a3d41',
  activeMatchBackground: '#515c6a',
  activeMatchBorder: '#8a8a8a',
  activeMatchColorOverviewRuler: '#515c6a'
}

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
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchInfo, setMatchInfo] = useState<ISearchResultChangeEvent | null>(null)
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

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)

    term.open(terminalRef.current)

    xtermRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    const searchResultsDisposable = searchAddon.onDidChangeResults((e) => setMatchInfo(e))

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
      // Cmd+F (Ctrl+F elsewhere) opens in-terminal search instead of reaching
      // the shell, the same trade xterm's own default keybindings make for
      // Cmd+C/Cmd+V - readline's forward-char loses Ctrl+F on non-mac, same
      // as VS Code's integrated terminal.
      const isCommandChord =
        window.api.platform === 'darwin' ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey
      if (isCommandChord && ev.key.toLowerCase() === 'f') {
        if (ev.type === 'keydown') setIsSearchOpen(true)
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
      searchResultsDisposable.dispose()
      onRegisterClearRef.current?.(termId, null)
      term.dispose()
    }
  }, [termId])

  const closeSearch = (): void => {
    searchAddonRef.current?.clearDecorations()
    setIsSearchOpen(false)
    setSearchQuery('')
    setMatchInfo(null)
    xtermRef.current?.focus()
  }

  const findNext = (query: string): void => {
    if (!query) return
    searchAddonRef.current?.findNext(query, { decorations: SEARCH_DECORATIONS, incremental: true })
  }

  const findPrevious = (query: string): void => {
    if (!query) return
    searchAddonRef.current?.findPrevious(query, { decorations: SEARCH_DECORATIONS })
  }

  const handleSearchChange = (value: string): void => {
    setSearchQuery(value)
    if (value) {
      findNext(value)
    } else {
      searchAddonRef.current?.clearDecorations()
      setMatchInfo(null)
    }
  }

  const handleSearchKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      closeSearch()
    } else if (ev.key === 'Enter') {
      ev.preventDefault()
      if (ev.shiftKey) findPrevious(searchQuery)
      else findNext(searchQuery)
    }
  }

  // Focus (and pre-select, so retyping replaces a stale query) the moment
  // the overlay appears - it renders with the terminal's textarea still
  // holding focus otherwise.
  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [isSearchOpen])

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

  const matchCountLabel = matchInfo
    ? matchInfo.resultCount === 0
      ? '0/0'
      : `${matchInfo.resultIndex + 1}/${matchInfo.resultCount}`
    : ''

  return (
    <div
      style={{
        visibility: isActive ? 'visible' : 'hidden',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: isActive ? 'auto' : 'none'
      }}
    >
      <div className="w-full h-full bg-[var(--terminal-bg)]" ref={terminalRef} />
      {isSearchOpen && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded border border-[var(--terminal-border)] bg-[var(--terminal-header)] px-2 py-1 shadow-lg">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find"
            className="w-40 bg-transparent border-none outline-none text-xs text-gray-200 placeholder:text-gray-500"
          />
          <span className="text-[10px] text-gray-500 tabular-nums min-w-[3ch] text-center shrink-0">
            {matchCountLabel}
          </span>
          <button
            onClick={() => findPrevious(searchQuery)}
            disabled={!searchQuery}
            className="p-0.5 text-gray-400 hover:text-white disabled:opacity-30"
            title="Previous match"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={() => findNext(searchQuery)}
            disabled={!searchQuery}
            className="p-0.5 text-gray-400 hover:text-white disabled:opacity-30"
            title="Next match"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={closeSearch}
            className="p-0.5 text-gray-400 hover:text-white"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
