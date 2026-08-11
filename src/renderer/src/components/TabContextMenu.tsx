import React from 'react'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'

interface TabContextMenuProps {
  x: number
  y: number
  pinned: boolean
  onDismiss: () => void
  onTogglePin: () => void
  onCloseTab: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  hasOtherTabs: boolean
}

export const TabContextMenu: React.FC<TabContextMenuProps> = ({
  x,
  y,
  pinned,
  onDismiss,
  onTogglePin,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  hasOtherTabs
}) => {
  const run = (action: () => void): void => {
    action()
    onDismiss()
  }

  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuItem onClick={() => run(onTogglePin)}>{pinned ? 'Unpin' : 'Pin'}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => run(onCloseTab)}>Close</ContextMenuItem>
      <ContextMenuItem disabled={!hasOtherTabs} onClick={() => run(onCloseOthers)}>
        Close Others
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(onCloseAll)}>Close All</ContextMenuItem>
    </ContextMenu>
  )
}
