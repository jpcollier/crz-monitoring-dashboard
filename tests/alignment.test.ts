import { describe, expect, it } from 'vitest'
import {
  comparablePeriod,
  normalizeDateRange,
  parseISODateOnly,
  periodFromFilter,
  shift364,
  toISODate,
} from '../src/lib/alignment'

function d(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m! - 1, day)
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
  it('ytd: current window is Jan 1 to today', () => {
    const today = d('2026-05-24')
    const { current, prior } = comparablePeriod(today, 'ytd')
    expect(toISODate(current[0])).toBe('2026-01-01')
    expect(toISODate(current[1])).toBe('2026-05-24')
  })

  it('ytd: prior window is current shifted back 364 days', () => {
    const today = d('2026-05-24')
    const { prior } = comparablePeriod(today, 'ytd')
    expect(toISODate(prior[0])).toBe('2025-01-02') // 2026-01-01 - 364
    expect(toISODate(prior[1])).toBe('2025-05-25') // 2026-05-24 - 364
  })

  it('last_week: 7-day window ending yesterday', () => {
    const today = d('2026-05-24')
    const { current } = comparablePeriod(today, 'last_week')
    expect(toISODate(current[1])).toBe('2026-05-23') // yesterday
    expect(toISODate(current[0])).toBe('2026-05-17') // 6 days before yesterday
  })

  it('last_week: prior window is shifted 364 days back', () => {
    const today = d('2026-05-24')
    const { prior } = comparablePeriod(today, 'last_week')
    // 2026-05-17 - 364 = 2025-05-18
    expect(toISODate(prior[0])).toBe('2025-05-18')
    // 2026-05-23 - 364 = 2025-05-24
    expect(toISODate(prior[1])).toBe('2025-05-24')
  })

  it('last_month: prior month window', () => {
    const today = d('2026-05-24')
    const { current } = comparablePeriod(today, 'last_month')
    expect(toISODate(current[0])).toBe('2026-04-01')
    expect(toISODate(current[1])).toBe('2026-04-30')
  })

  it('custom range passthrough', () => {
    const today = d('2026-05-24')
    const { current, prior } = comparablePeriod(today, 'custom', [d('2026-03-01'), d('2026-03-31')])
    expect(toISODate(current[0])).toBe('2026-03-01')
    expect(toISODate(current[1])).toBe('2026-03-31')
    // 2026-03-01 - 364 = 2025-03-02
    expect(toISODate(prior[0])).toBe('2025-03-02')
    expect(toISODate(prior[1])).toBe('2025-04-01')
  })

  it('Jan 1-4 2026 edge case: prior window starts before CRZ launch (Jan 5, 2025)', () => {
    const today = d('2026-01-03')
    const { current, prior } = comparablePeriod(today, 'ytd')
    expect(toISODate(current[0])).toBe('2026-01-01')
    // prior start: 2026-01-01 - 364 = 2025-01-02 (before CRZ launch Jan 5, 2025)
    expect(toISODate(prior[0])).toBe('2025-01-02')
    // Callers are responsible for handling the absence of prior data
    // for dates before 2025-01-05 — this test confirms the math is correct.
    expect(prior[0] < d('2025-01-05')).toBe(true)
  })

  it('throws if custom preset is used without a range', () => {
    expect(() => comparablePeriod(d('2026-05-24'), 'custom')).toThrow()
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
  it('returns validation errors for incomplete custom filters instead of throwing', () => {
    const result = periodFromFilter(d('2026-05-24'), {
      preset: 'custom',
      entryType: 'CRZ',
      dayType: 'all',
    })

    expect(result.period).toBeUndefined()
    expect(result.error).toBe('Choose both a start and end date.')
  })

  it('maps valid custom filters to comparable current and prior windows', () => {
    const result = periodFromFilter(d('2026-05-24'), {
      preset: 'custom',
      entryType: 'CRZ',
      dayType: 'all',
      customStart: '2026-04-01',
      customEnd: '2026-04-30',
    })

    expect(result.error).toBeUndefined()
    expect(result.period?.current.map(toISODate)).toEqual(['2026-04-01', '2026-04-30'])
    expect(result.period?.prior.map(toISODate)).toEqual(['2025-04-02', '2025-05-01'])
  })
})
