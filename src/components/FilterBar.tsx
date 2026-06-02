import { type ReactNode, useId } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { presetDateRange, toISODate } from '../lib/alignment'
import { DATA_WINDOW } from '../lib/metadata'
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
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2">
      <label htmlFor={selectId} className="eyebrow md:hidden">
        {label}
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-h-9 w-full min-w-0 max-w-full border border-ink-900 bg-white px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-900 md:hidden"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <fieldset className="hidden min-w-0 max-w-full flex-col gap-2 md:flex">
        <legend className="eyebrow">{label}</legend>
        <div className="grid w-full min-w-0 max-w-full grid-flow-col auto-cols-fr border border-ink-900">
          {options.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`min-h-9 min-w-0 overflow-hidden whitespace-normal px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors cursor-pointer lg:px-2.5 lg:text-[11px] ${
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

  const primaryGridClass = showDayType
    ? 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(16rem,1.4fr)_minmax(12rem,1fr)_minmax(12rem,1fr)]'
    : 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(16rem,1.4fr)_minmax(12rem,1fr)]'

  const handlePeriodChange = (preset: PeriodPreset) => {
    if (preset === 'custom' && state.preset !== 'custom') {
      const [customStart, customEnd] = presetDateRange(DATA_WINDOW, state.preset)

      setState({
        preset,
        customStart: toISODate(customStart),
        customEnd: toISODate(customEnd),
      })
      return
    }

    setState({ preset })
  }

  return (
    <section
      aria-label="Dashboard filters"
      className="bg-white border border-ink-900 px-4 py-4 sm:px-6 sm:py-5"
    >
      <div className={`${primaryGridClass} min-w-0 max-w-full items-end`}>
        <ResponsiveChoiceControl
          label="Period"
          options={PRESETS}
          value={state.preset}
          onChange={handlePeriodChange}
        />

        {showDayType && (
          <ResponsiveChoiceControl
            label="Day type"
            options={DAY_TYPES}
            value={state.dayType}
            onChange={(dayType) => setState({ dayType })}
          />
        )}

        <ResponsiveChoiceControl
          label="Entry type"
          options={ENTRY_TYPES}
          value={state.entryType}
          onChange={(entryType) => setState({ entryType })}
        />
      </div>

      {state.preset === 'custom' && (
        <div className="mt-4 border-t border-ink-200 pt-4">
          <div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2 lg:max-w-[32rem]">
            <label className="flex min-w-0 max-w-full flex-col gap-1">
              <FilterLabel>Start</FilterLabel>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={state.customStart ?? ''}
                onChange={(event) =>
                  setState({ preset: 'custom', customStart: event.target.value })
                }
                className="min-w-0 w-full max-w-full border border-ink-900 bg-white px-3 py-2 text-sm tabular"
              />
            </label>
            <label className="flex min-w-0 max-w-full flex-col gap-1">
              <FilterLabel>End</FilterLabel>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={state.customEnd ?? ''}
                onChange={(event) =>
                  setState({ preset: 'custom', customEnd: event.target.value })
                }
                className="min-w-0 w-full max-w-full border border-ink-900 bg-white px-3 py-2 text-sm tabular"
              />
            </label>
          </div>
        </div>
      )}
    </section>
  )
}
