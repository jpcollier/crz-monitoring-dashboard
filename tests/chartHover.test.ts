import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDailyHoverRows, fmtAxisCount, formatHoverReadout } from '../src/components/charts/chartHover'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildDailyHoverRows', () => {
  it('pairs 2026 and 2025 values by plot_date calendar day', () => {
    const rows = [
      { year: 2025, date: new Date('2026-01-05T05:00:00.000Z'), plot_date: '2026-01-05 00:00:00', entries: 75 },
      { year: 2026, date: new Date('2026-01-05T00:00:00.000Z'), plot_date: '2026-01-05', entries: 100 },
    ]

    expect(buildDailyHoverRows(rows, (row) => row.entries)).toEqual([
      {
        date: rows[1]!.date,
        plot_date: '2026-01-05',
        value2026: 100,
        value2025: 75,
      },
    ])
  })
})

describe('formatHoverReadout', () => {
  it('uses the 2026-era plot_date for daily labels so UTC-midnight dates cannot shift to the prior day', () => {
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('Jan 4')

    expect(
      formatHoverReadout({
        date: new Date('2026-01-05'),
        plot_date: '2026-01-05',
        value2026: 100,
        value2025: 75,
      }).timeLabel,
    ).toBe('Jan 5')
  })
})

describe('fmtAxisCount', () => {
  it('keeps one decimal for compact K labels when rounding would collapse nearby ticks', () => {
    expect(fmtAxisCount(1_240)).toBe('1.2K')
    expect(fmtAxisCount(1_260)).toBe('1.3K')
  })

  it('keeps one decimal for compact M labels', () => {
    expect(fmtAxisCount(1_240_000)).toBe('1.2M')
    expect(fmtAxisCount(1_260_000)).toBe('1.3M')
  })
})
