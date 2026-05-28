import * as Plot from '@observablehq/plot'
import { useEffect, useRef } from 'react'
import ChangeBadge from '../ChangeBadge'
import type { DailyGroupTimeRow, GroupAggRow } from '../../lib/queries'
import { COLOR_2025, COLOR_2026, buildDailyHoverRows, chartHoverMarks, fmtCount } from './chartHover'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for DailyFacilityGrid.
 *
 * @param timeData  - One row per (plot_date × year × detection_group). plot_date
 *                    is always 2026-era (YYYY-MM-DD string). Provided by
 *                    queryDailyByGroup from src/lib/queries.ts.
 * @param aggData   - One row per detection_group with current_entries (2026
 *                    window total), prior_entries (2025), and pct_change.
 *                    Already ordered by current_entries DESC by the query.
 * @param isLoading - Shows a skeleton grid of 12 placeholder cards while true.
 * @param error     - Renders a short inline error message when non-null.
 * @param onGroupClick - Called with the detection_group string when a card is
 *                       clicked. Typically opens ClassBreakdownDrawer.
 */
export interface DailyFacilityGridProps {
  timeData: DailyGroupTimeRow[]
  aggData: GroupAggRow[]
  isLoading: boolean
  error: Error | null
  onGroupClick: (detectionGroup: string) => void
}

// ---------------------------------------------------------------------------
// Single-card mini chart
// ---------------------------------------------------------------------------

interface FacilityCardProps {
  group: string
  pctChange: number | null
  rows: DailyGroupTimeRow[]
  onClick: () => void
}

function FacilityCard({ group, pctChange, rows, onClick }: FacilityCardProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return
    if (rows.length === 0) return

    const parsed = rows.map(r => ({ ...r, date: new Date(r.plot_date) }))

    // Adaptive ticks: narrow cards can't fit many labels, so cap at 4 for short
    // ranges and fall back to monthly for YTD/custom.
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const fmtMonthDay = (d: Date) => `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`
    const fmtMonth    = (d: Date) => MONTHS_SHORT[d.getUTCMonth()]
    const times = parsed.map(r => r.date.getTime())
    const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0
    const xTicks      = spanDays > 60 ? ('month' as const) : 4
    const xTickFormat = spanDays > 60 ? fmtMonth : fmtMonthDay

    const plot = Plot.plot({
      width: chartRef.current.clientWidth || 280,
      height: 120,
      marginTop: 8,
      marginRight: 8,
      marginBottom: 24,
      marginLeft: 42,
      style: { background: 'transparent', overflow: 'visible' },
      x: {
        type: 'utc',
        ticks: xTicks,
        tickFormat: xTickFormat,
        label: null,
      },
      y: {
        ticks: 2,
        label: null,
        grid: false,
        tickFormat: fmtCount,
      },
      color: {
        domain: [2025, 2026],
        range: [COLOR_2025, COLOR_2026],
      },
      marks: [
        Plot.lineY(parsed, {
          x: 'date',
          y: 'entries',
          stroke: 'year',
          strokeWidth: (d: { year: number }) => (d.year === 2026 ? 2 : 1),
          curve: 'monotone-x',
        }),
        ...chartHoverMarks(buildDailyHoverRows(parsed, (r) => r.entries), 'date', { r2025: 3, r2026: 3.5 }),
      ],
    })

    chartRef.current.appendChild(plot)

    return () => {
      plot.remove()
    }
  }, [rows])

  const has2026 = rows.some(r => r.year === 2026)
  const has2025 = rows.some(r => r.year === 2025)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
      className="
        bg-white rounded-lg border border-gray-200 p-3
        cursor-pointer
        transition-shadow
        hover:ring-2 hover:ring-blue-400 hover:ring-offset-1
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
      "
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-700 leading-tight">
          {group}
        </span>
        <ChangeBadge pctChange={pctChange} />
      </div>

      {/* Chart area */}
      {rows.length === 0 ? (
        <div className="flex items-center justify-center h-[120px] text-xs text-gray-400">
          No data
        </div>
      ) : (
        <>
          <div ref={chartRef} className="w-full" />
          {has2026 && !has2025 && (
            <p className="mt-1 text-[10px] text-gray-400 leading-tight">
              No prior-year data for this period
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 animate-pulse">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="h-3 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-10" />
      </div>
      <div className="h-[120px] bg-gray-100 rounded mt-2" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DailyFacilityGrid({
  timeData,
  aggData,
  isLoading,
  error,
  onGroupClick,
}: DailyFacilityGridProps) {
  // --- Loading state -------------------------------------------------------
  if (isLoading) {
    return (
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        aria-label="Loading facility charts"
        aria-busy="true"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          // reason: index is stable for skeleton placeholders
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  // --- Error state ---------------------------------------------------------
  if (error) {
    return (
      <p className="text-sm text-red-600 py-4">
        Failed to load facility data: {error.message}
      </p>
    )
  }

  // --- Empty state ---------------------------------------------------------
  if (aggData.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        No facility data available for the selected period.
      </p>
    )
  }

  // --- Build per-group lookup for fast slicing -----------------------------
  const rowsByGroup = new Map<string, DailyGroupTimeRow[]>()
  for (const row of timeData) {
    const list = rowsByGroup.get(row.detection_group)
    if (list) {
      list.push(row)
    } else {
      rowsByGroup.set(row.detection_group, [row])
    }
  }

  // aggData is already sorted by current_entries DESC from the query.
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
      aria-label="Facility entry charts"
    >
      {aggData.map(agg => (
        <FacilityCard
          key={agg.detection_group}
          group={agg.detection_group}
          pctChange={agg.pct_change}
          rows={rowsByGroup.get(agg.detection_group) ?? []}
          onClick={() => onGroupClick(agg.detection_group)}
        />
      ))}
    </div>
  )
}
