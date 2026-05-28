import * as Plot from '@observablehq/plot'

export const COLOR_2025 = '#d1d5db' // gray-300 — prior year, intentionally recedes
export const COLOR_2026 = '#3b82f6' // blue-500 — current year, brand accent
export const HOVER_RULE_COLOR = '#9ca3af'

/** Abbreviate large counts: 500000 → "500K", 1500000 → "1.5M". */
export const fmtCount = (v: number): string => {
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${sign}${+(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`
  return `${sign}${Math.round(abs)}`
}

/** Format an hour-of-day label for compact chart axes/readouts. */
export function fmtHour(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

export interface DailyHoverRow {
  date: Date
  plot_date: string
  value2026: number | null
  value2025: number | null
}

export interface HourlyHoverRow {
  hour: number
  value2026: number | null
  value2025: number | null
}

export type ChartHoverRow = DailyHoverRow | HourlyHoverRow

interface DailySourceRow {
  year: number
  date: Date
  plot_date: string
}

interface HourlySourceRow {
  year: number
  hour: number
}

function plotDateKey(plotDate: string): string {
  return plotDate.slice(0, 10)
}

export function buildDailyHoverRows<T extends DailySourceRow>(
  rows: T[],
  value: (row: T) => number,
): DailyHoverRow[] {
  const rows2025 = rows.filter((row) => row.year === 2025)
  const rows2026 = rows.filter((row) => row.year === 2026)
  const lookup2025 = new Map(rows2025.map((row) => [plotDateKey(row.plot_date), value(row)]))

  return rows2026.map((row) => ({
    date: row.date,
    plot_date: row.plot_date,
    value2026: value(row),
    value2025: lookup2025.get(plotDateKey(row.plot_date)) ?? null,
  }))
}

export function buildHourlyHoverRows<T extends HourlySourceRow>(
  rows: T[],
  value: (row: T) => number,
): HourlyHoverRow[] {
  const lookup2025 = new Map(rows.filter((row) => row.year === 2025).map((row) => [row.hour, value(row)]))
  const lookup2026 = new Map(rows.filter((row) => row.year === 2026).map((row) => [row.hour, value(row)]))

  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    value2026: lookup2026.get(hour) ?? null,
    value2025: lookup2025.get(hour) ?? null,
  }))
}

export function chartHoverMarks<T extends ChartHoverRow>(
  rows: T[],
  x: 'date' | 'hour',
  options: { r2025?: number; r2026?: number } = {},
) {
  const { r2025 = 4, r2026 = 5 } = options
  const pointer = Plot.pointerX({ x })

  return [
    Plot.ruleX(rows, { ...pointer, stroke: HOVER_RULE_COLOR, strokeWidth: 1 }),
    Plot.dot(rows, { ...pointer, y: (d: T) => d.value2025, fill: COLOR_2025, stroke: 'white', strokeWidth: 1.5, r: r2025 }),
    Plot.dot(rows, { ...pointer, y: (d: T) => d.value2026, fill: COLOR_2026, stroke: 'white', strokeWidth: 1.5, r: r2026 }),
  ]
}

export interface HoverReadout {
  timeLabel: string
  value2026Label: string | null
  value2025Label: string | null
  delta: number | null
  deltaLabel: string | null
  deltaPctLabel: string | null
}

function isDailyHoverRow(row: ChartHoverRow): row is DailyHoverRow {
  return 'date' in row
}

export function formatHoverReadout(
  row: ChartHoverRow,
  options: { valueFormatter?: (value: number) => string } = {},
): HoverReadout {
  const { valueFormatter = fmtCount } = options
  const timeLabel = isDailyHoverRow(row)
    ? row.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : fmtHour(row.hour)

  if (row.value2026 !== null && row.value2025 !== null) {
    const delta = row.value2026 - row.value2025
    const sign = delta >= 0 ? '+' : ''
    const deltaPct = row.value2025 === 0 ? null : (delta / row.value2025) * 100

    return {
      timeLabel,
      value2026Label: valueFormatter(row.value2026),
      value2025Label: valueFormatter(row.value2025),
      delta,
      deltaLabel: `Δ ${sign}${valueFormatter(delta)}`,
      deltaPctLabel: deltaPct === null ? null : `${sign}${deltaPct.toFixed(1)}%`,
    }
  }

  return {
    timeLabel,
    value2026Label: row.value2026 !== null ? valueFormatter(row.value2026) : null,
    value2025Label: row.value2025 !== null ? valueFormatter(row.value2025) : null,
    delta: null,
    deltaLabel: null,
    deltaPctLabel: null,
  }
}
