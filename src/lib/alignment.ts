import type { FilterState, PeriodPreset } from './types'

export interface ComparablePeriod {
  current: [Date, Date]
  prior: [Date, Date]
}

export interface DateRangeValidation {
  range?: [Date, Date]
  error?: string
}

export interface PeriodValidation {
  period?: ComparablePeriod
  error?: string
}

/** Shift a date backward by exactly 364 days (52 × 7 — preserves weekday). */
export function shift364(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - 364)
  return d
}

/**
 * Return the [start, end] windows for the current year and the comparable
 * prior-year period, given a preset and today's date.
 *
 * All dates are local-time midnight (time component is 00:00:00).
 * The `prior` window is always `current` shifted back 364 days.
 */
export function comparablePeriod(
  today: Date,
  preset: PeriodPreset,
  custom?: [Date, Date],
): ComparablePeriod {
  const currentYear = today.getFullYear()

  let currentStart: Date
  let currentEnd: Date

  switch (preset) {
    case 'ytd': {
      currentStart = new Date(currentYear, 0, 1)
      currentEnd = today
      break
    }
    case 'last_month': {
      // Full calendar month ending at the start of the current month.
      const firstOfThisMonth = new Date(currentYear, today.getMonth(), 1)
      currentEnd = new Date(firstOfThisMonth.getTime() - 1) // last millisecond of prev month
      currentEnd = new Date(currentEnd.getFullYear(), currentEnd.getMonth(), currentEnd.getDate())
      currentStart = new Date(currentEnd.getFullYear(), currentEnd.getMonth(), 1)
      break
    }
    case 'last_week': {
      // The 7 days ending yesterday.
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const weekStart = new Date(yesterday)
      weekStart.setDate(weekStart.getDate() - 6)
      currentStart = weekStart
      currentEnd = yesterday
      break
    }
    case 'custom': {
      if (!custom) throw new Error('custom preset requires a date range')
      ;[currentStart, currentEnd] = custom
      break
    }
  }

  return {
    current: [currentStart, currentEnd],
    prior: [shift364(currentStart), shift364(currentEnd)],
  }
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

export function periodFromFilter(today: Date, state: FilterState): PeriodValidation {
  if (state.preset !== 'custom') {
    return { period: comparablePeriod(today, state.preset) }
  }

  const { range, error } = normalizeDateRange(state.customStart, state.customEnd)
  if (!range) return { error }

  return { period: comparablePeriod(today, 'custom', range) }
}
