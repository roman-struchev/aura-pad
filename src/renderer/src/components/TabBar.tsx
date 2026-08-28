import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { X, Pin, Share2, ChevronDown } from 'lucide-react'
import type { OpenTab } from '../hooks/useTabs'
import { TabContextMenu } from './TabContextMenu'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { extensionTabInfo } from '../lib/extensions'

interface TabBarProps {
  tabs: OpenTab[]
  activeTabPath: string | null
  setActiveTabPath: (path: string) => void
  closeTab: (path: string) => void
  closeOtherTabs: (keepPath: string) => void
  closeAllTabs: () => void
  togglePin: (path: string) => void
  // Move a tab to another window - from the context menu, or by dragging it
  // out of this window entirely. In the main window that means a new window of
  // its own; in a torn-off one it means back to the main window.
  detachTab: (path: string) => void
  // False in a torn-off window, which sends tabs back instead of out.
  isPrimaryWindow?: boolean
  // Open the file's local history (the states AuraPad stored before writing
  // over it).
  showHistory: (path: string) => void
  // Open workspace roots, for the menu's "Copy Relative Path".
  rootPaths: string[]
  reorderTab: (sourcePath: string, targetPath: string) => void
  isPathShared?: (path: string) => boolean
}

// Breathing room kept between the active tab and the edge it was scrolled to,
// so it never ends up flush against the fade and looking half cut off.
const SCROLL_MARGIN = 12

const tabLabel = (path: string): string => extensionTabInfo(path)?.label ?? path.split('/').pop()!

