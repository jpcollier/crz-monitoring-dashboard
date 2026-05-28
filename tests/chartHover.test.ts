import { describe, expect, it } from 'vitest'

import { buildDailyHoverRows } from '../src/components/charts/chartHover'

describe('buildDailyHoverRows', () => {
  it('aligns prior-year hover values by shifted plot_date instead of raw date', () => {
    const rows = [
      {
        year: 2025,
        date: new Date('2025-01-06T00:00:00Z'),
        plot_date: '2026-01-05',
        entries: 125,
      },
      {
        year: 2026,
        date: new Date('2026-01-05T00:00:00Z'),
        plot_date: '2026-01-05',
        entries: 250,
      },
    ]

    expect(buildDailyHoverRows(rows, (row) => row.entries)).toEqual([
      {
        date: rows[1].date,
        plot_date: '2026-01-05',
        value2026: 250,
        value2025: 125,
      },
    ])
  })
})
