import * as Plot from '@observablehq/plot'
import { useEffect, useRef, useState } from 'react'
import type { DailyYoYRow } from '../../lib/queries'
import ChangeBadge from '../ChangeBadge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A systemwide summary produced by querySystemwideSummary.
 * current_entries / prior_entries are totals over the comparable window;
 * pct_change is (current - prior) / prior * 100, null when no prior data.
 */
export interface SystemwideSummary {
  current_entries: number
  prior_entries: number
  pct_change: number | null
}

/**
 * Props for YoYDailyChart.
 *
 * `data` — rows from queryDailyYoY; each row has a 2026-era plot_date,
 *   a year discriminator (2025 | 2026), and a daily entries count.
 *   This component is pure presentation — the parent handles DuckDB fetching.
 *
 * `summary` — pre-computed totals for the ChangeBadge. null while loading
 *   or when no comparable data is available.
 *
 * `isLoading` — when true the component renders a fixed-height skeleton so
 *   the layout does not reflow once data arrives.
 *
 * `error` — if set, a short inline error message is shown instead of the chart.
 */
export interface YoYDailyChartProps {
  data: DailyYoYRow[]
  summary: SystemwideSummary | null
  isLoading: boolean
  error: Error | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 280
const COLOR_2025 = '#d1d5db' // gray-300  — prior year, intentionally recedes
const COLOR_2026 = '#3b82f6' // blue-500  — current year, brand accent

/** Abbreviate large counts: 500000 → "500K", 1500000 → "1.5M". */
const fmtCount = (v: number): string => {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`
  return String(Math.round(v))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an annotated row list with Date objects parsed from plot_date strings. */
function parseRows(data: DailyYoYRow[]) {
  return data.map((d) => ({ ...d, date: new Date(d.plot_date) }))
}

/** Compose the multi-line tip title for a hovered row. */
function buildTipTitle(
  d: { date: Date; year: number; entries: number; plot_date: string },
  allParsed: ReturnType<typeof parseRows>,
): string {
  const sameDate = allParsed.filter((r) => r.plot_date === d.plot_date)
  const row2025 = sameDate.find((r) => r.year === 2025)
  const row2026 = sameDate.find((r) => r.year === 2026)
  const fmt = (v: number) => v.toLocaleString()
  const dateLabel = d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (row2025 && row2026) {
    const delta = row2026.entries - row2025.entries
    const pct = ((delta / row2025.entries) * 100).toFixed(1)
    const sign = delta >= 0 ? '+' : ''
    return [
      dateLabel,
      `2026: ${fmt(row2026.entries)}`,
      `2025: ${fmt(row2025.entries)}`,
      `Δ ${sign}${fmt(delta)} (${sign}${pct}%)`,
    ].join('\n')
  }
  if (row2026) return `${dateLabel}\n2026: ${fmt(row2026.entries)}\n(no 2025 data)`
  if (row2025) return `${dateLabel}\n2025: ${fmt(row2025.entries)}\n(no 2026 data)`
  return dateLabel
}

// ---------------------------------------------------------------------------
// Adaptive x-axis tick helpers
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// UTC-safe formatters avoid off-by-one errors when dates are UTC-midnight strings.
const fmtMonthDay = (d: Date) => `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`
const fmtMonth    = (d: Date) => MONTHS_SHORT[d.getUTCMonth()]

/** Choose tick interval and format based on the visible date span. */
function xAxisForSpan(spanDays: number) {
  if (spanDays <= 14) return { ticks: 'day'   as const, tickFormat: fmtMonthDay }
  if (spanDays <= 60) return { ticks: 'week'  as const, tickFormat: fmtMonthDay }
  return                     { ticks: 'month' as const, tickFormat: fmtMonth    }
}

/** Build and return a Plot SVG element. Caller owns appendChild / remove. */
function buildPlot(width: number, parsed: ReturnType<typeof parseRows>) {
  const data2025 = parsed.filter((d) => d.year === 2025)
  const data2026 = parsed.filter((d) => d.year === 2026)

  const lastOf = (arr: typeof data2025) =>
    arr.length ? [arr.reduce((a, b) => (a.date >= b.date ? a : b))] : []

  const times = parsed.map(d => d.date.getTime())
  const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0
  const { ticks, tickFormat } = xAxisForSpan(spanDays)

  return Plot.plot({
    width,
    height: CHART_HEIGHT,
    marginLeft: 52,  // widest abbreviated label is "500K" ≈ 28px; give breathing room
    marginRight: 48, // room for inline year labels
    color: {
      domain: [2025, 2026],
      range: [COLOR_2025, COLOR_2026],
      legend: false,
    },
    x: {
      type: 'utc',
      label: null,
      ticks,
      tickFormat,
    },
    y: {
      label: 'Entries',
      tickFormat: fmtCount,
      grid: '#f3f4f6',
    },
    marks: [
      // Prior-year line — light gray, thin, clearly subordinate
      Plot.lineY(data2025, {
        x: 'date',
        y: 'entries',
        stroke: COLOR_2025,
        strokeWidth: 1,
        curve: 'monotone-x',
      }),
      // Current-year line — blue, slightly thicker so it reads as primary
      Plot.lineY(data2026, {
        x: 'date',
        y: 'entries',
        stroke: COLOR_2026,
        strokeWidth: 2,
        curve: 'monotone-x',
      }),
      // Inline "2025" label at the rightmost point of the prior series
      ...lastOf(data2025).map((row) =>
        Plot.text([row], {
          x: 'date',
          y: 'entries',
          text: () => '2025',
          fill: COLOR_2025,
          textAnchor: 'start',
          dx: 4,
          fontSize: 11,
          fontWeight: 500,
        }),
      ),
      // Inline "2026" label at the rightmost point of the current series
      ...lastOf(data2026).map((row) =>
        Plot.text([row], {
          x: 'date',
          y: 'entries',
          text: () => '2026',
          fill: COLOR_2026,
          textAnchor: 'start',
          dx: 4,
          fontSize: 11,
          fontWeight: 600,
        }),
      ),
      // Crosshair tip: shows both years' values + delta on hover
      Plot.tip(
        parsed,
        Plot.pointerX({
          x: 'date',
          y: 'entries',
          title: (d) => buildTipTitle(d, parsed),
        }),
      ),
    ],
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Systemwide year-over-year daily entries chart.
 *
 * Renders two lines (2025 in gray, 2026 in blue) over a shared 2026-era
 * date axis. A ChangeBadge in the top-right corner shows the % change for
 * the full comparable period; decrease is green (CRZ program goal).
 *
 * Handles three non-data states: loading skeleton, error message, empty message.
 * Handles the Jan 1–4 edge case (no prior-year data) with an inline note.
 */
export function YoYDailyChart({ data, summary, isLoading, error }: YoYDailyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)

  // Track container width via ResizeObserver so the plot fills its column.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Set initial width immediately (avoids a flash of zero-width plot).
    setContainerWidth(container.clientWidth)

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Render / re-render the Observable Plot whenever data or width changes.
  useEffect(() => {
    const plotEl = plotRef.current
    if (!plotEl) return
    if (isLoading || error || data.length === 0 || containerWidth === 0) return

    const parsed = parseRows(data)
    const plot = buildPlot(containerWidth, parsed)
    plotEl.appendChild(plot)

    return () => {
      plot.remove()
    }
  }, [data, containerWidth, isLoading, error])

  // Edge-case note: Jan 1–4 2026 lacks CRZ 2025 coverage (launched Jan 5)
  const dates2025 = new Set(data.filter((d) => d.year === 2025).map((d) => d.plot_date))
  const hasOrphan2026 = data
    .filter((d) => d.year === 2026)
    .some((d) => !dates2025.has(d.plot_date))

  // containerRef must always be in the DOM so the ResizeObserver attaches on
  // first mount. Loading/error/empty states render inside the same container.
  return (
    <div ref={containerRef} className="relative w-full">
      {isLoading && (
        <div
          className="h-[280px] animate-pulse bg-gray-100 rounded"
          role="status"
          aria-label="Loading chart"
        />
      )}

      {!isLoading && error && (
        <div
          className="h-[280px] flex items-center justify-center text-sm text-red-600 bg-red-50 rounded border border-red-100 px-4 text-center"
          role="alert"
        >
          Failed to load chart data: {error.message}
        </div>
      )}

      {!isLoading && !error && data.length === 0 && (
        <div className="h-[280px] flex items-center justify-center text-sm text-gray-500 bg-gray-50 rounded border border-gray-100">
          No data for the selected period.
        </div>
      )}

      {!isLoading && !error && data.length > 0 && (
        <>
          {summary !== null && (
            <div className="absolute top-0 right-0 z-10 flex flex-col items-end gap-0.5 pointer-events-none">
              <ChangeBadge
                pctChange={summary.pct_change}
                tooltip={`2026: ${summary.current_entries.toLocaleString()} entries  |  2025: ${summary.prior_entries.toLocaleString()} entries`}
                className="pointer-events-auto"
              />
              <span className="text-[10px] text-gray-400 pr-0.5 leading-none">vs prior year</span>
            </div>
          )}
          <div ref={plotRef} />
          {hasOrphan2026 && (
            <p className="mt-1 text-[11px] text-gray-400 leading-snug">
              Note: prior-year data unavailable for Jan 1–4 (CRZ launched Jan 5, 2025).
            </p>
          )}
        </>
      )}
    </div>
  )
}
