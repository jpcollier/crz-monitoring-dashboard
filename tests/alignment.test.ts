import { describe, expect, it } from 'vitest'
import { parseUrlFilterState } from '../src/hooks/useUrlState'
import {
  comparablePeriod,
  normalizeDateRange,
  parseISODateOnly,
  periodFromFilter,
  shift364,
  toISODate,
} from '../src/lib/alignment'
import type { DataWindow } from '../src/lib/alignment'

function d(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m! - 1, day)
}

function window(start: string, end: string): DataWindow {
  return { currentStart: d(start), currentEnd: d(end) }
}

function rangesToISO(ranges: [Date, Date][]): string[][] {
  return ranges.map(([start, end]) => [toISODate(start), toISODate(end)])
}

describe('shift364', () => {
  it('shifts by exactly 364 days (52 weeks)', () => {
    const result = shift364(d('2026-01-05'))
    expect(toISODate(result)).toBe('2025-01-06')
  })

  it('preserves the day of week', () => {
    const original = d('2026-05-24') // Sunday
    const shifted = shift364(original)
    expect(shifted.getDay()).toBe(original.getDay())
  })
})

describe('comparablePeriod', () => {
  it('ytd: current window is Jan 1 to latest available data date', () => {
    const { current, prior } = comparablePeriod(window('2026-01-01', '2026-05-24'), 'ytd')
    expect(rangesToISO(current)).toEqual([['2026-01-01', '2026-05-24']])
    expect(rangesToISO(prior)).toEqual([['2025-01-02', '2025-05-25']])
  })

  it('last_30_days: rolling 30-day window anchored on latest available data date', () => {
    const { current, prior } = comparablePeriod(window('2026-01-01', '2026-05-24'), 'last_30_days')
    expect(rangesToISO(current)).toEqual([['2026-04-25', '2026-05-24']])
    expect(rangesToISO(prior)).toEqual([['2025-04-26', '2025-05-25']])
  })

  it('last_90_days: rolling 90-day window anchored on latest available data date', () => {
    const { current, prior } = comparablePeriod(window('2026-01-01', '2026-05-24'), 'last_90_days')
    expect(rangesToISO(current)).toEqual([['2026-02-24', '2026-05-24']])
    expect(rangesToISO(prior)).toEqual([['2025-02-25', '2025-05-25']])
  })

  it('clamps rolling windows to the available current-year start', () => {
    const { current } = comparablePeriod(window('2026-01-10', '2026-01-20'), 'last_30_days')
    expect(rangesToISO(current)).toEqual([['2026-01-10', '2026-01-20']])
  })

  it('Jan 1-4 2026 edge case: prior window starts before CRZ launch (Jan 5, 2025)', () => {
    const { current, prior } = comparablePeriod(window('2026-01-01', '2026-01-03'), 'ytd')
    expect(rangesToISO(current)).toEqual([['2026-01-01', '2026-01-03']])
    expect(rangesToISO(prior)).toEqual([['2025-01-02', '2025-01-04']])
    expect(prior[0]![0] < d('2025-01-05')).toBe(true)
  })

})

describe('parseISODateOnly', () => {
  it('accepts a valid YYYY-MM-DD date', () => {
    const parsed = parseISODateOnly('2026-05-24')
    expect(parsed).not.toBeNull()
    expect(toISODate(parsed!)).toBe('2026-05-24')
  })

  it('rejects malformed date strings', () => {
    expect(parseISODateOnly('2026-5-24')).toBeNull()
    expect(parseISODateOnly('05/24/2026')).toBeNull()
  })

  it('rejects impossible calendar dates', () => {
    expect(parseISODateOnly('2026-02-31')).toBeNull()
    expect(parseISODateOnly('2026-13-01')).toBeNull()
  })
})

describe('normalizeDateRange', () => {
  it('requires both boundaries', () => {
    expect(normalizeDateRange('2026-05-01', undefined).error).toBe('Choose both a start and end date.')
    expect(normalizeDateRange(undefined, '2026-05-07').error).toBe('Choose both a start and end date.')
  })

  it('rejects start dates after end dates', () => {
    expect(normalizeDateRange('2026-05-08', '2026-05-07').error).toBe(
      'Start date must be on or before end date.',
    )
  })

  it('returns a parsed valid range', () => {
    const result = normalizeDateRange('2026-05-01', '2026-05-07')
    expect(result.error).toBeUndefined()
    expect(result.range?.map(toISODate)).toEqual(['2026-05-01', '2026-05-07'])
  })
})

describe('periodFromFilter', () => {
  it('maps the ytd filter to the comparable period', () => {
    const result = periodFromFilter(window('2026-01-01', '2026-05-24'), {
      preset: 'ytd',
      entryType: 'CRZ',
      dayType: 'all',
    })

    expect(result.error).toBeUndefined()
    expect(rangesToISO(result.period!.current)).toEqual([['2026-01-01', '2026-05-24']])
    expect(rangesToISO(result.period!.prior)).toEqual([['2025-01-02', '2025-05-25']])
  })

  it('maps a valid custom filter to a comparable period', () => {
    const result = periodFromFilter(window('2026-01-01', '2026-05-24'), {
      preset: 'custom',
      customStart: '2026-05-01',
      customEnd: '2026-05-07',
      entryType: 'CRZ',
      dayType: 'all',
    })

    expect(result.error).toBeUndefined()
    expect(rangesToISO(result.period!.current)).toEqual([['2026-05-01', '2026-05-07']])
    expect(rangesToISO(result.period!.prior)).toEqual([['2025-05-02', '2025-05-08']])
  })

  it('requires both custom filter boundaries', () => {
    const result = periodFromFilter(window('2026-01-01', '2026-05-24'), {
      preset: 'custom',
      customStart: '2026-05-01',
      entryType: 'CRZ',
      dayType: 'all',
    })

    expect(result.error).toBe('Choose both a start and end date.')
  })

  it('rejects custom filters outside the data window', () => {
    const result = periodFromFilter(window('2026-01-01', '2026-05-24'), {
      preset: 'custom',
      customStart: '2026-05-01',
      customEnd: '2026-05-25',
      entryType: 'CRZ',
      dayType: 'all',
    })

    expect(result.error).toBe('Choose dates between January 1, 2026 and May 24, 2026.')
  })
})

describe('parseUrlFilterState', () => {
  it('falls back to ytd for old custom month URLs', () => {
    const state = parseUrlFilterState(
      new URLSearchParams('preset=custom&months=2026-01,2026-03&entryType=Combined&dayType=weekday'),
      window('2026-01-01', '2026-05-24'),
    )

    expect(state).toEqual({
      preset: 'ytd',
      entryType: 'Combined',
      dayType: 'weekday',
    })
  })

  it('maps legacy preset URLs to the new rolling presets', () => {
    expect(parseUrlFilterState(new URLSearchParams('preset=last_week')).preset).toBe('last_30_days')
    expect(parseUrlFilterState(new URLSearchParams('preset=last_month')).preset).toBe('last_90_days')
  })
})
