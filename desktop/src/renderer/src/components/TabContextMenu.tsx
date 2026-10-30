import React from 'react'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { relativeToRoot } from '../lib/path'

interface TabContextMenuProps {
  x: number
  y: number
  pinned: boolean
  onDetach: () => void
  detachLabel: string
  onShowHistory: () => void
  // The tab's file, and the workspace roots "Copy Relative Path" measures
  // against. Absent for an extension tab, which has no file.
  filePath: string | null
  rootPaths: string[]
  // False for extension tabs (Google Tasks, HTTP form): nothing on disk, so
  // nothing was ever written over.
  canShowHistory: boolean
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
  onDetach,
  detachLabel,
  onShowHistory,
  canShowHistory,
  filePath,
  rootPaths,
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
      <ContextMenuItem onClick={() => run(onDetach)}>{detachLabel}</ContextMenuItem>
      <ContextMenuItem disabled={!canShowHistory} onClick={() => run(onShowHistory)}>
        Local History
      </ContextMenuItem>
      {filePath && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => run(() => void navigator.clipboard.writeText(filePath))}>
            Copy Path
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              run(() => void navigator.clipboard.writeText(relativeToRoot(filePath, rootPaths)))
            }
          >
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(() => void window.api.openInDefaultApp(filePath))}>
            Open in Default App
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => run(onCloseTab)}>Close</ContextMenuItem>
      <ContextMenuItem disabled={!hasOtherTabs} onClick={() => run(onCloseOthers)}>
        Close Others
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(onCloseAll)}>Close All</ContextMenuItem>
    </ContextMenu>
  )
}
