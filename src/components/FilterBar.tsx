import { useUrlState } from '../hooks/useUrlState'
import type { EntryType, PeriodPreset } from '../lib/types'

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

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

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
    <div className="inline-flex rounded-lg bg-gray-100 p-1 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-1.5 text-sm rounded-md transition-colors ${
            value === opt.value
              ? 'bg-gray-800 text-white font-medium shadow-sm'
              : 'text-gray-500 hover:text-gray-800 font-normal'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Label above a control group
// ---------------------------------------------------------------------------

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 leading-none">
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export default function FilterBar() {
  const [state, setState] = useUrlState()

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-8">

        {/* Period preset */}
        <div className="flex flex-col gap-2">
          <FilterLabel>Period</FilterLabel>
          <SegmentedControl
            options={PRESETS}
            value={state.preset}
            onChange={(preset) => setState({ preset })}
          />
        </div>

        {/* Custom date range — only shown when preset === 'custom' */}
        {state.preset === 'custom' && (
          <div className="flex flex-col gap-2">
            <FilterLabel>Date range</FilterLabel>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={state.customStart ?? ''}
                onChange={(e) => setState({ customStart: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white
                           focus:outline-none focus:ring-2 focus:ring-gray-800/20 focus:border-gray-400
                           transition-colors"
              />
              <span className="text-gray-300 select-none">—</span>
              <input
                type="date"
                value={state.customEnd ?? ''}
                onChange={(e) => setState({ customEnd: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white
                           focus:outline-none focus:ring-2 focus:ring-gray-800/20 focus:border-gray-400
                           transition-colors"
              />
            </div>
          </div>
        )}

        {/* Vertical divider between the two groups */}
        <div className="hidden sm:block self-stretch w-px bg-gray-100" />

        {/* Entry type */}
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