// The tab strip, living inside the collapsed header row: click to switch,
// drag to reorder, close button on hover, right-click for Pin/Close/Close
// Others/Close All. Pinned-tab close confirmation lives in closeTab itself
// (so Cmd+W respects it too, not just this button).
//
// With more tabs than fit, the strip scrolls rather than squeezing them to
// nothing: tabs shrink down to a floor where the name is still readable, the
// active one is always scrolled into view (opening a file or Cmd+1..9 must
// never leave it parked off-screen), the wheel scrolls horizontally, fades
// mark that there is more in that direction, and the chevron opens the full
// list so a tab that is off-screen is still one click away.
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabPath,
  setActiveTabPath,
  closeTab,
  closeOtherTabs,
  closeAllTabs,
  togglePin,
  detachTab,
  isPrimaryWindow = true,
  showHistory,
  rootPaths,
  reorderTab,
  isPathShared
}) => {
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  )
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })

  const scrollerRef = useRef<HTMLDivElement>(null)
  // Live map of rendered tabs, so the active one can be measured without a
  // querySelector round-trip on every activation.
  const tabNodes = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!contextMenu && !overflowMenu) return
    const handleClick = (): void => {
      setContextMenu(null)
      setOverflowMenu(null)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu, overflowMenu])

  const syncOverflow = useCallback((): void => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // 1px slack: fractional layout widths otherwise leave the right fade on
    // forever at full scroll.
    setOverflow((prev) => {
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 }
      return prev.left === next.left && prev.right === next.right ? prev : next
    })
  }, [])

  // Keep the active tab on screen. Scrolls the strip itself rather than using
  // scrollIntoView, which would also walk up and scroll ancestors.
  const revealActive = useCallback((): void => {
    const el = scrollerRef.current
    const tab = activeTabPath ? tabNodes.current.get(activeTabPath) : null
    if (!el || !tab) return
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left - SCROLL_MARGIN)
    else if (right > el.scrollLeft + el.clientWidth)
      el.scrollLeft = right - el.clientWidth + SCROLL_MARGIN
    syncOverflow()
  }, [activeTabPath, syncOverflow])

  useLayoutEffect(revealActive, [revealActive, tabs])

  // The strip's own width changes without a scroll event - sidebar toggled,
  // window resized, a tab opened or closed - and each of those can push the
  // active tab out of view or end the overflow.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      revealActive()
      syncOverflow()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [revealActive, syncOverflow])

  // A plain mouse wheel only produces deltaY, which a horizontal strip ignores;
  // translated here so the tabs scroll like they do under a trackpad swipe.
  // Attached by hand because React's onWheel is passive - preventDefault there
  // is a no-op and the gesture would bubble up to whatever scrolls behind it.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Nothing open - the bar is just the toolbar.
  if (tabs.length === 0) return null

  const overflowing = overflow.left || overflow.right

  return (
    <div className="flex items-stretch h-full min-w-0 flex-1 no-drag-region">
      <div className="relative flex items-stretch min-w-0 flex-1">
        <div
          ref={scrollerRef}
          data-tab-strip
          onScroll={syncOverflow}
          className="flex items-stretch h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden no-scrollbar pt-1"
        >
          {tabs.map((tab) => {
            const isActive = activeTabPath === tab.path
            return (
              <div
                key={tab.path}
                ref={(node) => {
                  if (node) tabNodes.current.set(tab.path, node)
                  else tabNodes.current.delete(tab.path)
                }}
                draggable
                data-tab-path={tab.path}
                data-tab-active={isActive || undefined}
                title={tabLabel(tab.path)}
                onClick={() => setActiveTabPath(tab.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  // Viewport coordinates: the menu is position: fixed. The
                  // other menu is dismissed by hand because stopPropagation
                  // keeps this click from reaching the window listener that
                  // normally closes it.
                  setOverflowMenu(null)
                  setContextMenu({ x: e.clientX, y: e.clientY, path: tab.path })
                }}
                onDragStart={() => setDraggedTab(tab.path)}
                onDragEnd={(e) => {
                  const wasDragged = draggedTab
                  setDraggedTab(null)
                  setDragOverTab(null)
                  // Dropped outside the window: the strip's own drop handler
                  // never ran, and the pointer ended up past the edge of the
                  // page. That is the gesture for "give this tab a window of
                  // its own" - the same thing the context menu offers.
                  if (!wasDragged) return
                  const outside =
                    e.clientX < 0 ||
                    e.clientY < 0 ||
                    e.clientX > window.innerWidth ||
                    e.clientY > window.innerHeight
                  // In a torn-off window the last tab may leave too - it goes
                  // home rather than into yet another window.
                  if (outside && (tabs.length > 1 || !isPrimaryWindow)) detachTab(wasDragged)
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
                  'group flex items-center gap-2 px-3 text-xs cursor-pointer min-w-0',
                  isActive
                    ? // The bar shares the toolbar's (lighter) background; the
                      // active tab is painted in the editor's own (darker)
                      // background, so it reads as the editor surface cutting up
                      // through the bar and flowing straight down into the pane
                      // below with no seam. Rounded top + bright text mark it, and
                      // `tab-flow` adds the concave bottom flares into the pane.
                      // It alone never shrinks: the file being edited keeps its
                      // full name however crowded the strip gets.
                      'relative tab-flow bg-fleet-bg text-fleet-textHover rounded-t-lg shrink-0 max-w-[240px]'
                    : // Inactive tabs blend into the toolbar (no chip of their own),
                      // just dim text; hover lifts them slightly and traces a faint
                      // contour. They give up width first, down to a floor that
                      // still leaves a name recognisable (squeezing further
                      // buys no extra tabs - past this point the strip
                      // scrolls anyway, and every label would be unreadable).
                      'text-gray-500 hover:bg-fleet-active/50 hover:text-gray-200 rounded-t-lg ring-1 ring-transparent hover:ring-white/10 min-w-[120px] max-w-[200px]',
                  dragOverTab === tab.path && !isActive && 'bg-blue-500/20',
                  draggedTab === tab.path && 'opacity-40'
                )}
              >
                {(() => {
                  const ext = extensionTabInfo(tab.path)
                  if (!ext)
                    return <span className="truncate min-w-0">{tab.path.split('/').pop()}</span>
                  return (
                    <>
                      <ext.icon size={12} className="shrink-0 opacity-70" />
                      <span className="truncate min-w-0">{ext.label}</span>
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
        </div>

        {/* Fades over the scrolled-out ends: the scrollbar is hidden, so this
            is the only hint that the strip continues past the edge. */}
        {overflow.left && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-fleet-header to-transparent" />
        )}
        {overflow.right && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-fleet-header to-transparent" />
        )}
      </div>

      {overflowing && (
        <button
          aria-label="All Open Tabs"
          title="All Open Tabs"
          className="shrink-0 self-center px-1 py-1 rounded text-gray-400 hover:text-fleet-textHover hover:bg-fleet-active"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            setContextMenu(null)
            setOverflowMenu(overflowMenu ? null : { x: r.left, y: r.bottom + 4 })
          }}
        >
          <ChevronDown size={14} />
        </button>
      )}

      {overflowMenu && (
        <ContextMenu x={overflowMenu.x} y={overflowMenu.y}>
          {tabs.map((tab) => (
            <ContextMenuItem
              key={tab.path}
              onClick={() => {
                setActiveTabPath(tab.path)
                setOverflowMenu(null)
              }}
            >
              <span className="flex items-center gap-2">
                {/* A dot rather than bold or a brighter colour: the menu's own
                    text colour has to keep working in both themes. */}
                <span
                  className={clsx(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    activeTabPath === tab.path ? 'bg-blue-500' : 'bg-transparent'
                  )}
                />
                <span className="truncate">{tabLabel(tab.path)}</span>
                {!tab.isSaved && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50 shrink-0" />
                )}
              </span>
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasOtherTabs={tabs.length > 1}
          pinned={!!tabs.find((t) => t.path === contextMenu.path)?.pinned}
          onDismiss={() => setContextMenu(null)}
          onTogglePin={() => togglePin(contextMenu.path)}
          onDetach={() => detachTab(contextMenu.path)}
          onShowHistory={() => showHistory(contextMenu.path)}
          canShowHistory={!extensionTabInfo(contextMenu.path)}
          filePath={extensionTabInfo(contextMenu.path) ? null : contextMenu.path}
          rootPaths={rootPaths}
          detachLabel={isPrimaryWindow ? 'Move to New Window' : 'Move Back to Main Window'}
          onCloseTab={() => closeTab(contextMenu.path)}
          onCloseOthers={() => closeOtherTabs(contextMenu.path)}
          onCloseAll={closeAllTabs}
        />
      )}
    </div>
  )
}
