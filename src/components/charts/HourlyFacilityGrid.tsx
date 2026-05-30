import * as Plot from '@observablehq/plot'
import { useEffect, useRef, useState } from 'react'
import ChangeBadge from '../ChangeBadge'
import type { HourlyGroupRow, GroupAggRow } from '../../lib/queries'
import {
  COLOR_2025,
  COLOR_2026,
  buildHourlyHoverRows,
  chartHoverMarks,
  fmtCount,
  fmtHour,
  formatHoverReadout,
  type HourlyHoverRow,
  type HoverReadout as HoverInfo,
} from './chartHover'

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
 *                       clicked. Typically opens FacilityDetailModal.
 */
export interface HourlyFacilityGridProps {
  timeData: HourlyGroupRow[]
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
  rows: HourlyGroupRow[]
  onClick: () => void
}

function FacilityCard({ group, pctChange, rows, onClick }: FacilityCardProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)

  useEffect(() => {
    if (!chartRef.current) return
    if (rows.length === 0) return

    const hoverRows = buildHourlyHoverRows(rows, (r) => r.avg_entries)

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
        ...chartHoverMarks(hoverRows, 'hour', { r2025: 3, r2026: 3.5 }),
      ],
    })

    chartRef.current.appendChild(plot)

    const handleInput = () => {
      const datum = plot.value as HourlyHoverRow | null
      setHoverInfo(datum ? formatHoverReadout(datum, { valueFormatter: (value) => fmtCount(Math.round(value)) }) : null)
    }
    plot.addEventListener('input', handleInput)

    return () => {
      plot.removeEventListener('input', handleInput)
      plot.remove()
      setHoverInfo(null)
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
      className="bg-white border border-ink-900 p-3 cursor-pointer transition-colors hover:bg-paper-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
      style={{ transition: 'background var(--dur-fast) var(--ease-standard)' }}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span
          className="text-xs font-semibold leading-tight truncate"
          style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)' }}
        >
          {group}
        </span>
        <ChangeBadge pctChange={pctChange} />
      </div>

      {/* Chart area */}
      {rows.length === 0 ? (
        <div
          className="flex items-center justify-center h-[120px] text-xs"
          style={{ color: 'var(--fg-faint)' }}
        >
          No data
        </div>
      ) : (
        <>
          <div ref={chartRef} className="w-full" />
          <div
            className="pointer-events-none h-5 flex items-center gap-1.5 px-1 select-none whitespace-nowrap overflow-hidden"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)' }}
          >
            {hoverInfo && (
              <>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{hoverInfo.timeLabel}</span>
                <span style={{ color: 'var(--rule-soft)' }} aria-hidden="true">·</span>
                <span><span style={{ color: 'var(--accent)', fontWeight: 600 }}>2026</span>: {hoverInfo.value2026Label ?? '—'}</span>
                <span style={{ color: 'var(--rule-soft)' }} aria-hidden="true">·</span>
                <span><span style={{ color: 'var(--fg-faint)' }}>2025</span>: {hoverInfo.value2025Label ?? '—'}</span>
                {hoverInfo.delta !== null && (
                  <>
                    <span style={{ color: 'var(--rule-soft)' }} aria-hidden="true">·</span>
                    <span style={{ color: hoverInfo.delta < 0 ? '#0E2A47' : '#C8102E' }}>
                      {`${hoverInfo.deltaLabel}${hoverInfo.deltaPctLabel ? ` (${hoverInfo.deltaPctLabel})` : ''}`}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {has2026 && !has2025 && (
            <p className="mt-1 text-[10px] leading-tight" style={{ color: 'var(--fg-faint)' }}>
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
    <div className="bg-white border border-ink-900 p-3 animate-pulse">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="h-3 bg-paper-200 w-3/4" />
        <div className="h-4 bg-paper-200 w-10" />
      </div>
      <div className="h-[120px] bg-paper-100 mt-2" />
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
      <p className="text-sm py-4" style={{ color: 'var(--accent)' }}>
        Failed to load facility hourly data: {error.message}
      </p>
    )
  }

  // --- Empty state ---------------------------------------------------------
  if (aggData.length === 0) {
    return (
      <p className="text-sm py-4" style={{ color: 'var(--fg-muted)' }}>
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
