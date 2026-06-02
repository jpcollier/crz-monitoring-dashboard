import { type ReactNode, useId } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { toISODate } from '../lib/alignment'
import { DATA_WINDOW, formatDisplayDate } from '../lib/metadata'
import type { DayType, EntryType, PeriodPreset } from '../lib/types'

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'ytd',          label: 'Year to date' },
  { value: 'last_90_days', label: 'Past 90 days' },
  { value: 'last_30_days', label: 'Past 30 days' },
  { value: 'custom',       label: 'Custom' },
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

type ChoiceOption<T extends string> = { value: T; label: string }

function ResponsiveChoiceControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: ReactNode
  options: ChoiceOption<T>[]
  value: T
  onChange: (v: T) => void
}) {
  const generatedId = useId()
  const selectId = `${generatedId}-select`

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto">
      <label htmlFor={selectId} className="eyebrow md:hidden">
        {label}
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-h-9 w-full border border-ink-900 bg-white px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-900 md:hidden"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <fieldset className="hidden min-w-0 flex-col gap-2 md:flex">
        <legend className="eyebrow">{label}</legend>
        <div className="inline-flex w-fit flex-nowrap border border-ink-900">
          {options.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`min-h-9 flex-none whitespace-nowrap px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors cursor-pointer lg:px-3.5 ${
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
      </fieldset>
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
  const minDate = toISODate(DATA_WINDOW.currentStart)
  const maxDate = toISODate(DATA_WINDOW.currentEnd)
  const currentEndLabel = formatDisplayDate(maxDate)

  return (
    <section
      aria-label="Dashboard filters"
      className="bg-white border border-ink-900 px-4 py-4 sm:px-6 sm:py-5"
    >
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:gap-x-8">
        <ResponsiveChoiceControl
          label="Period"
          options={PRESETS}
          value={state.preset}
          onChange={(preset) => setState({ preset })}
        />

        <ResponsiveChoiceControl
          label="Entry type"
          options={ENTRY_TYPES}
          value={state.entryType}
          onChange={(entryType) => setState({ entryType })}
        />

        {showDayType && (
          <ResponsiveChoiceControl
            label="Day type"
            options={DAY_TYPES}
            value={state.dayType}
            onChange={(dayType) => setState({ dayType })}
          />
        )}
      </div>

      {state.preset === 'custom' && (
        <div className="mt-4 border-t border-ink-200 pt-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_1fr] sm:items-end">
            <label className="flex flex-col gap-1">
              <FilterLabel>Start</FilterLabel>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={state.customStart ?? ''}
                onChange={(event) =>
                  setState({ preset: 'custom', customStart: event.target.value })
                }
                className="border border-ink-900 bg-white px-3 py-2 text-sm tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <FilterLabel>End</FilterLabel>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={state.customEnd ?? ''}
                onChange={(event) =>
                  setState({ preset: 'custom', customEnd: event.target.value })
                }
                className="border border-ink-900 bg-white px-3 py-2 text-sm tabular"
              />
            </label>
            <p className="text-xs leading-snug text-ink-600 sm:max-w-44">
              2026 data available through {currentEndLabel}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
