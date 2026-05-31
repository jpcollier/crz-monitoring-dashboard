import { describe, expect, it } from 'vitest'
import { formatDisplayDate } from '../src/lib/metadata'

describe('formatDisplayDate', () => {
  it('formats ISO date-only strings for dashboard metadata', () => {
    expect(formatDisplayDate('2026-05-16')).toBe('May 16, 2026')
  })
})
