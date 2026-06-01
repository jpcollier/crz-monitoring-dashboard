import { describe, expect, it } from 'vitest'
import { DATA_WINDOW, formatDisplayDate } from '../src/lib/metadata'
import { toISODate } from '../src/lib/alignment'

describe('dashboard metadata helpers', () => {
  it('formats ISO date-only strings for dashboard metadata', () => {
    expect(formatDisplayDate('2026-05-16')).toBe('May 16, 2026')
  })

  it('uses the configured current window end for 2026 comparisons', () => {
    expect(toISODate(DATA_WINDOW.currentEnd)).toBe('2026-06-01')
  })
})
