import React from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal } from './Terminal'
import type { useTerminals } from '../hooks/useTerminals'

interface TerminalPanelProps {
  // The whole hook, like Sidebar does with git - the panel is its only
  // full consumer.
  terminal: ReturnType<typeof useTerminals>
  fontSize: number
  // App resolves the default cwd (active file's workspace root).
  onOpenNew: () => void
}

// The bottom terminal drawer: tab strip, resize grip, and one live xterm per
// terminal (hidden ones stay mounted so their scrollback survives switching).
export const TerminalPanel: React.FC<TerminalPanelProps> = ({ terminal, fontSize, onOpenNew }) => (
  <div
    className="absolute bottom-0 left-0 right-0 border-t border-[var(--terminal-border)] flex flex-col bg-[var(--terminal-panel)] z-30 shadow-2xl"
    style={{ height: `${terminal.terminalHeight}px` }}
  >
    <div
      className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-blue-500/50 transition-colors z-40"
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
      <div className="flex-1" />
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
)
