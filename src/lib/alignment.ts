import type { FilterState, PeriodPreset } from './types'

export type BuiltInPeriodPreset = Exclude<PeriodPreset, 'custom'>

export type DateRange = [Date, Date]

export interface DataWindow {
  currentStart: Date
  currentEnd: Date
}

export interface ComparablePeriod {
  current: DateRange[]
  prior: DateRange[]
}

export interface DateRangeValidation {
  range?: DateRange
  error?: string
}

export interface PeriodValidation {
  period?: ComparablePeriod
  error?: string
}

/** Shift a date backward by exactly 364 days (52 x 7, preserves weekday). */
export function shift364(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - 364)
  return d
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() + days)
  return d
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b
}

export function periodFromCurrent(current: DateRange[]): ComparablePeriod {
  return {
    current,
    prior: current.map(([start, end]) => [shift364(start), shift364(end)]),
  }
}

/**
 * Return the current-year windows and the comparable prior-year windows.
 *
 * The `prior` windows are always each `current` range shifted back 364 days.
 * Presets are anchored to the latest available data date, not the browser date.
 */
export function comparablePeriod(
  dataWindow: DataWindow,
  preset: BuiltInPeriodPreset,
): ComparablePeriod {
  const start = startOfDay(dataWindow.currentStart)
  const end = startOfDay(dataWindow.currentEnd)

  switch (preset) {
    case 'ytd':
      return periodFromCurrent([[start, end]])
    case 'last_30_days':
      return periodFromCurrent([[maxDate(start, addDays(end, -29)), end]])
    case 'last_90_days':
      return periodFromCurrent([[maxDate(start, addDays(end, -89)), end]])
  }
}

export function presetDateRange(dataWindow: DataWindow, preset: BuiltInPeriodPreset): DateRange {
  return comparablePeriod(dataWindow, preset).current[0]
}

function formatDateRangeError(dataWindow: DataWindow): string {
  return `Choose dates between ${formatDisplayDate(dataWindow.currentStart)} and ${formatDisplayDate(
    dataWindow.currentEnd,
  )}.`
}

function formatDisplayDate(date: Date): string {
  return toISODate(date).replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_match, year, month, day) => {
    const parsed = new Date(Number(year), Number(month) - 1, Number(day))
    return parsed.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  })
}

/** Format a Date as an ISO date string (YYYY-MM-DD) in local time. */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse a local date-only string without UTC timezone shifts. */
export function parseISODateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

export function normalizeDateRange(
  start: string | undefined,
  end: string | undefined,
): DateRangeValidation {
  if (!start || !end) return { error: 'Choose both a start and end date.' }

  const startDate = parseISODateOnly(start)
  const endDate = parseISODateOnly(end)

  if (!startDate || !endDate) return { error: 'Use valid dates in YYYY-MM-DD format.' }
  if (startDate > endDate) return { error: 'Start date must be on or before end date.' }

  return { range: [startDate, endDate] }
}

export function periodFromFilter(dataWindow: DataWindow, state: FilterState): PeriodValidation {
  if (state.preset === 'custom') {
    const result = normalizeDateRange(state.customStart, state.customEnd)
    if (result.error) return { error: result.error }

    const [startDate, endDate] = result.range!
    const dataStart = startOfDay(dataWindow.currentStart)
    const dataEnd = startOfDay(dataWindow.currentEnd)

    if (startDate < dataStart || endDate > dataEnd) {
      return { error: formatDateRangeError(dataWindow) }
    }

    return { period: periodFromCurrent([[startDate, endDate]]) }
  }

  return { period: comparablePeriod(dataWindow, state.preset) }
}

export function periodKey(period: ComparablePeriod): string {
  const encode = (ranges: DateRange[]) =>
    ranges.map(([start, end]) => `${toISODate(start)}:${toISODate(end)}`).join(',')

  return `${encode(period.current)}|${encode(period.prior)}`
}
