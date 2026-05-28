import { describe, expect, it } from 'vitest'
import { buildDailyHoverRows } from '../src/components/charts/chartHover'

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
