import * as Plot from '@observablehq/plot'
import { useEffect, useRef, useState } from 'react'
import type { DailyYoYRow } from '../../lib/queries'
import ChangeBadge from '../ChangeBadge'
import {
  COLOR_2025,
  COLOR_2026,
  buildDailyHoverRows,
  chartHoverMarks,
  fmtAxisCount,
  formatHoverReadout,
  type DailyHoverRow,
  type HoverReadout as HoverInfo,
} from './chartHover'

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
const BADGE_HEADROOM_RATIO = 1.22

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an annotated row list with Date objects parsed from plot_date strings. */
function parseRows(data: DailyYoYRow[]) {
  return data.map((d) => ({ ...d, date: new Date(d.plot_date) }))
}

function paddedYDomain(rows: ReturnType<typeof parseRows>): [number, number] | undefined {
  const maxEntries = Math.max(0, ...rows.map((row) => row.entries))
  return maxEntries > 0 ? [0, maxEntries * BADGE_HEADROOM_RATIO] : undefined
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

  // Wide-form dataset keyed on 2026 dates so all pointer marks snap to the
  // same x. Using 2026 as the anchor means the rule and both dots are always
  // driven by identical x values, eliminating the independent-snap off-by-one.
  const wide = buildDailyHoverRows(parsed, (r) => r.entries)

  const times = parsed.map(d => d.date.getTime())
  const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0
  const { ticks, tickFormat } = xAxisForSpan(spanDays)
  const yDomain = paddedYDomain(parsed)

  return Plot.plot({
    width,
    height: CHART_HEIGHT,
    marginLeft: 52,  // widest abbreviated label is "500K" ≈ 28px; give breathing room
    marginRight: 24,
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
      domain: yDomain,
      label: 'Entries',
      ticks: 5,
      tickFormat: fmtAxisCount,
      grid: '#ECE7D8',
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
      // Current-year line — red, slightly thicker so it reads as primary
      Plot.lineY(data2026, {
        x: 'date',
        y: 'entries',
        stroke: COLOR_2026,
        strokeWidth: 2,
        curve: 'monotone-x',
      }),
      // Vertical rule + dots driven by one shared hover utility so all marks
      // snap to the same x position and follow the same year-color convention.
      ...chartHoverMarks(wide, 'date'),
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
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)

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

    const handleInput = () => {
      const datum = plot.value as DailyHoverRow | null
      setHoverInfo(datum ? formatHoverReadout(datum) : null)
    }
    plot.addEventListener('input', handleInput)

    return () => {
      plot.remove()
      setHoverInfo(null)
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
          className="h-[280px] bg-paper-200"
          role="status"
          aria-label="Loading chart"
        />
      )}

      {!isLoading && error && (
        <div
          className="h-[280px] flex items-center justify-center text-sm border border-signal-500 px-4 text-center"
          style={{ color: 'var(--accent)', background: '#FBF6EA' }}
          role="alert"
        >
          Failed to load chart data: {error.message}
        </div>
      )}

      {!isLoading && !error && data.length === 0 && (
        <div
          className="h-[280px] flex items-center justify-center text-sm border border-ink-200"
          style={{ color: 'var(--fg-muted)', background: 'var(--bg-raised)' }}
        >
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
          <div
            className="h-5 flex items-center gap-2 px-1 select-none"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}
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
          {hasOrphan2026 && (
            <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--fg-faint)' }}>
              Note: prior-year data unavailable for Jan 1–4 (CRZ launched Jan 5, 2025).
            </p>
          )}
        </>
      )}
    </div>
  )
}
