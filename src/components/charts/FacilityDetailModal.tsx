import * as Plot from '@observablehq/plot'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ChangeBadge from '../ChangeBadge'
import type {
  ClassAggRow,
  DailyClassTimeRow,
  DailyGroupTimeRow,
  GroupAggRow,
  HourlyClassRow,
  HourlyGroupRow,
} from '../../lib/queries'
import {
  COLOR_2025,
  COLOR_2026,
  buildDailyHoverRows,
  buildHourlyHoverRows,
  chartHoverMarks,
  fmtAxisCount,
  fmtCount,
  fmtHour,
  formatHoverReadout,
  type ChartHoverRow,
  type DailyHoverRow,
  type HoverReadout,
  type HourlyHoverRow,
} from './chartHover'

type ModalMode = 'daily' | 'hourly'

export interface FacilityDetailModalProps {
  mode: ModalMode
  detectionGroup: string | null
  groupRows: DailyGroupTimeRow[] | HourlyGroupRow[]
  groupSummary: GroupAggRow | null
  isGroupLoading: boolean
  groupError: Error | null
  classRows: DailyClassTimeRow[] | HourlyClassRow[]
  classAggRows: ClassAggRow[]
  isClassLoading: boolean
  classError: Error | null
  onClose: () => void
}

const HERO_CHART_HEIGHT = 360

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtMonthDay = (d: Date) => `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`
const fmtMonth = (d: Date) => MONTHS_SHORT[d.getUTCMonth()]

function xAxisForSpan(spanDays: number) {
  if (spanDays <= 14) return { ticks: 'day' as const, tickFormat: fmtMonthDay }
  if (spanDays <= 60) return { ticks: 'week' as const, tickFormat: fmtMonthDay }
  return { ticks: 'month' as const, tickFormat: fmtMonth }
}

function HoverReadoutLine({ hoverInfo }: {
  hoverInfo: HoverReadout
}) {
  return (
    <div
      className="min-h-5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 select-none"
      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}
    >
      <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{hoverInfo.timeLabel}</span>
      <span style={{ color: 'var(--rule-soft)' }} aria-hidden="true">.</span>
      <span><span style={{ color: 'var(--accent)', fontWeight: 600 }}>2026</span>: {hoverInfo.value2026Label ?? '-'}</span>
      <span style={{ color: 'var(--rule-soft)' }} aria-hidden="true">.</span>
      <span><span style={{ color: 'var(--fg-faint)' }}>2025</span>: {hoverInfo.value2025Label ?? '-'}</span>
      {hoverInfo.delta !== null && (
        <>
          <span style={{ color: 'var(--rule-soft)' }} aria-hidden="true">.</span>
          <span style={{ color: hoverInfo.delta < 0 ? '#0E2A47' : '#C8102E' }}>
            {`${hoverInfo.deltaLabel}${hoverInfo.deltaPctLabel ? ` (${hoverInfo.deltaPctLabel})` : ''}`}
          </span>
        </>
      )}
    </div>
  )
}

