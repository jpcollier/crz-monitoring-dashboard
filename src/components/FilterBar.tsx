import { type ReactNode } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { toISODate } from '../lib/alignment'
import { DATA_WINDOW, formatDisplayDate } from '../lib/metadata'
import type { DayType, EntryType, FilterState, PeriodPreset } from '../lib/types'

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
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex w-full overflow-x-auto border border-ink-900 sm:inline-flex sm:w-auto"
    >
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
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
  return <span className="eyebrow">{children}</span>
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FilterLabel>{label}</FilterLabel>
      {children}
    </div>
  )
}

/** Vertical rule between groups on desktop; collapses on stacked layouts. */
function GroupDivider() {
  return <div className="hidden self-stretch w-px bg-ink-200 lg:block" />
}

function CustomDateRange({
  state,
  setState,
  minDate,
  maxDate,
  currentEndLabel,
}: {
  state: FilterState
  setState: (next: Partial<FilterState>) => void
  minDate: string
  maxDate: string
  currentEndLabel: string
}) {
  return (
    <div className="mt-4 border-t border-ink-200 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
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
            className="min-h-9 border border-ink-900 bg-white px-3 py-2 text-sm tabular"
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
            className="min-h-9 border border-ink-900 bg-white px-3 py-2 text-sm tabular"
          />
        </label>
        <p className="text-xs leading-snug text-ink-600 sm:max-w-44 sm:pb-2.5">
          2026 data available through {currentEndLabel}
        </p>
      </div>
    </div>
  )
}

export default function FilterBar({ showDayType = false }: { showDayType?: boolean }) {
  const [state, setState] = useUrlState(DATA_WINDOW)
  const minDate = toISODate(DATA_WINDOW.currentStart)
  const maxDate = toISODate(DATA_WINDOW.currentEnd)
  const currentEndLabel = formatDisplayDate(maxDate)

  // Switching to Custom with empty inputs would immediately fail validation, so
  // prefill the full available window as a valid, editable starting range.
  const handlePresetChange = (preset: PeriodPreset) => {
    if (preset === 'custom' && !(state.customStart && state.customEnd)) {
      setState({
        preset: 'custom',
        customStart: state.customStart ?? minDate,
        customEnd: state.customEnd ?? maxDate,
      })
      return
    }
    setState({ preset })
  }

  return (
    <div className="bg-white border border-ink-900 px-4 py-4 sm:px-6 sm:py-5">
      {/* Tier 1 — primary controls. Fixed height: never reflows when Custom toggles. */}
      <div className="grid gap-4 lg:flex lg:flex-wrap lg:items-start lg:gap-8">
        <FilterGroup label="Period">
          <SegmentedControl
            ariaLabel="Period"
            options={PRESETS}
            value={state.preset}
            onChange={handlePresetChange}
          />
        </FilterGroup>

        {showDayType && (
          <>
            <GroupDivider />
            <FilterGroup label="Day type">
              <SegmentedControl
                ariaLabel="Day type"
                options={DAY_TYPES}
                value={state.dayType}
                onChange={(dayType) => setState({ dayType })}
              />
            </FilterGroup>
          </>
        )}

        <GroupDivider />

        <FilterGroup label="Entry type">
          <SegmentedControl
            ariaLabel="Entry type"
            options={ENTRY_TYPES}
            value={state.entryType}
            onChange={(entryType) => setState({ entryType })}
          />
        </FilterGroup>
      </div>

      {/* Tier 2 — custom date range. Full-width reveal below Tier 1; only adds height. */}
      {state.preset === 'custom' && (
        <CustomDateRange
          state={state}
          setState={setState}
          minDate={minDate}
          maxDate={maxDate}
          currentEndLabel={currentEndLabel}
        />
      )}
    </div>
  )
}
