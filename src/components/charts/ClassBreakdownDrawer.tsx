import * as Plot from '@observablehq/plot'
import { useEffect, useRef, useState } from 'react'
import ChangeBadge from '../ChangeBadge'
import type { DailyClassTimeRow, ClassAggRow, HourlyClassRow } from '../../lib/queries'
import {
  COLOR_2025,
  COLOR_2026,
  chartHoverMarks,
  fmtCount,
  fmtHour,
  formatHoverReadout,
  type ChartHoverRow,
  type HoverReadout,
} from './chartHover'

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


interface ParsedDailyClassTimeRow extends DailyClassTimeRow {
  date: Date
}

type ClassDailyHoverRow = ChartHoverRow & {
  date: Date
  plot_date: string
  entries2026: number | null
  entries2025: number | null
  value2026: number | null
  value2025: number | null
}

type ClassHourlyHoverRow = ChartHoverRow & {
  hour: number
  avg2026: number | null
  avg2025: number | null
  value2026: number | null
  value2025: number | null
}

function buildClassDailyHoverRows(
  rows2026: ParsedDailyClassTimeRow[],
  rows2025: ParsedDailyClassTimeRow[],
): ClassDailyHoverRow[] {
  const entries2025ByPlotDate = new Map(rows2025.map((row) => [row.plot_date, row.entries]))

  return rows2026.map((row) => {
    const entries2025 = entries2025ByPlotDate.get(row.plot_date) ?? null

    return {
      date: row.date,
      plot_date: row.plot_date,
      entries2026: row.entries,
      entries2025,
      value2026: row.entries,
      value2025: entries2025,
    }
  })
}

function buildClassHourlyHoverRows(
  rows2026: HourlyClassRow[],
  rows2025: HourlyClassRow[],
): ClassHourlyHoverRow[] {
  const avg2026ByHour = new Map(rows2026.map((row) => [row.hour, row.avg_entries]))
  const avg2025ByHour = new Map(rows2025.map((row) => [row.hour, row.avg_entries]))

  return Array.from({ length: 24 }, (_, hour) => {
    const avg2026 = avg2026ByHour.get(hour) ?? null
    const avg2025 = avg2025ByHour.get(hour) ?? null

    return {
      hour,
      avg2026,
      avg2025,
      value2026: avg2026,
      value2025: avg2025,
    }
  })
}

function ClassHoverReadout({ hoverInfo }: { hoverInfo: HoverReadout }) {
  return (
    <div
      className="mt-1 flex min-h-4 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-tight select-none"
      style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)' }}
    >
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
    </div>
  )
}

interface ClassCardProps {
  vehicleClass: string
  pctChange: number | null
  mode: 'daily' | 'hourly'
  rows: DailyClassTimeRow[] | HourlyClassRow[]
}

function ClassCard({ vehicleClass, pctChange, mode, rows }: ClassCardProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverReadout | null>(null)

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
      const rows2026 = parsed.filter((row) => row.year === 2026)
      const rows2025 = parsed.filter((row) => row.year === 2025)
      const wideRows = buildClassDailyHoverRows(rows2026, rows2025)
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
          Plot.lineY(rows2025, {
            x: 'date',
            y: 'entries',
            stroke: COLOR_2025,
            strokeWidth: 1,
            curve: 'monotone-x',
          }),
          Plot.lineY(rows2026, {
            x: 'date',
            y: 'entries',
            stroke: COLOR_2026,
            strokeWidth: 2,
            curve: 'monotone-x',
          }),
          ...chartHoverMarks(wideRows, 'date', { r2025: 3, r2026: 3.5 }),
        ],
      })
    } else {
      const hourlyRows = rows as HourlyClassRow[]
      const rows2026 = hourlyRows.filter((row) => row.year === 2026)
      const rows2025 = hourlyRows.filter((row) => row.year === 2025)
      const wideRows = buildClassHourlyHoverRows(rows2026, rows2025)
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
          Plot.lineY(rows2025, {
            x: 'hour',
            y: 'avg_entries',
            stroke: COLOR_2025,
            strokeWidth: 1,
            curve: 'monotone-x',
          }),
          Plot.lineY(rows2026, {
            x: 'hour',
            y: 'avg_entries',
            stroke: COLOR_2026,
            strokeWidth: 2,
            curve: 'monotone-x',
          }),
          ...chartHoverMarks(wideRows, 'hour', { r2025: 3, r2026: 3.5 }),
        ],
      })
    }

    chartRef.current.appendChild(plot)

    const handleInput = () => {
      const datum = plot.value as ChartHoverRow | null
      setHoverInfo(
        datum
          ? formatHoverReadout(datum, {
              valueFormatter: mode === 'hourly' ? (value) => fmtCount(Math.round(value)) : fmtCount,
            })
          : null,
      )
    }
    plot.addEventListener('input', handleInput)

    return () => {
      plot.remove()
      setHoverInfo(null)
    }
  }, [rows, mode])

  const has2026 = rows.some(r => r.year === 2026)
  const has2025 = rows.some(r => r.year === 2025)

  return (
    <div className="bg-white border border-ink-900 p-3">
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className="text-xs font-semibold leading-tight truncate"
          style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)' }}
        >
          {vehicleClass}
        </span>
        <ChangeBadge pctChange={pctChange} />
      </div>

      {/* Chart area */}
      {rows.length === 0 ? (
        <div
          className="flex items-center justify-center h-[100px] text-xs"
          style={{ color: 'var(--fg-faint)' }}
        >
          No data
        </div>
      ) : (
        <>
          <div ref={chartRef} className="w-full" />
          {hoverInfo && <ClassHoverReadout hoverInfo={hoverInfo} />}
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
// Skeleton card for loading state
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="bg-white border border-ink-900 p-3 animate-pulse">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="h-3 bg-paper-200 w-3/4" />
        <div className="h-4 bg-paper-200 w-10 shrink-0" />
      </div>
      <div className="h-[100px] bg-paper-100 mt-2" />
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
          'fixed top-0 right-0 z-50 h-full w-[420px] border-l border-ink-900',
          'flex flex-col',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        style={{ background: 'var(--bg)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-3 border-b border-ink-900 bg-white shrink-0"
        >
          <div>
            <div className="eyebrow">Vehicle class breakdown</div>
            {detectionGroup && (
              <div
                className="mt-0.5 truncate"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.01em' }}
              >
                {detectionGroup}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="shrink-0 flex items-center justify-center w-7 h-7 border border-ink-900 hover:bg-paper-200 focus-visible:outline-2 focus-visible:outline-ink-900 transition-colors"
            style={{ color: 'var(--fg)' }}
          >
            <span aria-hidden="true" className="text-base leading-none">&times;</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                // reason: index is stable for skeleton placeholders
                <SkeletonCard key={i} />
              ))}
            </>
          )}

          {!isLoading && error && (
            <p className="text-sm py-2" style={{ color: 'var(--accent)' }}>
              Failed to load class data: {error.message}
            </p>
          )}

          {!isLoading && !error && aggData.length === 0 && (
            <p className="text-sm py-2" style={{ color: 'var(--fg-muted)' }}>No class data available.</p>
          )}

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
          <div className="shrink-0 flex items-center gap-4 px-5 py-2 border-t border-ink-900 bg-white">
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
    <span
      className="flex items-center gap-1.5 text-xs"
      style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}
    >
      <span
        aria-hidden="true"
        className="inline-block w-5 h-[2px]"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
