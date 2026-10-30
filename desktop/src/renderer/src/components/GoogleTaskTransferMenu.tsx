import React from 'react'
import type { GTaskList } from '../../../shared/googleTasks'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'

// Per-account task lists as the menu sees them: absent while still loading.
export type TransferTargets = Record<string, GTaskList[] | { error: string } | undefined>

interface GoogleTaskTransferMenuProps {
  x: number
  y: number
  // The connected accounts other than the task's own, in tab order.
  accounts: string[]
  targets: TransferTargets
  onPick: (email: string, listId: string) => void
}

// "Move to another account": every other connected account with its task
// lists, so a move is two clicks (open, pick a list). Dismissal is the
// owner's job, same as the tab context menu.
export const GoogleTaskTransferMenu: React.FC<GoogleTaskTransferMenuProps> = ({
  x,
  y,
  accounts,
  targets,
  onPick
}) => (
  <ContextMenu x={x} y={y}>
    <div className="px-4 pt-1 pb-1.5 text-xs font-medium text-fleet-textHover shrink-0">
      Move to account
    </div>
    {accounts.map((email, i) => {
      const lists = targets[email]
      return (
        <React.Fragment key={email}>
          {i > 0 && <ContextMenuSeparator />}
          <div
            className="px-4 pt-1 pb-0.5 text-[11px] text-gray-500 truncate shrink-0 max-w-[280px]"
            title={email}
          >
            {email}
          </div>
          {!lists ? (
            <ContextMenuItem disabled onClick={() => {}}>
              Loading lists…
            </ContextMenuItem>
          ) : 'error' in lists ? (
            <div className="px-4 py-1 text-xs text-accent-error max-w-[280px] shrink-0">
              {lists.error}
            </div>
          ) : lists.length === 0 ? (
            <ContextMenuItem disabled onClick={() => {}}>
              No task lists
            </ContextMenuItem>
          ) : (
            lists.map((list) => (
              <ContextMenuItem key={list.id} onClick={() => onPick(email, list.id)}>
                <span className="block truncate max-w-[240px] pl-2">{list.title}</span>
              </ContextMenuItem>
            ))
          )}
        </React.Fragment>
      )
    })}
  </ContextMenu>
)
