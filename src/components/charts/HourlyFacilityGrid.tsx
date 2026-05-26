import * as Plot from '@observablehq/plot'
import { useEffect, useRef } from 'react'
import ChangeBadge from '../ChangeBadge'
import type { HourlyGroupRow, GroupAggRow } from '../../lib/queries'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for HourlyFacilityGrid.
 *
 * @param timeData    - One row per (hour × year × detection_group). Produced by
 *                      queryHourlyByGroup from src/lib/queries.ts. avg_entries is
 *                      SUM(entries) / COUNT(DISTINCT date) for the period.
 * @param aggData     - One row per detection_group with current_entries (2026
 *                      window total), prior_entries (2025), and pct_change.
 *                      Already ordered by current_entries DESC by the query.
 * @param isLoading   - Shows a skeleton grid of 12 placeholder cards while true.
 * @param error       - Renders a short inline error message when non-null.
 * @param onGroupClick - Called with the detection_group string when a card is
 *                       clicked. Typically opens ClassBreakdownDrawer.
 */
export interface HourlyFacilityGridProps {
  timeData: HourlyGroupRow[]
  aggData: GroupAggRow[]
  isLoading: boolean
  error: Error | null
  onGroupClick: (detectionGroup: string) => void
}

// ---------------------------------------------------------------------------
// Color constants — 2025 gray, 2026 blue (matches YoYDailyChart convention)
// ---------------------------------------------------------------------------
const COLOR_2025 = '#d1d5db' // gray-300  — prior year, intentionally recedes
const COLOR_2026 = '#3b82f6' // blue-500  — current year, brand accent

// ---------------------------------------------------------------------------
// Hour label helper
// ---------------------------------------------------------------------------

function fmtHour(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/** Abbreviate large counts: 500000 → "500K", 1500000 → "1.5M". */
const fmtCount = (v: number): string => {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`
  return String(Math.round(v))
}

// ---------------------------------------------------------------------------
// Single-card mini chart
// ---------------------------------------------------------------------------

interface FacilityCardProps {
  group: string
  pctChange: number | null
  rows: HourlyGroupRow[]
  onClick: () => void
}

function FacilityCard({ group, pctChange, rows, onClick }: FacilityCardProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return
    if (rows.length === 0) return

    const plot = Plot.plot({
      width: chartRef.current.clientWidth || 280,
      height: 120,
      marginTop: 8,
      marginRight: 8,
      marginBottom: 24,
      marginLeft: 42,
      style: { background: 'transparent', overflow: 'visible' },
      x: {
        type: 'linear',
        domain: [0, 23],
        ticks: [0, 6, 12, 18, 23],
        tickFormat: fmtHour,
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
        Plot.lineY(rows, {
          x: 'hour',
          y: 'avg_entries',
          stroke: 'year',
          strokeWidth: (d: HourlyGroupRow) => (d.year === 2026 ? 2 : 1),
          curve: 'monotone-x',
        }),
        ...(() => {
          const lookup25 = new Map(rows.filter(r => r.year === 2025).map(r => [r.hour, r.avg_entries]))
          const lookup26 = new Map(rows.filter(r => r.year === 2026).map(r => [r.hour, r.avg_entries]))
          const wide = Array.from({ length: 24 }, (_, h) => ({
            hour: h, e26: lookup26.get(h) ?? null, e25: lookup25.get(h) ?? null,
          }))
          return [
            Plot.ruleX(wide, Plot.pointerX({ x: 'hour', stroke: '#9ca3af', strokeWidth: 1 })),
            Plot.dot(wide, Plot.pointerX({ x: 'hour', y: (d) => d.e25, fill: COLOR_2025, stroke: 'white', strokeWidth: 1.5, r: 3 })),
            Plot.dot(wide, Plot.pointerX({ x: 'hour', y: (d) => d.e26, fill: COLOR_2026, stroke: 'white', strokeWidth: 1.5, r: 3.5 })),
          ]
        })(),
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
        <span className="text-xs font-semibold text-gray-700 leading-tight truncate">
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

export function HourlyFacilityGrid({
  timeData,
  aggData,
  isLoading,
  error,
  onGroupClick,
}: HourlyFacilityGridProps) {
  // --- Loading state -------------------------------------------------------
  if (isLoading) {
    return (
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        aria-label="Loading facility hourly charts"
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
        Failed to load facility hourly data: {error.message}
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
  const rowsByGroup = new Map<string, HourlyGroupRow[]>()
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
      aria-label="Facility hourly profile charts"
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
