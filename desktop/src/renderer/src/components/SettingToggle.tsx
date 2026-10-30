import React from 'react'
import clsx from 'clsx'

interface SettingToggleProps {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  labelClassName?: string
  descriptionClassName?: string
}

export const SettingToggle: React.FC<SettingToggleProps> = ({
  label,
  description,
  checked,
  onChange,
  labelClassName = 'text-sm',
  descriptionClassName = 'text-xs'
}) => (
  <label className="flex items-center justify-between gap-4 cursor-pointer">
    <div className="flex flex-col min-w-0">
      <span className={clsx(labelClassName, 'text-fleet-text')}>{label}</span>
      <span className={clsx(descriptionClassName, 'text-gray-500')}>{description}</span>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'w-9 h-5 rounded-full transition-colors relative shrink-0',
        checked ? 'bg-blue-600' : 'bg-fleet-border'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
          checked && 'translate-x-4'
        )}
      />
    </button>
  </label>
)
