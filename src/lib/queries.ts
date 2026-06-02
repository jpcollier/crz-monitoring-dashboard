import type { ComparablePeriod } from './alignment'
import { toISODate } from './alignment'
import { query } from './duckdb'
import type { DayType, EntryType } from './types'

// Returns a WHERE clause fragment for entry_type.
// 'Combined' means both CRZ and Excluded — no filter needed.
// The EntryType values 'CRZ' and 'Excluded' match the exact strings in the Parquet.
function etClause(entryType: EntryType): string {
  if (entryType === 'Combined') return ''
  return `AND entry_type = '${entryType}'`
}

// All dates arriving here come from alignment.ts pure functions, not user strings.
function rangeWhere(ranges: ComparablePeriod['current']): string {
  return ranges
    .map(([start, end]) => `(date BETWEEN '${toISODate(start)}' AND '${toISODate(end)}')`)
    .join(' OR ')
}

function periodWhere(period: ComparablePeriod): string {
  return `(${rangeWhere(period.current)}) OR (${rangeWhere(period.prior)})`
}

function pairedDatePredicate(groupColumns: string[] = []): string {
  const keys = ['plot_date', ...groupColumns]
  const comparisons = keys.map((key) => `totals.${key} = paired.${key}`).join(' AND ')
  return `EXISTS (
        SELECT 1
        FROM paired_dates paired
        WHERE ${comparisons}
      )`
}

function pctChangeExpr(currentExpr: string, priorExpr: string): string {
  return `CASE
        WHEN ${priorExpr} = 0 THEN NULL
        ELSE ROUND((${currentExpr} - ${priorExpr}) / ${priorExpr} * 100, 1)
      END`
}

// Optional hourly-profile day filter. DuckDB strftime('%w') returns 0 for
// Sunday through 6 for Saturday, so weekdays are Monday-Friday.
function dayTypeClause(dayType: DayType = 'all'): string {
  if (dayType === 'weekday') return `AND strftime(date, '%w') BETWEEN '1' AND '5'`
  if (dayType === 'weekend') return `AND strftime(date, '%w') IN ('0', '6')`
  return ''
}

// Converts a 2025-era date to the equivalent 2026-era plot date (adds 364 days).
// Used so both years share the same x-axis scale in Observable Plot.
const PLOT_DATE_EXPR = `
  CASE WHEN YEAR(date) = 2026 THEN CAST(date AS VARCHAR)
       ELSE CAST(CAST(date + INTERVAL 364 DAY AS DATE) AS VARCHAR)
  END`

// ---------------------------------------------------------------------------
// Row types — consumed by chart components via useDuckQuery
// ---------------------------------------------------------------------------

export interface DailyYoYRow {
  plot_date: string // YYYY-MM-DD, always in 2026-era
  year: number // 2025 | 2026
  entries: number
}

export interface DailyGroupTimeRow {
  plot_date: string
  year: number
  detection_group: string
  entries: number
}

export interface GroupAggRow {
  detection_group: string
  current_entries: number // 2026 total over dates present in both years
  prior_entries: number // 2025 total over dates present in both years
  pct_change: number | null // (current - prior) / prior * 100, null when no prior data
}

export interface DailyClassTimeRow {
  plot_date: string
  year: number
  vehicle_class: string
  entries: number
}

export interface ClassAggRow {
  vehicle_class: string
  current_entries: number
  prior_entries: number
  pct_change: number | null
}

export interface SystemwideAggRow {
  current_entries: number
  prior_entries: number
  pct_change: number | null
  current_days: number
}

// Hourly profile row types — consumed by HourlyProfileChart and HourlyFacilityGrid
export interface HourlyYoYRow {
  year: number        // 2025 | 2026
  hour: number        // 0–23
  avg_entries: number // SUM(entries) / COUNT(DISTINCT date) for the period
}

export interface HourlyGroupRow {
  year: number
  detection_group: string
  hour: number
  avg_entries: number
}

