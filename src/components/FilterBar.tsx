import { type ReactNode } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { DATA_WINDOW } from '../lib/metadata'
import type { DayType, EntryType, PeriodPreset } from '../lib/types'

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'ytd',          label: 'Year to date' },
  { value: 'last_90_days', label: 'Past 90 days' },
  { value: 'last_30_days', label: 'Past 30 days' },
]

const ENTRY_TYPES: { value: EntryType; label: string }[] = [
  { value: 'CRZ',      label: 'CRZ' },
  { value: 'Excluded', label: 'Excluded' },
  { value: 'Combined', label: 'Combined' },
]

const DAY_TYPES: { value: DayType; label: string }[] = [
  { value: 'all',     label: 'All days' },
  { value: 'weekday', label: 'Weekday' },
  { value: 'weekend', label: 'Weekend' },
]

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex w-full overflow-x-auto border border-ink-900 sm:inline-flex sm:w-auto">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`min-h-9 flex-1 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors cursor-pointer sm:flex-none sm:px-3.5 ${
            i < options.length - 1 ? 'border-r border-ink-900' : ''
          } ${
            value === opt.value
              ? 'bg-ink-900 text-paper-50'
              : 'bg-transparent text-ink-900 hover:bg-paper-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function FilterLabel({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow">
      {children}
    </span>
  )
}

export default function FilterBar({ showDayType = false }: { showDayType?: boolean }) {
  const [state, setState] = useUrlState(DATA_WINDOW)

  return (
    <div className="bg-white border border-ink-900 px-4 py-4 sm:px-6 sm:py-5">
      <div className="grid gap-4 lg:flex lg:flex-wrap lg:items-center lg:gap-8">

        <div className="flex min-w-0 flex-col gap-2">
          <FilterLabel>Period</FilterLabel>
          <SegmentedControl
            options={PRESETS}
            value={state.preset}
            onChange={(preset) => setState({ preset })}
          />
        </div>

        {showDayType && (
          <>
            <div className="hidden self-stretch w-px bg-ink-200 lg:block" />
            <div className="flex min-w-0 flex-col gap-2">
              <FilterLabel>Day type</FilterLabel>
              <SegmentedControl
                options={DAY_TYPES}
                value={state.dayType}
                onChange={(dayType) => setState({ dayType })}
              />
            </div>
          </>
        )}

        <div className="hidden self-stretch w-px bg-ink-200 lg:block" />

        <div className="flex min-w-0 flex-col gap-2">
          <FilterLabel>Entry type</FilterLabel>
          <SegmentedControl
            options={ENTRY_TYPES}
            value={state.entryType}
            onChange={(entryType) => setState({ entryType })}
          />
        </div>

      </div>
    </div>
  )
}
