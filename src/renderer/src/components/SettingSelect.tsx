import React from 'react'
import clsx from 'clsx'

interface SettingSelectProps<T extends string> {
  label: string
  description: string
  value: T
  options: T[]
  onChange: (value: T) => void
  labelClassName?: string
  descriptionClassName?: string
}

export function SettingSelect<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  labelClassName = 'text-sm',
  descriptionClassName = 'text-xs'
}: SettingSelectProps<T>): React.ReactElement {
  return (
    <label className="flex items-center justify-between gap-4">
      <div className="flex flex-col min-w-0">
        <span className={clsx(labelClassName, 'text-fleet-text')}>{label}</span>
        <span className={clsx(descriptionClassName, 'text-gray-500')}>{description}</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500 capitalize shrink-0"
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="capitalize">
            {opt}
          </option>
        ))}
      </select>
    </label>
  )
}
