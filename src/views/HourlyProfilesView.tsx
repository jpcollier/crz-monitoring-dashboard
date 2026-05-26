import { useMemo, useState } from 'react'
import FilterBar from '../components/FilterBar'
import { ClassBreakdownDrawer } from '../components/charts/ClassBreakdownDrawer'
import { HourlyFacilityGrid } from '../components/charts/HourlyFacilityGrid'
import { HourlyProfileChart } from '../components/charts/HourlyProfileChart'
import type { SystemwideSummary } from '../components/charts/YoYDailyChart'
import { useDuckQuery } from '../hooks/useDuckQuery'
import { useUrlState } from '../hooks/useUrlState'
import { comparablePeriod, toISODate } from '../lib/alignment'
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
  // Systemwide hourly profile chart
  // -------------------------------------------------------------------------
  const { data: hourlyData, isLoading: hourlyLoading, error: hourlyError } = useDuckQuery(
    () => queryHourlyYoY(period, entryType),
    periodDeps,
  )

  // Reuse the daily summary for the ChangeBadge — same aggregate totals.
  const { data: summaryRows } = useDuckQuery(
    () => querySystemwideSummary(period, entryType),
    periodDeps,
  )
  const summary: SystemwideSummary | null = summaryRows.length
    ? (summaryRows[0] as SystemwideSummary)
    : null

  // -------------------------------------------------------------------------
  // Facility grid
  // -------------------------------------------------------------------------
  const { data: groupTimeData, isLoading: groupLoading, error: groupError } = useDuckQuery(
    () => queryHourlyByGroup(period, entryType),
    periodDeps,
  )

  // Reuse daily group summaries for the per-card ChangeBadges.
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
        ? queryHourlyByClass(selectedGroup, period, entryType)
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

  return (
    <div>
      <FilterBar />

      <div className="mt-8 space-y-10">
        <section>
          <h2 className="text-[13px] font-semibold text-gray-600 tracking-wide mb-4">Systemwide hourly profile</h2>
          <HourlyProfileChart
            data={hourlyData}
            summary={summary}
            isLoading={hourlyLoading}
            error={hourlyError}
          />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-gray-600 tracking-wide mb-4">By detection group</h2>
          <HourlyFacilityGrid
            timeData={groupTimeData}
            aggData={groupAggData}
            isLoading={groupLoading}
            error={groupError}
            onGroupClick={setSelectedGroup}
          />
        </section>
      </div>

      <ClassBreakdownDrawer
        mode="hourly"
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
