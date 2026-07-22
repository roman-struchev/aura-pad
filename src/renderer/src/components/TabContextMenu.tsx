import React from 'react'

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
    <div
      className="fixed bg-fleet-sidebar border border-fleet-border shadow-lg rounded py-1 z-50 text-sm text-gray-300 flex flex-col min-w-[160px]"
      style={{ top: y, left: x }}
    >
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(onTogglePin)}
      >
        {pinned ? 'Unpin' : 'Pin'}
      </button>
      <div className="my-1 h-px bg-fleet-border" />
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(onCloseTab)}
      >
        Close
      </button>
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!hasOtherTabs}
        onClick={() => run(onCloseOthers)}
      >
        Close Others
      </button>
      <button
        className="px-4 py-1.5 text-left hover:bg-fleet-active hover:text-white"
        onClick={() => run(onCloseAll)}
      >
        Close All
      </button>
    </div>
  )
}
