import React, { useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'

const EDGE_MARGIN = 6

interface ContextMenuProps {
  // Viewport coordinates of the click (clientX/clientY - the menu is fixed).
  x: number
  y: number
  // Marks the menu as belonging to a surface (e.g. "tree"), so keyboard
  // shortcuts scoped to that surface stay active while the menu is used -
  // the menu itself is rendered at the app root, outside its owner's DOM.
  surface?: string
  children: React.ReactNode
}

// Positions a popup menu at the cursor while keeping it fully on screen:
// flips it to the other side of the cursor when it would overflow (the usual
// case near the bottom edge, or with the sidebar docked right), then clamps
// so a menu bigger than the remaining gap still fits. Measurement happens in
// a layout effect - before paint - and the menu stays invisible until then,
// so it never appears at the unclamped spot first.
export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, surface, children }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Measure from the corner, not from where the menu will sit: the box is
    // shrink-to-fit, so at `left: x` it only gets the space left over to the
    // right of the cursor and reports that squeezed width (labels wrap, or it
    // stops at min-width). Flipping off an under-measured width lands the menu
    // off-screen anyway - which is every right-click with the sidebar docked
    // right. This runs before paint, so the corner is never visible.
    el.style.left = '0px'
    el.style.top = '0px'
    const { width, height } = el.getBoundingClientRect()
    const { innerWidth: vw, innerHeight: vh } = window

    const flippedLeft = x + width + EDGE_MARGIN > vw ? x - width : x
    const flippedTop = y + height + EDGE_MARGIN > vh ? y - height : y
    const left = Math.min(
      Math.max(EDGE_MARGIN, flippedLeft),
      Math.max(EDGE_MARGIN, vw - width - EDGE_MARGIN)
    )
    const top = Math.min(
      Math.max(EDGE_MARGIN, flippedTop),
      Math.max(EDGE_MARGIN, vh - height - EDGE_MARGIN)
    )
    // Written to the node as well as to state: when a re-measure lands on the
    // same coordinates React diffs the style away and the corner used for
    // measuring would be what stays on screen.
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    setPos({ left, top })
    // Re-measures per open (x/y change) and whenever the item list differs -
    // "Paste" appearing changes the height the flip is computed from.
  }, [x, y, children])

  return (
    <div
      ref={ref}
      data-surface={surface}
      className="fixed bg-fleet-sidebar border border-fleet-border shadow-lg rounded py-1 z-50 text-sm text-gray-300 flex flex-col min-w-[160px] overflow-y-auto no-scrollbar"
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        maxWidth: `calc(100vw - ${EDGE_MARGIN * 2}px)`,
        maxHeight: `calc(100vh - ${EDGE_MARGIN * 2}px)`,
        visibility: pos ? 'visible' : 'hidden'
      }}
    >
      {children}
    </div>
  )
}

interface ContextMenuItemProps {
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  children: React.ReactNode
}

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
  onClick,
  danger,
  disabled,
  children
}) => (
  <button
    className={clsx(
      'px-4 py-1.5 text-left shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
      danger
        ? 'text-red-400 hover:bg-red-500 hover:text-white'
        : 'hover:bg-fleet-active hover:text-white'
    )}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
)

export const ContextMenuSeparator: React.FC = () => (
  <div className="h-px bg-fleet-border my-1 shrink-0" />
)
