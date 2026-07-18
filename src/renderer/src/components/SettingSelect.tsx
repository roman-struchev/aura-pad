import React from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'

interface SettingSelectProps<T extends string> {
  label: string
  description: string
  value: T
  options: T[]
  // Display text per option, for values that don't read well raw (e.g.
  // 'hfc_female' -> 'Female (HFC)'). Unlisted options fall back to the value.
  optionLabels?: Partial<Record<T, string>>
  onChange: (value: T) => void
  labelClassName?: string
  descriptionClassName?: string
}

export function SettingSelect<T extends string>({
  label,
  description,
  value,
  options,
  optionLabels,
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
      {/* appearance-none + own chevron: the native macOS select draws its
          arrow flush against the border, which looks cramped next to the
          app's other controls. */}
      <div className="relative shrink-0">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="appearance-none bg-fleet-bg border border-fleet-border rounded pl-2 pr-7 py-1 text-xs text-fleet-text outline-none focus:border-blue-500 capitalize"
        >
          {options.map((opt) => (
            <option key={opt} value={opt} className="capitalize">
              {optionLabels?.[opt] ?? opt}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
        />
      </div>
    </label>
  )
}
