import { useMemo, useState } from 'react'
import FilterBar from '../components/FilterBar'
import { FacilityDetailModal } from '../components/charts/FacilityDetailModal'
import { HourlyFacilityGrid } from '../components/charts/HourlyFacilityGrid'
import { HourlyProfileChart } from '../components/charts/HourlyProfileChart'
import type { SystemwideSummary } from '../components/charts/YoYDailyChart'
import { useDuckQuery } from '../hooks/useDuckQuery'
import { useUrlState } from '../hooks/useUrlState'
import { periodFromFilter, periodKey } from '../lib/alignment'
import { DATA_WINDOW } from '../lib/metadata'
import {
  queryClassSummary,
  queryGroupSummary,
  queryHourlyByClass,
  queryHourlyByGroup,
  queryHourlyYoY,
  querySystemwideSummary,
} from '../lib/queries'

export default function HourlyProfilesView() {
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
  const { dayType, entryType } = state
  const periodDeps = [rangeKey, entryType, dayType] as const

  // -------------------------------------------------------------------------
  // Systemwide hourly profile chart
  // -------------------------------------------------------------------------
  const { data: hourlyData, isLoading: hourlyLoading, error: hourlyError } = useDuckQuery(
    () => period ? queryHourlyYoY(period, entryType, dayType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )

  // Reuse the daily summary for the ChangeBadge — same aggregate totals.
  const { data: summaryRows } = useDuckQuery(
    () => period ? querySystemwideSummary(period, entryType, dayType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )
  const summary: SystemwideSummary | null = summaryRows.length
    ? (summaryRows[0] as SystemwideSummary)
    : null

  // -------------------------------------------------------------------------
  // Facility grid
  // -------------------------------------------------------------------------
  const { data: groupTimeData, isLoading: groupLoading, error: groupError } = useDuckQuery(
    () => period ? queryHourlyByGroup(period, entryType, dayType) : Promise.resolve([]),
    periodDeps,
    { enabled: hasValidPeriod },
  )

  // Reuse daily group summaries for the per-card ChangeBadges.
  const { data: groupAggData } = useDuckQuery(
    () => period ? queryGroupSummary(period, entryType, dayType) : Promise.resolve([]),
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
  const drawerDeps = [selectedGroup, rangeKey, entryType, dayType] as const

  const { data: classTimeData, isLoading: classLoading, error: classError } = useDuckQuery(
    () =>
      selectedGroup && period
        ? queryHourlyByClass(selectedGroup, period, entryType, dayType)
        : Promise.resolve([]),
    drawerDeps,
    { enabled: hasValidPeriod && Boolean(selectedGroup) },
  )

  const { data: classAggData } = useDuckQuery(
    () =>
      selectedGroup && period
        ? queryClassSummary(selectedGroup, period, entryType, dayType)
        : Promise.resolve([]),
    drawerDeps,
    { enabled: hasValidPeriod && Boolean(selectedGroup) },
  )

  return (
    <div>
      <FilterBar showDayType />

      {filterError && (
        <div className="mt-5 border border-signal-500 bg-white px-4 py-3 text-sm text-signal-600">
          {filterError}
        </div>
      )}

      <div className="mt-6 space-y-8">
        <section className="bg-white border border-ink-900">
          <header className="flex items-baseline justify-between px-5 py-3 border-b border-ink-900">
            <span className="eyebrow">Systemwide hourly profile</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>avg entries by hour</span>
          </header>
          <div className="p-5">
            <HourlyProfileChart
              data={hourlyData}
              summary={summary}
              isLoading={hourlyLoading}
              error={hourlyError}
            />
          </div>
        </section>

        <section>
          <div className="eyebrow mb-4">By detection group</div>
          <HourlyFacilityGrid
            timeData={groupTimeData}
            aggData={groupAggData}
            isLoading={groupLoading}
            error={groupError}
            onGroupClick={setSelectedGroup}
          />
        </section>
      </div>

      <FacilityDetailModal
        mode="hourly"
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
