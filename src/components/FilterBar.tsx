import { type ReactNode } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { comparablePeriod, toISODate } from '../lib/alignment'
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

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="min-w-0 max-w-full [min-inline-size:0]">
      <legend className="eyebrow mb-2">{label}</legend>
      <div className="flex max-w-full overflow-x-auto border border-ink-900 bg-white">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`min-h-9 min-w-max flex-1 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors cursor-pointer focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink-900 sm:px-3.5 ${
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
  )
}

function FilterLabel({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow">
      {children}
    </span>
  )
}

function presetDateRange(preset: Exclude<PeriodPreset, 'custom'>): { start: string; end: string } {
  const [[start, end]] = comparablePeriod(DATA_WINDOW, preset).current
  return {
    start: toISODate(start),
    end: toISODate(end),
  }
}

export default function FilterBar({ showDayType = false }: { showDayType?: boolean }) {
  const [state, setState] = useUrlState(DATA_WINDOW)
  const minDate = toISODate(DATA_WINDOW.currentStart)
  const maxDate = toISODate(DATA_WINDOW.currentEnd)
  const isCustom = state.preset === 'custom'
  const fallbackCustomRange = state.preset === 'custom'
    ? { start: minDate, end: maxDate }
    : presetDateRange(state.preset)
  const customStart = isCustom ? state.customStart ?? fallbackCustomRange.start : fallbackCustomRange.start
  const customEnd = isCustom ? state.customEnd ?? fallbackCustomRange.end : fallbackCustomRange.end
  const periodColumnClass = showDayType ? 'xl:col-span-3' : 'xl:col-span-4'
  const customColumnClass = showDayType ? 'xl:col-span-3' : 'xl:col-span-4'
  const entryColumnClass = showDayType ? 'xl:col-span-3' : 'xl:col-span-4'

  return (
    <section aria-label="Dashboard filters" className="overflow-hidden border border-ink-900 bg-white px-4 py-4 sm:px-6 sm:py-5">
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-12 xl:items-start xl:gap-0">
        <div className={`min-w-0 ${periodColumnClass}`}>
          <SegmentedControl
            label="Period"
            options={PRESETS}
            value={state.preset}
            onChange={(preset) => {
              if (preset === 'custom') {
                setState({ preset, customStart, customEnd })
                return
              }
              setState({ preset })
            }}
          />
        </div>

        <div className={`min-w-0 xl:border-l xl:border-ink-200 xl:pl-5 xl:pr-5 ${customColumnClass}`}>
          <div className="mb-2">
            <FilterLabel>Custom range</FilterLabel>
          </div>
          <div className={`grid min-w-0 gap-2 sm:grid-cols-2 ${isCustom ? '' : 'opacity-60'}`}>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-600">Start</span>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={customStart}
                disabled={!isCustom}
                onChange={(event) =>
                  setState({ preset: 'custom', customStart: event.target.value })
                }
                className="min-h-9 min-w-0 w-full border border-ink-900 bg-white px-3 py-2 text-sm tabular disabled:cursor-not-allowed disabled:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-600">End</span>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={customEnd}
                disabled={!isCustom}
                onChange={(event) =>
                  setState({ preset: 'custom', customEnd: event.target.value })
                }
                className="min-h-9 min-w-0 w-full border border-ink-900 bg-white px-3 py-2 text-sm tabular disabled:cursor-not-allowed disabled:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
              />
            </label>
          </div>
        </div>

        {showDayType && (
          <div className="min-w-0 xl:col-span-3 xl:border-l xl:border-ink-200 xl:pl-5 xl:pr-5">
            <SegmentedControl
              label="Day type"
              options={DAY_TYPES}
              value={state.dayType}
              onChange={(dayType) => setState({ dayType })}
            />
          </div>
        )}

        <div className={`min-w-0 xl:border-l xl:border-ink-200 xl:pl-5 ${entryColumnClass}`}>
          <SegmentedControl
            label="Entry type"
            options={ENTRY_TYPES}
            value={state.entryType}
            onChange={(entryType) => setState({ entryType })}
          />
        </div>
      </div>
    </section>
  )
}
