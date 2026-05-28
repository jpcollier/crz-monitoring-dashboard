import * as Plot from '@observablehq/plot'
import { useEffect, useRef } from 'react'
import ChangeBadge from '../ChangeBadge'
import type { DailyClassTimeRow, ClassAggRow, HourlyClassRow } from '../../lib/queries'
import { COLOR_2025, COLOR_2026, buildDailyHoverRows, buildHourlyHoverRows, chartHoverMarks, fmtCount, fmtHour } from './chartHover'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for ClassBreakdownDrawer.
 *
 * @param mode - 'daily' renders a YoY time-series per class; 'hourly' renders
 *   a 0–23 hourly profile per class.
 * @param detectionGroup - Facility name; null hides the drawer (stays mounted
 *   so the close animation plays).
 * @param timeData - For daily mode: DailyClassTimeRow[]. For hourly mode: HourlyClassRow[].
 * @param aggData - One row per vehicle_class with current/prior totals + pct_change.
 * @param isLoading - Shows skeleton cards while true.
 * @param error - Shows inline error message when non-null.
 * @param onClose - Called on close button click or backdrop click.
 */
export interface ClassBreakdownDrawerProps {
  mode: 'daily' | 'hourly'
  detectionGroup: string | null
  timeData: DailyClassTimeRow[] | HourlyClassRow[]
  aggData: ClassAggRow[]
  isLoading: boolean
  error: Error | null
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Single vehicle-class card — renders daily time-series or hourly profile
// ---------------------------------------------------------------------------

interface ClassCardProps {
  vehicleClass: string
  pctChange: number | null
  mode: 'daily' | 'hourly'
  rows: DailyClassTimeRow[] | HourlyClassRow[]
}

function ClassCard({ vehicleClass, pctChange, mode, rows }: ClassCardProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return
    if (rows.length === 0) return

    const width = chartRef.current.clientWidth || 372
    const commonOpts = {
      width,
      height: 100,
      marginTop: 6,
      marginRight: 8,
      marginBottom: 22,
      marginLeft: 42,
      style: { background: 'transparent', overflow: 'visible' } as CSSStyleDeclaration,
      color: { domain: [2025, 2026], range: [COLOR_2025, COLOR_2026] },
      y: { ticks: 2, label: null as string | null, grid: false, tickFormat: fmtCount },
    }

    // reason: Plot.plot() returns `(HTMLElement | SVGSVGElement) & Plot` depending
    // on the mark types; we use ReturnType to stay type-safe without over-specifying.
    let plot: ReturnType<typeof Plot.plot>

    if (mode === 'daily') {
      const dailyRows = rows as DailyClassTimeRow[]
      const parsed = dailyRows.map(r => ({ ...r, date: new Date(r.plot_date) }))
      const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const fmtMD = (d: Date) => `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`
      const fmtM  = (d: Date) => MONTHS_SHORT[d.getUTCMonth()]
      const times = parsed.map(r => r.date.getTime())
      const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0
      const xTicks      = spanDays > 60 ? ('month' as const) : 4
      const xTickFormat = spanDays > 60 ? fmtM : fmtMD
      plot = Plot.plot({
        ...commonOpts,
        x: { type: 'utc', ticks: xTicks, tickFormat: xTickFormat, label: null },
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
    } else {
      const hourlyRows = rows as HourlyClassRow[]
      plot = Plot.plot({
        ...commonOpts,
        x: {
          type: 'linear',
          domain: [0, 23],
          ticks: [0, 6, 12, 18, 23],
          tickFormat: fmtHour,
          label: null,
        },
        marks: [
          Plot.lineY(hourlyRows, {
            x: 'hour',
            y: 'avg_entries',
            stroke: 'year',
            strokeWidth: (d: { year: number }) => (d.year === 2026 ? 2 : 1),
            curve: 'monotone-x',
          }),
          ...chartHoverMarks(buildHourlyHoverRows(hourlyRows, (r) => r.avg_entries), 'hour', { r2025: 3, r2026: 3.5 }),
        ],
      })
    }

    chartRef.current.appendChild(plot)
    return () => { plot.remove() }
  }, [rows, mode])

  const has2026 = rows.some(r => r.year === 2026)
  const has2025 = rows.some(r => r.year === 2025)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-700 leading-tight truncate">
          {vehicleClass}
        </span>
        <ChangeBadge pctChange={pctChange} />
      </div>

      {/* Chart area */}
      {rows.length === 0 ? (
        <div className="flex items-center justify-center h-[100px] text-xs text-gray-400">
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
// Skeleton card for loading state
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 animate-pulse">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="h-3 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-10 shrink-0" />
      </div>
      <div className="h-[100px] bg-gray-100 rounded mt-2" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main drawer component
// ---------------------------------------------------------------------------

export function ClassBreakdownDrawer({
  mode,
  detectionGroup,
  timeData,
  aggData,
  isLoading,
  error,
  onClose,
}: ClassBreakdownDrawerProps) {
  const isOpen = detectionGroup !== null

  // Build per-class lookup so each ClassCard only receives its own rows.
  const rowsByClass = new Map<string, DailyClassTimeRow[] | HourlyClassRow[]>()
  for (const row of timeData) {
    const list = rowsByClass.get(row.vehicle_class)
    if (list) {
      list.push(row as never)
    } else {
      rowsByClass.set(row.vehicle_class, [row] as DailyClassTimeRow[] | HourlyClassRow[])
    }
  }

  return (
    <>
      {/* Backdrop — rendered behind drawer, only interactive when open */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={[
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-200',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={
          detectionGroup
            ? `Vehicle class breakdown — ${detectionGroup}`
            : 'Vehicle class breakdown'
        }
        className={[
          'fixed top-0 right-0 z-50 h-full w-[420px] bg-gray-50 shadow-xl',
          'flex flex-col',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
          <h2 className="text-sm font-semibold text-gray-800 leading-snug truncate">
            Vehicle class breakdown
            {detectionGroup && (
              <span className="block text-xs font-normal text-gray-500 truncate">
                {detectionGroup}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="
              shrink-0 flex items-center justify-center
              w-7 h-7 rounded
              text-gray-500 hover:text-gray-800
              hover:bg-gray-100
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              transition-colors
            "
          >
            <span aria-hidden="true" className="text-base leading-none">
              &times;
            </span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Loading state */}
          {isLoading && (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                // reason: index is stable for skeleton placeholders
                <SkeletonCard key={i} />
              ))}
            </>
          )}

          {/* Error state */}
          {!isLoading && error && (
            <p className="text-sm text-red-600 py-2">
              Failed to load class data: {error.message}
            </p>
          )}

          {/* Empty state */}
          {!isLoading && !error && aggData.length === 0 && (
            <p className="text-sm text-gray-500 py-2">No class data available.</p>
          )}

          {/* Class cards — aggData is ordered by current_entries DESC from the query */}
          {!isLoading &&
            !error &&
            aggData.map(agg => (
              <ClassCard
                key={agg.vehicle_class}
                vehicleClass={agg.vehicle_class}
                pctChange={agg.pct_change}
                mode={mode}
                rows={rowsByClass.get(agg.vehicle_class) ?? []}
              />
            ))}
        </div>

        {/* Legend footer */}
        {!isLoading && !error && aggData.length > 0 && (
          <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-gray-200 bg-white">
            <LegendItem color={COLOR_2026} label="2026" />
            <LegendItem color={COLOR_2025} label="2025" />
          </div>
        )}
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// Small legend item used in the footer
// ---------------------------------------------------------------------------

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-600">
      <span
        aria-hidden="true"
        className="inline-block w-5 h-[2px] rounded"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
