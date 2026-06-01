import { useMemo, useState } from 'react'
import FilterBar from '../components/FilterBar'
import StatCard from '../components/StatCard'
import { DailyFacilityGrid } from '../components/charts/DailyFacilityGrid'
import { FacilityDetailModal } from '../components/charts/FacilityDetailModal'
import { YoYDailyChart } from '../components/charts/YoYDailyChart'
import type { SystemwideSummary } from '../components/charts/YoYDailyChart'
import { useDuckQuery } from '../hooks/useDuckQuery'
import { useUrlState } from '../hooks/useUrlState'
import { periodFromFilter, periodKey } from '../lib/alignment'
import { DATA_WINDOW } from '../lib/metadata'
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

  const periodResult = useMemo(
    () => periodFromFilter(DATA_WINDOW, state),
    [state],
  )
  const { period, error: filterError } = periodResult
  const hasValidPeriod = Boolean(period)

  // Stable dependency keys so useDuckQuery re-fetches exactly when filters change.
  const rangeKey = period ? periodKey(period) : ''
  const { entryType } = state
  const periodDeps = [rangeKey, entryType] as const

  // -------------------------------------------------------------------------
  // Systemwide YoY chart
  // -------------------------------------------------------------------------
  const { data: yoyData, isLoading: yoyLoading, error: yoyError } = useDuckQuery(
    () => period ? queryDailyYoY(period, entryType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )

  const { data: summaryRows, isLoading: summaryLoading } = useDuckQuery(
    () => period ? querySystemwideSummary(period, entryType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )
  const summary: SystemwideSummary | null = summaryRows.length
    ? (summaryRows[0] as SystemwideSummary)
    : null

  // Period daily average: 2026 total divided by distinct 2026 dates in the period.
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
    () => period ? queryDailyByGroup(period, entryType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )

  const { data: groupAggData } = useDuckQuery(
    () => period ? queryGroupSummary(period, entryType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )

  const selectedGroupRows = useMemo(
    () => selectedGroup
      ? groupTimeData.filter((row) => row.detection_group === selectedGroup)
      : [],
    [groupTimeData, selectedGroup],
  )

  const selectedGroupSummary = useMemo(
    () => selectedGroup
      ? groupAggData.find((row) => row.detection_group === selectedGroup) ?? null
      : null,
    [groupAggData, selectedGroup],
  )

  // -------------------------------------------------------------------------
  // Class breakdown drawer — only fetches when a group is selected
  // -------------------------------------------------------------------------
  const drawerDeps = [selectedGroup, rangeKey, entryType] as const

  const { data: classTimeData, isLoading: classLoading, error: classError } = useDuckQuery(
    () =>
      selectedGroup && period
        ? queryDailyByClass(selectedGroup, period, entryType)
        : Promise.resolve([]),
    drawerDeps,
    { enabled: hasValidPeriod && Boolean(selectedGroup) },
  )

  const { data: classAggData } = useDuckQuery(
    () =>
      selectedGroup && period
        ? queryClassSummary(selectedGroup, period, entryType)
        : Promise.resolve([]),
    drawerDeps,
    { enabled: hasValidPeriod && Boolean(selectedGroup) },
  )

  const statsLoading = summaryLoading || yoyLoading

  return (
    <div>
      <FilterBar />

      {filterError && (
        <div className="mt-5 border border-signal-500 bg-white px-4 py-3 text-sm text-signal-600">
          {filterError}
        </div>
      )}

      {/* Summary stat row */}
      <div className="mt-5 grid grid-cols-2 gap-px border border-ink-900 bg-ink-900 sm:grid-cols-4">
        <StatCard
          label="Daily avg"
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
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-900 px-4 py-3 sm:px-5">
            <span className="eyebrow">Systemwide daily entries</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>2026 vs 2025</span>
          </header>
          <div className="p-4 sm:p-5">
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

      <FacilityDetailModal
        mode="daily"
        detectionGroup={selectedGroup}
        groupRows={selectedGroupRows}
        groupSummary={selectedGroupSummary}
        isGroupLoading={groupLoading}
        groupError={groupError}
        classRows={classTimeData}
        classAggRows={classAggData}
        isClassLoading={classLoading}
        classError={classError}
        onClose={() => setSelectedGroup(null)}
      />
    </div>
  )
}
