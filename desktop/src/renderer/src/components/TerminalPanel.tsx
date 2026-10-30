import React from 'react'
import { PanelBottom, PanelLeft, PanelRight, Plus, X } from 'lucide-react'
import { isBottomDock, type TerminalDock } from '../hooks/useTerminals'
import { Terminal } from './Terminal'
import type { useTerminals } from '../hooks/useTerminals'

interface TerminalPanelProps {
  // The whole hook, like Sidebar does with git - the panel is its only
  // full consumer.
  terminal: ReturnType<typeof useTerminals>
  fontSize: number
  // App resolves the default cwd (active file's workspace root).
  onOpenNew: () => void
  // Which side the sidebar is on, so the under-the-editor icon draws it there.
  sidebarSide: 'left' | 'right'
  // Grid placement when App lays the panel out under the editor column.
  layoutStyle?: React.CSSProperties
}

// PanelBottom with the sidebar cut out of it: the drawer stops at the
// sidebar's edge instead of running underneath it. Lucide has no such glyph,
// so it is drawn here in lucide's own 24-unit, 2px-stroke grid.
const PanelBottomBesideSidebar: React.FC<{ size: number; side: 'left' | 'right' }> = ({
  size,
  side
}) => {
  const edge = side === 'right' ? 15 : 9
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d={`M${edge} 3v18`} />
      <path d={side === 'right' ? 'M3 15h12' : 'M9 15h12'} />
    </svg>
  )
}

// The bottom terminal drawer: tab strip, resize grip, and one live xterm per
// terminal (hidden ones stay mounted so their scrollback survives switching).
//
// A row of the window's own column, spanning its full width - not an overlay
// inside the editor column. `shrink-0` keeps the height the grip sets (the
// editor above takes what's left); `relative` is what the grip, which sits on
// the panel's top edge, positions against.
const DOCKS: {
  dock: TerminalDock
  label: string
  icon: (side: 'left' | 'right') => React.ReactNode
}[] = [
  { dock: 'left', label: 'Dock Terminal Left', icon: () => <PanelLeft size={14} /> },
  { dock: 'bottom', label: 'Dock Terminal Bottom', icon: () => <PanelBottom size={14} /> },
  {
    dock: 'editor',
    label: 'Dock Terminal Under Editor',
    icon: (side) => <PanelBottomBesideSidebar size={14} side={side} />
  },
  { dock: 'right', label: 'Dock Terminal Right', icon: () => <PanelRight size={14} /> }
]

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  terminal,
  fontSize,
  onOpenNew,
  sidebarSide,
  layoutStyle
}) => {
  const { dock } = terminal
  const vertical = isBottomDock(dock)
  return (
    <>
      {terminal.dockPreview && (
        // Full-window catcher while dragging (keeps the mouse out of Monaco and
        // xterm) with a tint over the edge the panel would land on.
        <div data-terminal-dock-overlay className="fixed inset-0 z-[60] cursor-grabbing">
          <div
            className="absolute bg-blue-500/25 border-2 border-blue-500/70 pointer-events-none"
            style={
              terminal.dockPreview === 'left'
                ? { top: 0, bottom: 0, left: 0, width: '20%' }
                : terminal.dockPreview === 'right'
                  ? { top: 0, bottom: 0, right: 0, width: '20%' }
                  : { left: 0, right: 0, bottom: 0, height: '35%' }
            }
          />
        </div>
      )}
      <div
        data-terminal-panel
        // Focusable so a click on the tab strip (not just the xterm) keeps focus
        // inside the panel and Cmd+W still targets the terminal.
        tabIndex={-1}
        data-terminal-dock={dock}
        className={`outline-none relative shrink-0 border-[var(--terminal-border)] flex flex-col bg-[var(--terminal-panel)] z-30 ${vertical ? 'border-t' : dock === 'left' ? 'order-first border-r' : 'border-l'}`}
        style={{
          ...layoutStyle,
          ...(vertical
            ? { height: `${terminal.terminalHeight}px` }
            : { width: `${terminal.terminalWidth}px` })
        }}
      >
        <div
          className={`absolute z-40 hover:bg-blue-500/50 transition-colors ${vertical ? 'top-0 left-0 right-0 h-1.5 cursor-ns-resize' : `top-0 bottom-0 w-1.5 cursor-ew-resize ${dock === 'left' ? 'right-0' : 'left-0'}`}`}
          onMouseDown={(e) => {
            e.preventDefault()
            terminal.setIsResizing(true)
          }}
        />
        <div className="flex items-center border-b border-[var(--terminal-border)] bg-[var(--terminal-header)] px-2 overflow-x-auto shrink-0">
          {terminal.terminals.map((term) => (
            <div
              key={term.id}
              onClick={() => terminal.setActiveTermId(term.id)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--terminal-border)] ${terminal.activeTermId === term.id ? 'bg-[var(--terminal-active)] text-white' : 'text-gray-400 hover:bg-[var(--terminal-active)] hover:text-gray-200'}`}
            >
              <span>{term.name}</span>
              <X
                size={12}
                className="opacity-50 hover:opacity-100"
                onClick={(e) => terminal.closeTerminal(term.id, e)}
              />
            </div>
          ))}
          <button onClick={onOpenNew} className="p-1.5 text-gray-400 hover:text-white mx-1">
            <Plus size={14} />
          </button>
          {/* The empty stretch of the strip is the handle for dragging the panel
          to another edge; the buttons do the same without a mouse drag. */}
          <div
            data-terminal-drag-handle
            className="flex-1 self-stretch min-w-6 cursor-grab"
            title="Drag to dock the terminal to the left, right or bottom"
            onMouseDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              terminal.startDocking()
            }}
          />
          {DOCKS.map(({ dock: d, label, icon }) => (
            <button
              key={d}
              aria-label={label}
              title={label}
              onClick={() => terminal.setDock(d)}
              className={`p-1.5 ${dock === d ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {icon(sidebarSide)}
            </button>
          ))}
          <button
            onClick={() => terminal.setShowTerminal(false)}
            className="p-1.5 text-gray-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden relative bg-[var(--terminal-bg)]">
          {terminal.terminals.map((term) => (
            <div
              key={term.id}
              className="absolute inset-0"
              data-active-terminal={terminal.activeTermId === term.id}
              style={{
                zIndex: terminal.activeTermId === term.id ? 10 : 1,
                visibility: terminal.activeTermId === term.id ? 'visible' : 'hidden'
              }}
            >
              <Terminal
                termId={term.id}
                isActive={terminal.activeTermId === term.id}
                fontSize={fontSize}
                onExit={() => terminal.handleTerminalExit(term.id)}
                onRegisterClear={terminal.registerTerminalClear}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
