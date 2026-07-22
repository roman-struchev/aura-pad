import React from 'react'
import clsx from 'clsx'

interface ToolbarButtonProps {
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
  // Tooltips center under the button by default; buttons hugging the window's
  // right (or left) edge should pass 'right' (or 'left') so theirs doesn't get
  // clipped.
  tooltipAlign?: 'center' | 'right' | 'left'
  // Which side of the button the tooltip opens on. Buttons near the window's
  // bottom edge (e.g. the sidebar footer) should pass 'top' so the tooltip
  // isn't clipped off-screen. Defaults to 'bottom'.
  tooltipSide?: 'top' | 'bottom'
  ariaLabel?: string
  colorClassName?: string
  // Tighter padding for buttons packed into a small container (e.g. the
  // active tab's file-action row), where the default p-1.5 is too heavy.
  dense?: boolean
  children: React.ReactNode
}

// Dedupes the toolbar's icon-button markup (Search/Add Folder/Save/Terminal/
// Settings etc. all share the same base styling, differing only in color
// and whether they're a toggle with an "active" state). `title` renders as a
// styled tooltip under the button on hover - not the native title attribute,
// whose OS-styled popup is slow to appear and clashes with the app's look.
export const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  disabled,
  active,
  title,
  tooltipAlign = 'center',
  tooltipSide = 'bottom',
  ariaLabel,
  colorClassName = 'text-gray-400',
  dense,
  children
}) => (
  <button
    onClick={onClick}
    // Don't take focus on click: the editor keeps its cursor/selection, and
    // no lingering focus ring appears on the button afterwards (e.g. the mic
    // button after Escape cancels a recording). Tab focus still works and
    // still shows the focus-visible ring for keyboard users.
    onMouseDown={(e) => e.preventDefault()}
    disabled={disabled}
    aria-label={ariaLabel ?? title}
    className={clsx(
      'group relative rounded hover:bg-fleet-active transition-colors',
      dense ? 'p-1' : 'p-1.5',
      active ? 'text-white bg-fleet-active' : colorClassName
    )}
  >
    {children}
    {title && (
      <span
        className={clsx(
          'absolute z-50 hidden group-hover:block whitespace-nowrap rounded border border-fleet-border bg-fleet-sidebar px-2 py-1 text-[11px] font-normal text-fleet-text shadow-lg pointer-events-none',
          tooltipSide === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          tooltipAlign === 'right'
            ? 'right-0'
            : tooltipAlign === 'left'
              ? 'left-0'
              : 'left-1/2 -translate-x-1/2'
        )}
      >
        {title}
      </span>
    )}
  </button>
)
