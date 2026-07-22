import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { X, Pin, Share2 } from 'lucide-react'
import type { OpenTab } from '../hooks/useTabs'
import { TabContextMenu } from './TabContextMenu'
import { extensionTabInfo } from '../lib/extensions'

interface TabBarProps {
  tabs: OpenTab[]
  activeTabPath: string | null
  setActiveTabPath: (path: string) => void
  closeTab: (path: string) => void
  closeOtherTabs: (keepPath: string) => void
  closeAllTabs: () => void
  togglePin: (path: string) => void
  reorderTab: (sourcePath: string, targetPath: string) => void
  isPathShared?: (path: string) => boolean
}

// The tab strip, living inside the collapsed header row: click to switch,
// drag to reorder, close button on hover, right-click for Pin/Close/Close
// Others/Close All. Pinned-tab close confirmation lives in closeTab itself
// (so Cmd+W respects it too, not just this button).
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabPath,
  setActiveTabPath,
  closeTab,
  closeOtherTabs,
  closeAllTabs,
  togglePin,
  reorderTab,
  isPathShared
}) => {
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  )

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (): void => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  // Nothing open - the bar is just the toolbar.
  if (tabs.length === 0) return null

  return (
    <div className="flex items-stretch h-full min-w-0 overflow-x-auto overflow-y-hidden no-scrollbar no-drag-region pt-1">
      {tabs.map((tab) => {
        const isActive = activeTabPath === tab.path
        return (
          <div
            key={tab.path}
            draggable
            onClick={() => setActiveTabPath(tab.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({ x: e.pageX, y: e.pageY, path: tab.path })
            }}
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
              'group flex items-center gap-2 px-3 text-xs cursor-pointer shrink-0',
              isActive
                ? // The bar shares the toolbar's (lighter) background; the
                  // active tab is painted in the editor's own (darker)
                  // background, so it reads as the editor surface cutting up
                  // through the bar and flowing straight down into the pane
                  // below with no seam. Rounded top + bright text mark it, and
                  // `tab-flow` adds the concave bottom flares into the pane.
                  'relative tab-flow bg-fleet-bg text-fleet-textHover rounded-t-lg'
                : // Inactive tabs blend into the toolbar (no chip of their own),
                  // just dim text; hover lifts them slightly and traces a faint
                  // contour.
                  'text-gray-500 hover:bg-fleet-active/50 hover:text-gray-200 rounded-t-lg ring-1 ring-transparent hover:ring-white/10 max-w-[200px]',
              dragOverTab === tab.path && !isActive && 'bg-blue-500/20',
              draggedTab === tab.path && 'opacity-40'
            )}
          >
            {(() => {
              const ext = extensionTabInfo(tab.path)
              if (!ext) return <span className="truncate">{tab.path.split('/').pop()}</span>
              return (
                <>
                  <ext.icon size={12} className="shrink-0 opacity-70" />
                  <span className="truncate">{ext.label}</span>
                </>
              )
            })()}
            {!tab.isSaved && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
            {isPathShared?.(tab.path) && (
              <span className="shrink-0" title="Shared via Work Together">
                <Share2 size={11} className="text-blue-400" />
              </span>
            )}
            {tab.pinned && (
              <Pin
                size={11}
                className="opacity-70 hover:opacity-100 shrink-0 cursor-pointer"
                aria-label="Unpin"
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
        )
      })}

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasOtherTabs={tabs.length > 1}
          pinned={!!tabs.find((t) => t.path === contextMenu.path)?.pinned}
          onDismiss={() => setContextMenu(null)}
          onTogglePin={() => togglePin(contextMenu.path)}
          onCloseTab={() => closeTab(contextMenu.path)}
          onCloseOthers={() => closeOtherTabs(contextMenu.path)}
          onCloseAll={closeAllTabs}
        />
      )}
    </div>
  )
}
