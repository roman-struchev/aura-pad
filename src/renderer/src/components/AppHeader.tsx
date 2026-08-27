import React from 'react'
import clsx from 'clsx'
import {
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings as SettingsIcon,
  Terminal as TerminalIcon
} from 'lucide-react'
import { ToolbarButton } from './ToolbarButton'
import type { SidebarPosition } from '../../../shared/settings'

interface AppHeaderProps {
  // A torn-off window is just tabs and an editor: no sidebar, no terminal, so
  // none of the toolbar's toggles have anything to act on. Only the
  // traffic-light gap survives.
  lean?: boolean
  terminalShown: boolean
  sidebarVisible: boolean
  sidebarPosition: SidebarPosition
  // The tab strip, filling the row next to the toolbar.
  tabBar: React.ReactNode
  onOpenGlobalSearch: () => void
  onToggleTerminal: () => void
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

// The window-title header, collapsed into a single Obsidian-style row: the app
// toolbar hugs the sidebar's side with the tab strip filling the rest, and the
// active file's actions float over the editor separately. The toolbar is
// ordered from the window edge inward - the sidebar toggle always sits
// outermost (closest to the edge) - and that whole order mirrors when the
// sidebar (and thus the toolbar) moves to the other side. The macOS
// traffic-light gap (ml-24) stays on whichever group is leftmost.
export const AppHeader: React.FC<AppHeaderProps> = ({
  lean,
  terminalShown,
  sidebarVisible,
  sidebarPosition,
  tabBar,
  onOpenGlobalSearch,
  onToggleTerminal,
  onToggleSidebar,
  onOpenSettings
}) => {
  const onLeft = sidebarPosition === 'left'
  const align = onLeft ? 'left' : 'right'
  const divider = <div className="w-px h-4 bg-fleet-border mx-1" />

  // Toolbar contents ordered from the window edge inward: the sidebar toggle is
  // always outermost, then the app actions. On the right side the whole list is
  // reversed so the layout mirrors and the toggle stays at the edge.
  const edgeInward: React.ReactNode[] = [
    <ToolbarButton
      key="sidebar"
      onClick={onToggleSidebar}
      active={!sidebarVisible}
      title={sidebarVisible ? 'Hide Sidebar (Cmd+B)' : 'Show Sidebar (Cmd+B)'}
      tooltipAlign={align}
      colorClassName="text-gray-400 hover:text-white"
    >
      {sidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
    </ToolbarButton>,
    <React.Fragment key="div">{divider}</React.Fragment>,
    <ToolbarButton
      key="search"
      onClick={onOpenGlobalSearch}
      title="Global Search (Cmd+Shift+F)"
      tooltipAlign={align}
      colorClassName="text-gray-400 hover:text-white"
    >
      <Search size={16} />
    </ToolbarButton>,
    <ToolbarButton
      key="terminal"
      onClick={onToggleTerminal}
      active={terminalShown}
      title="Toggle Terminal (Ctrl+`)"
      tooltipAlign={align}
    >
      <TerminalIcon size={16} />
    </ToolbarButton>,
    <ToolbarButton
      key="settings"
      onClick={onOpenSettings}
      title="Settings (Cmd+,)"
      tooltipAlign={align}
      colorClassName="text-gray-400 hover:text-white"
    >
      <SettingsIcon size={16} />
    </ToolbarButton>
  ]

  const toolbarGroup = (
    <div
      className={clsx(
        'flex items-center gap-1 no-drag-region shrink-0',
        // The traffic-light gap belongs to the leftmost group.
        onLeft && 'ml-24'
      )}
    >
      {onLeft ? edgeInward : [...edgeInward].reverse()}
    </div>
  )

  const tabSlot = (
    <div className={clsx('flex-1 min-w-0 self-stretch flex items-stretch', !onLeft && 'ml-24')}>
      {tabBar}
    </div>
  )

  if (lean) {
    return (
      <div className="h-9 flex items-center gap-1 pl-3 pr-3 bg-fleet-header select-none drag-region shrink-0">
        <div className="flex-1 min-w-0 self-stretch flex items-stretch ml-24">{tabBar}</div>
      </div>
    )
  }

  return (
    <div className="h-9 flex items-center gap-1 pl-3 pr-3 bg-fleet-header select-none drag-region shrink-0">
      {onLeft ? (
        <>
          {toolbarGroup}
          {tabSlot}
        </>
      ) : (
        <>
          {tabSlot}
          {toolbarGroup}
        </>
      )}
    </div>
  )
}