function FacilityHeroChart({
  mode,
  rows,
  summary,
  isLoading,
  error,
}: {
  mode: ModalMode
  rows: DailyGroupTimeRow[] | HourlyGroupRow[]
  summary: GroupAggRow | null
  isLoading: boolean
  error: Error | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [hoverInfo, setHoverInfo] = useState<HoverReadout | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setContainerWidth(container.clientWidth)

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const plotEl = plotRef.current
    if (!plotEl) return
    if (isLoading || error || rows.length === 0 || containerWidth === 0) return

    let plot: ReturnType<typeof Plot.plot>

    if (mode === 'daily') {
      const parsed = (rows as DailyGroupTimeRow[]).map((row) => ({ ...row, date: new Date(row.plot_date) }))
      const rows2025 = parsed.filter((row) => row.year === 2025)
      const rows2026 = parsed.filter((row) => row.year === 2026)
      const times = parsed.map((row) => row.date.getTime())
      const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0
      const { ticks, tickFormat } = xAxisForSpan(spanDays)

      plot = Plot.plot({
        width: containerWidth,
        height: HERO_CHART_HEIGHT,
        marginLeft: 58,
        marginRight: 24,
        style: { background: 'transparent', overflow: 'visible' } as CSSStyleDeclaration,
        x: { type: 'utc', ticks, tickFormat, label: null },
        y: { label: 'Entries', ticks: 5, tickFormat: fmtAxisCount, grid: '#ECE7D8' },
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
            strokeWidth: 2.5,
            curve: 'monotone-x',
          }),
          ...chartHoverMarks(buildDailyHoverRows(parsed, (row) => row.entries), 'date'),
        ],
      })
    } else {
      const hourlyRows = rows as HourlyGroupRow[]
      const rows2025 = hourlyRows.filter((row) => row.year === 2025)
      const rows2026 = hourlyRows.filter((row) => row.year === 2026)

      plot = Plot.plot({
        width: containerWidth,
        height: HERO_CHART_HEIGHT,
        marginLeft: 58,
        marginRight: 24,
        style: { background: 'transparent', overflow: 'visible' } as CSSStyleDeclaration,
        x: {
          type: 'linear',
          domain: [0, 23],
          ticks: [0, 6, 12, 18, 23],
          tickFormat: fmtHour,
          label: null,
        },
        y: { label: 'Avg entries', ticks: 5, tickFormat: fmtAxisCount, grid: '#ECE7D8' },
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
            strokeWidth: 2.5,
            curve: 'monotone-x',
          }),
          ...chartHoverMarks(buildHourlyHoverRows(hourlyRows, (row) => row.avg_entries), 'hour'),
        ],
      })
    }

    plotEl.appendChild(plot)

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
      plot.removeEventListener('input', handleInput)
      plot.remove()
      setHoverInfo(null)
    }
  }, [rows, mode, containerWidth, isLoading, error])

  const hasOrphan2026 =
    mode === 'daily' &&
    (() => {
      const dailyRows = rows as DailyGroupTimeRow[]
      const dates2025 = new Set(dailyRows.filter((row) => row.year === 2025).map((row) => row.plot_date))
      return dailyRows.filter((row) => row.year === 2026).some((row) => !dates2025.has(row.plot_date))
    })()

  return (
    <div ref={containerRef} className="relative w-full">
      {isLoading && (
        <div
          className="h-[360px] bg-paper-200 animate-pulse"
          role="status"
          aria-label="Loading detection group chart"
        />
      )}

      {!isLoading && error && (
        <div
          className="h-[360px] flex items-center justify-center text-sm border border-signal-500 px-4 text-center"
          style={{ color: 'var(--accent)', background: '#FBF6EA' }}
          role="alert"
        >
          Failed to load detection group data: {error.message}
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <div
          className="h-[360px] flex items-center justify-center text-sm border border-ink-200 px-4 text-center"
          style={{ color: 'var(--fg-muted)', background: 'var(--bg-raised)' }}
        >
          No data for this detection group under the current filters.
        </div>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <>
          {summary !== null && (
            <div className="absolute top-0 right-0 z-10 flex flex-col items-end gap-0.5 pointer-events-none">
              <ChangeBadge
                pctChange={summary.pct_change}
                tooltip={`2026: ${summary.current_entries.toLocaleString()} entries | 2025: ${summary.prior_entries.toLocaleString()} entries`}
                className="pointer-events-auto"
              />
              <span
                className="pr-0.5 leading-none"
                style={{ fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}
              >
                vs prior year
              </span>
            </div>
          )}
          <div ref={plotRef} />
          {hoverInfo && (
            <HoverReadoutLine hoverInfo={hoverInfo} />
          )}
          {hasOrphan2026 && (
            <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--fg-faint)' }}>
              Note: prior-year data unavailable for Jan 1-4 (CRZ launched Jan 5, 2025).
            </p>
          )}
        </>
      )}
    </div>
  )
}

interface ClassCardProps {
  vehicleClass: string
  pctChange: number | null
  mode: ModalMode
  rows: DailyClassTimeRow[] | HourlyClassRow[]
}

const ClassCard = memo(function ClassCard({ vehicleClass, pctChange, mode, rows }: ClassCardProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverReadout | null>(null)

  useEffect(() => {
    if (!chartRef.current) return
    if (rows.length === 0) return

    const width = chartRef.current.clientWidth || 300
    let plot: ReturnType<typeof Plot.plot>

    const commonOpts = {
      width,
      height: 116,
      marginTop: 6,
      marginRight: 8,
      marginBottom: 22,
      marginLeft: 42,
      style: { background: 'transparent', overflow: 'visible' } as CSSStyleDeclaration,
      y: { ticks: 3, label: null as string | null, grid: false, tickFormat: fmtAxisCount },
    }

    if (mode === 'daily') {
      const parsed = (rows as DailyClassTimeRow[]).map((row) => ({ ...row, date: new Date(row.plot_date) }))
      const rows2025 = parsed.filter((row) => row.year === 2025)
      const rows2026 = parsed.filter((row) => row.year === 2026)
      const times = parsed.map((row) => row.date.getTime())
      const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0
      const xAxis = spanDays > 60
        ? { ticks: 'month' as const, tickFormat: fmtMonth }
        : { ticks: 4, tickFormat: fmtMonthDay }

      plot = Plot.plot({
        ...commonOpts,
        x: { type: 'utc', ...xAxis, label: null },
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
          ...chartHoverMarks(buildDailyHoverRows(parsed, (row) => row.entries), 'date', { r2025: 3, r2026: 3.5 }),
        ],
      })
    } else {
      const hourlyRows = rows as HourlyClassRow[]
      const rows2025 = hourlyRows.filter((row) => row.year === 2025)
      const rows2026 = hourlyRows.filter((row) => row.year === 2026)

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
          ...chartHoverMarks(buildHourlyHoverRows(hourlyRows, (row) => row.avg_entries), 'hour', { r2025: 3, r2026: 3.5 }),
        ],
      })
    }

    chartRef.current.appendChild(plot)

    const handleInput = () => {
      const datum = plot.value as DailyHoverRow | HourlyHoverRow | null
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
      plot.removeEventListener('input', handleInput)
      plot.remove()
      setHoverInfo(null)
    }
  }, [rows, mode])

  const has2026 = rows.some((row) => row.year === 2026)
  const has2025 = rows.some((row) => row.year === 2025)

  return (
    <div className="bg-white border border-ink-900 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className="text-xs font-semibold leading-tight truncate"
          style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)' }}
        >
          {vehicleClass}
        </span>
        <ChangeBadge pctChange={pctChange} />
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center h-[116px] text-xs" style={{ color: 'var(--fg-faint)' }}>
          No data
        </div>
      ) : (
        <>
          <div ref={chartRef} className="w-full" />
          {hoverInfo && (
            <HoverReadoutLine hoverInfo={hoverInfo} />
          )}
          {has2026 && !has2025 && (
            <p className="mt-1 text-[10px] leading-tight" style={{ color: 'var(--fg-faint)' }}>
              No prior-year data for this period
            </p>
          )}
        </>
      )}
    </div>
  )
})

