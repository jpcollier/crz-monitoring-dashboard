import { type ReactNode, useId } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { presetDateRange, toISODate } from '../lib/alignment'
import { DATA_WINDOW } from '../lib/metadata'
import type { DayType, EntryType, PeriodPreset } from '../lib/types'

type ChoiceOption<T extends string> = { value: T; label: string; shortLabel?: string }

const PRESETS: ChoiceOption<PeriodPreset>[] = [
  { value: 'ytd',          label: 'Year to date', shortLabel: 'YTD' },
  { value: 'last_90_days', label: 'Past 90 days', shortLabel: '90 days' },
  { value: 'last_30_days', label: 'Past 30 days', shortLabel: '30 days' },
  { value: 'custom',       label: 'Custom' },
]

const ENTRY_TYPES: ChoiceOption<EntryType>[] = [
  { value: 'CRZ',      label: 'CRZ' },
  { value: 'Excluded', label: 'Excluded' },
  { value: 'Combined', label: 'Combined' },
]

const DAY_TYPES: ChoiceOption<DayType>[] = [
  { value: 'all',     label: 'All days' },
  { value: 'weekday', label: 'Weekday' },
  { value: 'weekend', label: 'Weekend' },
]

function ResponsiveChoiceControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ChoiceOption<T>[]
  value: T
  onChange: (v: T) => void
}) {
  const generatedId = useId()
  const selectId = `${generatedId}-select`

  return (
    <div className="flex w-full flex-wrap overflow-visible border border-ink-900 sm:inline-flex sm:w-auto sm:flex-nowrap">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`min-h-10 flex-1 basis-1/2 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors cursor-pointer sm:flex-none sm:basis-auto sm:px-3.5 ${
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
    <section className="border border-ink-900 bg-white px-4 py-4 sm:px-6 sm:py-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[auto_auto_auto] xl:items-end">
        <div className="flex min-w-0 flex-col gap-2">
          <FilterLabel>Period</FilterLabel>
          <SegmentedControl
            options={PRESETS}
            value={state.preset}
            onChange={(preset) => setState({ preset })}
          />
        </div>

        {showDayType && (
          <div className="flex min-w-0 flex-col gap-2">
            <FilterLabel>Day type</FilterLabel>
            <SegmentedControl
              options={DAY_TYPES}
              value={state.dayType}
              onChange={(dayType) => setState({ dayType })}
            />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <FilterLabel>Entry type</FilterLabel>
          <SegmentedControl
            options={ENTRY_TYPES}
            value={state.entryType}
            onChange={(entryType) => setState({ entryType })}
          />
        </div>
      </div>

      {state.preset === 'custom' && (
        <div className="mt-4 border border-ink-200 bg-paper-100 p-3 sm:p-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_minmax(0,1fr)] sm:items-end">
            <label className="flex min-w-0 flex-col gap-2">
              <FilterLabel>Start</FilterLabel>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={state.customStart ?? ''}
                onChange={(event) =>
                  setState({ preset: 'custom', customStart: event.target.value })
                }
                className="min-h-10 border border-ink-900 bg-white px-3 py-2 text-sm tabular"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-2">
              <FilterLabel>End</FilterLabel>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={state.customEnd ?? ''}
                onChange={(event) =>
                  setState({ preset: 'custom', customEnd: event.target.value })
                }
                className="min-h-10 border border-ink-900 bg-white px-3 py-2 text-sm tabular"
              />
            </label>
            <p className="text-xs leading-snug text-ink-600 sm:pb-2">
              2026 data available through {currentEndLabel}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