export interface HourlyClassRow {
  year: number
  vehicle_class: string
  hour: number
  avg_entries: number
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/** Time-series data for the systemwide YoY daily chart (two lines). */
export async function queryDailyYoY(
  period: ComparablePeriod,
  entryType: EntryType,
): Promise<DailyYoYRow[]> {
  return query<DailyYoYRow>(`
    SELECT
      ${PLOT_DATE_EXPR}              AS plot_date,
      CAST(YEAR(date) AS INTEGER)   AS year,
      CAST(SUM(entries) AS DOUBLE)  AS entries
    FROM daily
    WHERE (${periodWhere(period)})
    ${etClause(entryType)}
    GROUP BY date
    ORDER BY plot_date, year
  `)
}

/** Aggregate totals for systemwide ChangeBadge (single row). */
export async function querySystemwideSummary(
  period: ComparablePeriod,
  entryType: EntryType,
  dayType: DayType = 'all',
): Promise<SystemwideAggRow[]> {
  return query<SystemwideAggRow>(`
    WITH daily_totals AS (
      SELECT
        ${PLOT_DATE_EXPR}             AS plot_date,
        CAST(YEAR(date) AS INTEGER)  AS year,
        CAST(SUM(entries) AS DOUBLE) AS entries
      FROM daily
      WHERE (${periodWhere(period)})
      ${etClause(entryType)}
      ${dayTypeClause(dayType)}
      GROUP BY plot_date, year
    ),
    paired_dates AS (
      SELECT plot_date
      FROM daily_totals
      GROUP BY plot_date
      HAVING COUNT(DISTINCT year) = 2
    ),
    comparable_totals AS (
      SELECT *
      FROM daily_totals totals
      WHERE ${pairedDatePredicate()}
    ),
    summary AS (
      SELECT
        CAST(COALESCE(SUM(CASE WHEN year = 2026 THEN entries ELSE 0 END), 0) AS DOUBLE) AS current_entries,
        CAST(COALESCE(SUM(CASE WHEN year = 2025 THEN entries ELSE 0 END), 0) AS DOUBLE) AS prior_entries,
        CAST(COUNT(DISTINCT CASE WHEN year = 2026 THEN plot_date END) AS INTEGER) AS current_days
      FROM comparable_totals
    )
    SELECT
      current_entries,
      prior_entries,
      ${pctChangeExpr('current_entries', 'prior_entries')} AS pct_change,
      current_days
    FROM summary
  `)
}

/** Time-series data for DailyFacilityGrid (one row per date × group × year). */
export async function queryDailyByGroup(
  period: ComparablePeriod,
  entryType: EntryType,
): Promise<DailyGroupTimeRow[]> {
  return query<DailyGroupTimeRow>(`
    SELECT
      ${PLOT_DATE_EXPR}              AS plot_date,
      CAST(YEAR(date) AS INTEGER)   AS year,
      detection_group               AS detection_group,
      CAST(SUM(entries) AS DOUBLE)  AS entries
    FROM daily
    WHERE (${periodWhere(period)})
    ${etClause(entryType)}
    GROUP BY date, detection_group
    ORDER BY detection_group, plot_date, year
  `)
}

/** Per-facility aggregate totals for ChangeBadge on each facility card. */
export async function queryGroupSummary(
  period: ComparablePeriod,
  entryType: EntryType,
  dayType: DayType = 'all',
): Promise<GroupAggRow[]> {
  return query<GroupAggRow>(`
    WITH daily_totals AS (
      SELECT
        detection_group,
        ${PLOT_DATE_EXPR}             AS plot_date,
        CAST(YEAR(date) AS INTEGER)  AS year,
        CAST(SUM(entries) AS DOUBLE) AS entries
      FROM daily
      WHERE (${periodWhere(period)})
      ${etClause(entryType)}
      ${dayTypeClause(dayType)}
      GROUP BY detection_group, plot_date, year
    ),
    paired_dates AS (
      SELECT detection_group, plot_date
      FROM daily_totals
      GROUP BY detection_group, plot_date
      HAVING COUNT(DISTINCT year) = 2
    ),
    comparable_totals AS (
      SELECT *
      FROM daily_totals totals
      WHERE ${pairedDatePredicate(['detection_group'])}
    ),
    summary AS (
      SELECT
        detection_group,
        CAST(COALESCE(SUM(CASE WHEN year = 2026 THEN entries ELSE 0 END), 0) AS DOUBLE) AS current_entries,
        CAST(COALESCE(SUM(CASE WHEN year = 2025 THEN entries ELSE 0 END), 0) AS DOUBLE) AS prior_entries
      FROM comparable_totals
      GROUP BY detection_group
    )
    SELECT
      detection_group,
      current_entries,
      prior_entries,
      ${pctChangeExpr('current_entries', 'prior_entries')} AS pct_change
    FROM summary
    ORDER BY current_entries DESC
  `)
}

/** Time-series data for FacilityDetailModal (one row per date × class × year). */
export async function queryDailyByClass(
  detectionGroup: string,
  period: ComparablePeriod,
  entryType: EntryType,
): Promise<DailyClassTimeRow[]> {
  return query<DailyClassTimeRow>(`
    SELECT
      ${PLOT_DATE_EXPR}              AS plot_date,
      CAST(YEAR(date) AS INTEGER)   AS year,
      vehicle_class                 AS vehicle_class,
      CAST(SUM(entries) AS DOUBLE)  AS entries
    FROM daily
    WHERE (${periodWhere(period)})
    AND detection_group = '${detectionGroup.replace(/'/g, "''")}'
    ${etClause(entryType)}
    GROUP BY date, vehicle_class
    ORDER BY vehicle_class, plot_date, year
  `)
}

/** Per-class aggregate totals for ChangeBadge in the drawer. */
export async function queryClassSummary(
  detectionGroup: string,
  period: ComparablePeriod,
  entryType: EntryType,
  dayType: DayType = 'all',
): Promise<ClassAggRow[]> {
  return query<ClassAggRow>(`
    WITH daily_totals AS (
      SELECT
        vehicle_class,
        ${PLOT_DATE_EXPR}             AS plot_date,
        CAST(YEAR(date) AS INTEGER)  AS year,
        CAST(SUM(entries) AS DOUBLE) AS entries
      FROM daily
      WHERE (${periodWhere(period)})
      AND detection_group = '${detectionGroup.replace(/'/g, "''")}'
      ${etClause(entryType)}
      ${dayTypeClause(dayType)}
      GROUP BY vehicle_class, plot_date, year
    ),
    paired_dates AS (
      SELECT vehicle_class, plot_date
      FROM daily_totals
      GROUP BY vehicle_class, plot_date
      HAVING COUNT(DISTINCT year) = 2
    ),
    comparable_totals AS (
      SELECT *
      FROM daily_totals totals
      WHERE ${pairedDatePredicate(['vehicle_class'])}
    ),
    summary AS (
      SELECT
        vehicle_class,
        CAST(COALESCE(SUM(CASE WHEN year = 2026 THEN entries ELSE 0 END), 0) AS DOUBLE) AS current_entries,
        CAST(COALESCE(SUM(CASE WHEN year = 2025 THEN entries ELSE 0 END), 0) AS DOUBLE) AS prior_entries
      FROM comparable_totals
      GROUP BY vehicle_class
    )
    SELECT
      vehicle_class,
      current_entries,
      prior_entries,
      ${pctChangeExpr('current_entries', 'prior_entries')} AS pct_change
    FROM summary
    ORDER BY current_entries DESC
  `)
}

// ---------------------------------------------------------------------------
// Hourly profile queries — used by HourlyProfileChart, HourlyFacilityGrid,
// and FacilityDetailModal (hourly mode)
// ---------------------------------------------------------------------------

/**
 * Systemwide average-entries-per-hour profile for both years.
 * avg_entries = SUM(entries) / COUNT(DISTINCT date) within each year-hour bucket.
 * Reuses the same periodWhere / etClause helpers as the daily queries.
 */
export async function queryHourlyYoY(
  period: ComparablePeriod,
  entryType: EntryType,
  dayType: DayType = 'all',
): Promise<HourlyYoYRow[]> {
  return query<HourlyYoYRow>(`
    SELECT
      CAST(YEAR(date) AS INTEGER)                         AS year,
      hour,
      CAST(SUM(entries) AS DOUBLE) / COUNT(DISTINCT date) AS avg_entries
    FROM hourly
    WHERE (${periodWhere(period)})
    ${etClause(entryType)}
    ${dayTypeClause(dayType)}
    GROUP BY YEAR(date), hour
    ORDER BY year, hour
  `)
}

/** Per-facility average-entries-per-hour for the small-multiples grid. */
export async function queryHourlyByGroup(
  period: ComparablePeriod,
  entryType: EntryType,
  dayType: DayType = 'all',
): Promise<HourlyGroupRow[]> {
  return query<HourlyGroupRow>(`
    SELECT
      CAST(YEAR(date) AS INTEGER)                         AS year,
      detection_group,
      hour,
      CAST(SUM(entries) AS DOUBLE) / COUNT(DISTINCT date) AS avg_entries
    FROM hourly
    WHERE (${periodWhere(period)})
    ${etClause(entryType)}
    ${dayTypeClause(dayType)}
    GROUP BY YEAR(date), detection_group, hour
    ORDER BY detection_group, year, hour
  `)
}

/** Per-class average-entries-per-hour for FacilityDetailModal (hourly mode). */
export async function queryHourlyByClass(
  detectionGroup: string,
  period: ComparablePeriod,
  entryType: EntryType,
  dayType: DayType = 'all',
): Promise<HourlyClassRow[]> {
  return query<HourlyClassRow>(`
    SELECT
      CAST(YEAR(date) AS INTEGER)                         AS year,
      vehicle_class,
      hour,
      CAST(SUM(entries) AS DOUBLE) / COUNT(DISTINCT date) AS avg_entries
    FROM hourly
    WHERE (${periodWhere(period)})
    AND detection_group = '${detectionGroup.replace(/'/g, "''")}'
    ${etClause(entryType)}
    ${dayTypeClause(dayType)}
    GROUP BY YEAR(date), vehicle_class, hour
    ORDER BY vehicle_class, year, hour
  `)
}