function SkeletonCard() {
  return (
    <div className="bg-white border border-ink-900 p-3 animate-pulse">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="h-3 bg-paper-200 w-3/4" />
        <div className="h-4 bg-paper-200 w-10 shrink-0" />
      </div>
      <div className="h-[116px] bg-paper-100 mt-2" />
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs"
      style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}
    >
      <span aria-hidden="true" className="inline-block w-5 h-[2px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

export function FacilityDetailModal({
  mode,
  detectionGroup,
  groupRows,
  groupSummary,
  isGroupLoading,
  groupError,
  classRows,
  classAggRows,
  isClassLoading,
  classError,
  onClose,
}: FacilityDetailModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const isOpen = detectionGroup !== null

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const rowsByClass = useMemo(() => {
    const grouped = new Map<string, DailyClassTimeRow[] | HourlyClassRow[]>()
    for (const row of classRows) {
      const list = grouped.get(row.vehicle_class)
      if (list) {
        list.push(row as never)
      } else {
        grouped.set(row.vehicle_class, [row] as DailyClassTimeRow[] | HourlyClassRow[])
      }
    }
    return grouped
  }, [classRows])

  if (!isOpen) return null

  const modeContext = mode === 'daily' ? '2026 vs 2025' : 'avg entries by hour'

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close detection group detail"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/45"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detection group detail - ${detectionGroup}`}
        className="absolute left-1/2 top-1/2 flex max-h-[90vh] w-[90vw] max-w-[1200px] -translate-x-1/2 -translate-y-1/2 flex-col border border-ink-900 bg-paper-50 shadow-[8px_8px_0_#111111] sm:max-h-[90vh] max-sm:h-[96vh] max-sm:w-[96vw]"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-ink-900 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="eyebrow">Detection group detail</div>
            <div
              className="mt-0.5 truncate"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--fg)' }}
            >
              {detectionGroup}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className="hidden sm:inline"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}
            >
              {modeContext}
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="flex h-8 w-8 shrink-0 items-center justify-center border border-ink-900 bg-white text-sm font-semibold hover:bg-paper-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
              style={{ color: 'var(--fg)' }}
            >
              x
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <section className="border border-ink-900 bg-white p-4 sm:p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="eyebrow">{mode === 'daily' ? 'Detection group daily entries' : 'Detection group hourly profile'}</span>
              <span
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}
              >
                {modeContext}
              </span>
            </div>
            <FacilityHeroChart
              mode={mode}
              rows={groupRows}
              summary={groupSummary}
              isLoading={isGroupLoading}
              error={groupError}
            />
          </section>

          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="eyebrow">Vehicle class breakdown</span>
              {!isClassLoading && !classError && classAggRows.length > 0 && (
                <div className="flex items-center gap-4">
                  <LegendItem color={COLOR_2026} label="2026" />
                  <LegendItem color={COLOR_2025} label="2025" />
                </div>
              )}
            </div>

            {isClassLoading && (
              <div
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
                aria-label="Loading vehicle class charts"
                aria-busy="true"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            )}

            {!isClassLoading && classError && (
              <p className="border border-signal-500 bg-white px-4 py-3 text-sm" style={{ color: 'var(--accent)' }}>
                Failed to load class data: {classError.message}
              </p>
            )}

            {!isClassLoading && !classError && classAggRows.length === 0 && (
              <p className="border border-ink-200 bg-white px-4 py-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
                No class data available for the selected detection group.
              </p>
            )}

            {!isClassLoading && !classError && classAggRows.length > 0 && (
              <div
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                {classAggRows.map((agg) => (
                  <ClassCard
                    key={agg.vehicle_class}
                    vehicleClass={agg.vehicle_class}
                    pctChange={agg.pct_change}
                    mode={mode}
                    rows={rowsByClass.get(agg.vehicle_class) ?? []}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
