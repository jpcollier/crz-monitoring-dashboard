import * as Plot from '@observablehq/plot'
import { useEffect, useRef, useState } from 'react'
import type { HourlyYoYRow } from '../../lib/queries'
import ChangeBadge from '../ChangeBadge'
import type { SystemwideSummary } from './YoYDailyChart'
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
// Types
// ---------------------------------------------------------------------------

/**
 * Props for HourlyProfileChart.
 *
 * `data` — rows from queryHourlyYoY; each row has a year (2025 | 2026),
 *   an hour-of-day integer (0–23), and avg_entries averaged across all dates
 *   in the comparable period. The parent handles DuckDB fetching.
 *
 * `summary` — pre-computed totals for the ChangeBadge. null while loading
 *   or when no comparable data is available.
 *
 * `isLoading` — when true the component renders a fixed-height skeleton so
 *   the layout does not reflow once data arrives.
 *
 * `error` — if set, a short inline error message is shown instead of the chart.
 */
export interface HourlyProfileChartProps {
  data: HourlyYoYRow[]
  summary: SystemwideSummary | null
  isLoading: boolean
  error: Error | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 280

/** Build and return a Plot SVG element. Caller owns appendChild / remove. */
function buildPlot(width: number, data: HourlyYoYRow[]) {
  const data2025 = data.filter((d) => d.year === 2025)
  const data2026 = data.filter((d) => d.year === 2026)

  const wide = buildHourlyHoverRows(data, (r) => r.avg_entries)

  const lastOf = (arr: HourlyYoYRow[]) => {
    const atHour23 = arr.filter((d) => d.hour === 23)
    return atHour23.length ? atHour23 : []
  }

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
      type: 'linear',
      domain: [0, 23],
      label: null,
      tickFormat: (v: number) => fmtHour(v),
    },
    y: {
      label: 'Avg entries',
      tickFormat: fmtCount,
      grid: '#f3f4f6',
    },
    marks: [
      // Prior-year line — light gray, thin, clearly subordinate
      Plot.lineY(data2025, {
        x: 'hour',
        y: 'avg_entries',
        stroke: COLOR_2025,
        strokeWidth: 1,
        curve: 'monotone-x',
      }),
      // Current-year line — blue, slightly thicker so it reads as primary
      Plot.lineY(data2026, {
        x: 'hour',
        y: 'avg_entries',
        stroke: COLOR_2026,
        strokeWidth: 2,
        curve: 'monotone-x',
      }),
      // Inline "2025" label at hour 23 of the prior series
      ...lastOf(data2025).map((row) =>
        Plot.text([row], {
          x: 'hour',
          y: 'avg_entries',
          text: () => '2025',
          fill: COLOR_2025,
          textAnchor: 'start',
          dx: 4,
          fontSize: 11,
          fontWeight: 500,
        }),
      ),
      // Inline "2026" label at hour 23 of the current series
      ...lastOf(data2026).map((row) =>
        Plot.text([row], {
          x: 'hour',
          y: 'avg_entries',
          text: () => '2026',
          fill: COLOR_2026,
          textAnchor: 'start',
          dx: 4,
          fontSize: 11,
          fontWeight: 600,
        }),
      ),
      ...chartHoverMarks(wide, 'hour'),
    ],
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Systemwide year-over-year hourly profile chart.
 *
 * Renders two lines (2025 in gray, 2026 in blue) over an hour-of-day x-axis
 * (0–23). The shape reveals peak/off-peak patterns; a ChangeBadge in the
 * top-right corner shows the aggregate % change for the full comparable
 * period. Decrease is shown in green (CRZ program goal).
 *
 * Handles three non-data states: loading skeleton, error message, empty message.
 */
export function HourlyProfileChart({ data, summary, isLoading, error }: HourlyProfileChartProps) {
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

    const plot = buildPlot(containerWidth, data)
    plotEl.appendChild(plot)

    const handleInput = () => {
      const datum = plot.value as HourlyHoverRow | null
      setHoverInfo(datum ? formatHoverReadout(datum, { valueFormatter: (value) => fmtCount(Math.round(value)) }) : null)
    }
    plot.addEventListener('input', handleInput)

    return () => {
      plot.remove()
      setHoverInfo(null)
    }
  }, [data, containerWidth, isLoading, error])

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
          <div className="h-5 flex items-center gap-2 text-xs text-gray-500 px-1 select-none">
            {hoverInfo && (
              <>
                <span className="font-medium text-gray-700">{hoverInfo.timeLabel}</span>
                <span className="text-gray-300" aria-hidden="true">·</span>
                <span><span className="text-blue-500 font-medium">2026</span>: {hoverInfo.value2026Label ?? '—'}</span>
                <span className="text-gray-300" aria-hidden="true">·</span>
                <span><span className="text-gray-400">2025</span>: {hoverInfo.value2025Label ?? '—'}</span>
                {hoverInfo.delta !== null && (
                  <>
                    <span className="text-gray-300" aria-hidden="true">·</span>
                    <span className={hoverInfo.delta < 0 ? 'text-green-600' : 'text-orange-500'}>
                      {`${hoverInfo.deltaLabel}${hoverInfo.deltaPctLabel ? ` (${hoverInfo.deltaPctLabel})` : ''}`}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
