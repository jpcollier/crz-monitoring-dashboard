import { type ReactNode, useMemo } from 'react'
import { useUrlState } from '../hooks/useUrlState'
import { comparablePeriod, toISODate } from '../lib/alignment'
import type { DayType, EntryType, PeriodPreset } from '../lib/types'

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'ytd',        label: 'Year to date' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_week',  label: 'Last week' },
  { value: 'custom',     label: 'Custom' },
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
    <div className="inline-flex border border-ink-900">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors cursor-pointer ${
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
  const [state, setState] = useUrlState()
  const today = useMemo(() => new Date(), [])

  function handlePresetChange(preset: PeriodPreset) {
    if (preset !== 'custom') {
      setState({ preset })
      return
    }

    if (state.customStart && state.customEnd) {
      setState({ preset })
      return
    }

    const defaultPeriod = comparablePeriod(today, 'last_week')
    setState({
      preset,
      customStart: toISODate(defaultPeriod.current[0]),
      customEnd: toISODate(defaultPeriod.current[1]),
    })
  }

  return (
    <div className="bg-white border border-ink-900 px-6 py-5">
      <div className="flex flex-wrap items-center gap-8">

        <div className="flex flex-col gap-2">
          <FilterLabel>Period</FilterLabel>
          <SegmentedControl
            options={PRESETS}
            value={state.preset}
            onChange={handlePresetChange}
          />
        </div>

        {state.preset === 'custom' && (
          <div className="flex flex-col gap-2">
            <FilterLabel>Date range</FilterLabel>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={state.customStart ?? ''}
                onChange={(e) => setState({ customStart: e.target.value })}
                className="border border-ink-900 px-3 py-2 text-sm text-ink-900 bg-white font-mono
                           focus:outline-none focus:ring-2 focus:ring-ink-900/20
                           transition-colors"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13, borderRadius: 2 }}
              />
              <span className="text-ink-400 select-none">—</span>
              <input
                type="date"
                value={state.customEnd ?? ''}
                onChange={(e) => setState({ customEnd: e.target.value })}
                className="border border-ink-900 px-3 py-2 text-sm text-ink-900 bg-white
                           focus:outline-none focus:ring-2 focus:ring-ink-900/20
                           transition-colors"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13, borderRadius: 2 }}
              />
            </div>
          </div>
        )}

        {showDayType && (
          <>
            <div className="hidden sm:block self-stretch w-px bg-ink-200" />
            <div className="flex flex-col gap-2">
              <FilterLabel>Day type</FilterLabel>
              <SegmentedControl
                options={DAY_TYPES}
                value={state.dayType}
                onChange={(dayType) => setState({ dayType })}
              />
            </div>
          </>
        )}

        <div className="hidden sm:block self-stretch w-px bg-ink-200" />

        <div className="flex flex-col gap-2">
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
