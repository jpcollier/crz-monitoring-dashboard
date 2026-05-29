import { useMemo, useState } from 'react'
import FilterBar from '../components/FilterBar'
import StatCard from '../components/StatCard'
import { ClassBreakdownDrawer } from '../components/charts/ClassBreakdownDrawer'
import { DailyFacilityGrid } from '../components/charts/DailyFacilityGrid'
import { YoYDailyChart } from '../components/charts/YoYDailyChart'
import type { SystemwideSummary } from '../components/charts/YoYDailyChart'
import { useDuckQuery } from '../hooks/useDuckQuery'
import { useUrlState } from '../hooks/useUrlState'
import { comparablePeriod, toISODate } from '../lib/alignment'
import {
  queryClassSummary,
  queryDailyByClass,
  queryDailyByGroup,
  queryDailyYoY,
  queryGroupSummary,
  querySystemwideSummary,
} from '../lib/queries'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Abbreviate large numbers: 62_400_000 → "62.4M", 508_000 → "508K". */
function fmtStat(v: number): string {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${+(v / 1_000).toFixed(1)}K`
  return v.toLocaleString()
}

/** Render a % change value: decrease = indigo (good for CRZ goal), increase = signal red. */
function PctValue({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--fg-faint)' }}>—</span>
  const sign = pct >= 0 ? '+' : ''
  return (
    <span style={{ color: pct < 0 ? '#0E2A47' : '#C8102E' }}>
      {sign}{pct.toFixed(1)}%
    </span>
  )
}

export default function DailyEntriesView() {
  const [state] = useUrlState()
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  // today is fixed for the session — changes on next page load
  const today = useMemo(() => new Date(), [])

  const customRange = useMemo<[Date, Date] | undefined>(() => {
    if (state.preset !== 'custom' || !state.customStart || !state.customEnd) return undefined
    return [new Date(state.customStart), new Date(state.customEnd)]
  }, [state.preset, state.customStart, state.customEnd])

  const period = useMemo(
    () => comparablePeriod(today, state.preset, customRange),
    [today, state.preset, customRange],
  )

  // Stable dependency keys so useDuckQuery re-fetches exactly when filters change.
  const cs = toISODate(period.current[0])
  const ce = toISODate(period.current[1])
  const { entryType } = state
  const periodDeps = [cs, ce, entryType] as const

  // -------------------------------------------------------------------------
  // Systemwide YoY chart
  // -------------------------------------------------------------------------
  const { data: yoyData, isLoading: yoyLoading, error: yoyError } = useDuckQuery(
    () => queryDailyYoY(period, entryType),
    periodDeps,
  )

  const { data: summaryRows, isLoading: summaryLoading } = useDuckQuery(
    () => querySystemwideSummary(period, entryType),
    periodDeps,
  )
  const summary: SystemwideSummary | null = summaryRows.length
    ? (summaryRows[0] as SystemwideSummary)
    : null

  // YTD daily average: 2026 total ÷ number of distinct 2026 dates in the period
  const distinct2026Dates = useMemo(
    () => new Set(yoyData.filter(r => r.year === 2026).map(r => r.plot_date)).size,
    [yoyData],
  )
  const dailyAvg: number | null =
    summary && distinct2026Dates > 0 ? summary.current_entries / distinct2026Dates : null

  // -------------------------------------------------------------------------
  // Facility grid
  // -------------------------------------------------------------------------
  const { data: groupTimeData, isLoading: groupLoading, error: groupError } = useDuckQuery(
    () => queryDailyByGroup(period, entryType),
    periodDeps,
  )

  const { data: groupAggData } = useDuckQuery(
    () => queryGroupSummary(period, entryType),
    periodDeps,
  )

  // -------------------------------------------------------------------------
  // Class breakdown drawer — only fetches when a group is selected
  // -------------------------------------------------------------------------
  const drawerDeps = [selectedGroup, cs, ce, entryType] as const

  const { data: classTimeData, isLoading: classLoading, error: classError } = useDuckQuery(
    () =>
      selectedGroup
        ? queryDailyByClass(selectedGroup, period, entryType)
        : Promise.resolve([]),
    drawerDeps,
  )

  const { data: classAggData } = useDuckQuery(
    () =>
      selectedGroup
        ? queryClassSummary(selectedGroup, period, entryType)
        : Promise.resolve([]),
    drawerDeps,
  )

  const statsLoading = summaryLoading || yoyLoading

  return (
    <div>
      <FilterBar />

      {/* Summary stat row */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-px bg-ink-900 border border-ink-900">
        <StatCard
          label="YTD daily avg"
          value={dailyAvg !== null ? fmtStat(dailyAvg) : '—'}
          isLoading={statsLoading}
        />
        <StatCard
          label="2026 entries"
          value={summary ? fmtStat(summary.current_entries) : '—'}
          isLoading={statsLoading}
        />
        <StatCard
          label="Prior-year entries"
          value={summary ? fmtStat(summary.prior_entries) : '—'}
          isLoading={statsLoading}
        />
        <StatCard
          label="Change"
          value={<PctValue pct={summary?.pct_change ?? null} />}
          isLoading={statsLoading}
        />
      </div>

      <div className="mt-6 space-y-8">
        <section className="bg-white border border-ink-900">
          <header className="flex items-baseline justify-between px-5 py-3 border-b border-ink-900">
            <span className="eyebrow">Systemwide daily entries</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>2026 vs 2025</span>
          </header>
          <div className="p-5">
            <YoYDailyChart
              data={yoyData}
              summary={summary}
              isLoading={yoyLoading}
              error={yoyError}
            />
          </div>
        </section>

        <section>
          <div className="eyebrow mb-4">By detection group</div>
          <DailyFacilityGrid
            timeData={groupTimeData}
            aggData={groupAggData}
            isLoading={groupLoading}
            error={groupError}
            onGroupClick={setSelectedGroup}
          />
        </section>
      </div>

      <ClassBreakdownDrawer
        mode="daily"
        detectionGroup={selectedGroup}
        timeData={classTimeData}
        aggData={classAggData}
        isLoading={classLoading}
        error={classError}
        onClose={() => setSelectedGroup(null)}
      />
    </div>
  )
}
