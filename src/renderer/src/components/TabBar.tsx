import React, { useState } from 'react'
import clsx from 'clsx'
import { X, Pin, PinOff } from 'lucide-react'
import type { OpenTab } from '../hooks/useTabs'

interface TabBarProps {
  tabs: OpenTab[]
  activeTabPath: string | null
  setActiveTabPath: (path: string) => void
  closeTab: (path: string) => void
  togglePin: (path: string) => void
  reorderTab: (sourcePath: string, targetPath: string) => void
  heightClassName: string
}

// The tab strip: click to switch, drag to reorder, hover for a pin toggle and
// close button. Pinned-tab close confirmation lives in closeTab itself (so
// Cmd+W respects it too, not just this button).
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabPath,
  setActiveTabPath,
  closeTab,
  togglePin,
  reorderTab,
  heightClassName
}) => {
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)

  // A single open file is already obvious from the window title bar - no
  // need for a tab strip until there's actually something to switch between.
  if (tabs.length <= 1) return null

  return (
    <div
      className={clsx(
        'flex items-stretch border-b border-fleet-border overflow-x-auto shrink-0 bg-fleet-header',
        heightClassName
      )}
    >
      {tabs.map((tab) => (
        <div
          key={tab.path}
          draggable
          onClick={() => setActiveTabPath(tab.path)}
          onDragStart={() => setDraggedTab(tab.path)}
          onDragEnd={() => {
            setDraggedTab(null)
            setDragOverTab(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (draggedTab && draggedTab !== tab.path) setDragOverTab(tab.path)
          }}
          onDragLeave={() => setDragOverTab(null)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOverTab(null)
            if (draggedTab) reorderTab(draggedTab, tab.path)
          }}
          className={clsx(
            'group flex items-center gap-2 px-3 text-xs cursor-pointer border-r border-fleet-border shrink-0 max-w-[200px]',
            activeTabPath === tab.path
              ? 'bg-fleet-bg text-fleet-textHover'
              : 'text-gray-400 hover:bg-fleet-active hover:text-gray-200',
            dragOverTab === tab.path && 'bg-blue-500/20',
            draggedTab === tab.path && 'opacity-40'
          )}
        >
          <span className="truncate">{tab.path.split('/').pop()}</span>
          {!tab.isSaved && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
          {tab.pinned ? (
            <Pin
              size={12}
              className="opacity-70 hover:opacity-100 shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                togglePin(tab.path)
              }}
            />
          ) : (
            <PinOff
              size={12}
              className="opacity-0 group-hover:opacity-50 hover:!opacity-100 shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                togglePin(tab.path)
              }}
            />
          )}
          <X
            size={12}
            className="opacity-50 hover:opacity-100 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.path)
            }}
          />
        </div>
      ))}
    </div>
  )
}
