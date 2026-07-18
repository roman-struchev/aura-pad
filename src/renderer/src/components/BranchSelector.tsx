import React, { useState } from 'react'
import { GitBranch, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

interface BranchSelectorProps {
  root: string
  branch: string
  onBranches: (root: string) => Promise<string[]>
  onCheckout: (root: string, branch: string) => Promise<boolean>
  triggerClassName?: string
}

// The branch name as a dropdown trigger, shared by the git panel header and
// the window's top bar. The list is fetched lazily on every open - no
// caching, so it's always current. Callers key this by root so the open
// menu can't survive a repo switch.
export const BranchSelector: React.FC<BranchSelectorProps> = ({
  root,
  branch,
  onBranches,
  onCheckout,
  triggerClassName
}) => {
  // null = closed; [] = open but still loading
  const [menu, setMenu] = useState<string[] | null>(null)

  const toggle = async (): Promise<void> => {
    if (menu !== null) {
      setMenu(null)
      return
    }
    setMenu([])
    setMenu(await onBranches(root))
  }

  const select = async (target: string): Promise<void> => {
    setMenu(null)
    if (target === branch) return
    await onCheckout(root, target)
  }

  return (
    <div className="relative min-w-0">
      <button
        className={clsx(
          'flex items-center gap-1.5 min-w-0 px-1 py-0.5 rounded hover:bg-fleet-active hover:text-gray-200',
          triggerClassName
        )}
        title="Switch branch"
        onClick={toggle}
      >
        <GitBranch size={12} className="shrink-0" />
        <span className="truncate">{branch}</span>
        <ChevronDown size={10} className="shrink-0" />
      </button>
      {menu !== null && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] max-h-64 overflow-y-auto bg-fleet-bg border border-fleet-border rounded shadow-lg py-1">
            {menu.length === 0 ? (
              <div className="px-2 py-1 text-[10px] text-gray-500 italic">Loading…</div>
            ) : (
              menu.map((name) => (
                <button
                  key={name}
                  className={clsx(
                    'w-full text-left px-2 py-1 text-xs truncate hover:bg-fleet-active',
                    name === branch
                      ? 'text-fleet-textHover font-medium'
                      : 'text-gray-400 hover:text-gray-200'
                  )}
                  title={name}
                  onClick={() => select(name)}
                >
                  {name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
