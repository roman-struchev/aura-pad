import React from 'react'
import clsx from 'clsx'

interface ToolbarButtonProps {
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
  ariaLabel?: string
  colorClassName?: string
  children: React.ReactNode
}

// Dedupes the toolbar's icon-button markup (Search/Add Folder/Save/Terminal/
// Settings etc. all share the same base styling, differing only in color
// and whether they're a toggle with an "active" state).
export const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  disabled,
  active,
  title,
  ariaLabel,
  colorClassName = 'text-gray-400',
  children
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel}
    className={clsx(
      'p-1.5 rounded hover:bg-fleet-active transition-colors',
      active ? 'text-white bg-fleet-active' : colorClassName
    )}
  >
    {children}
  </button>
)
