# Custom Date Range Filter Implementation Plan

## Problem statement

Selecting the `Custom` period currently exposes start and end date inputs, but the application cannot reliably render a custom window. The likely failure path is:

1. `FilterBar` switches the URL state to `preset=custom` before either date input has a value.
2. Each view only creates `customRange` when both `customStart` and `customEnd` are present.
3. The views still call `comparablePeriod(today, 'custom', undefined)` while the dates are missing.
4. `comparablePeriod` intentionally throws when the custom preset has no range, so selecting `Custom` can crash the view before the user can complete the range.

The implementation should make custom ranges first-class, validated filter state instead of relying on the chart views to tolerate incomplete input.

## Branch

Use branch: `fix/custom-date-range-filter`.

This planning branch is `plan/custom-date-range-filter`; implementation work should branch from the current base or rename/create the fix branch before coding.

## Goals

- Users can select `Custom` without crashing the page.
- Date inputs have sensible defaults or the charts remain in a clear disabled/empty state until the range is complete.
- Start and end dates are validated before querying DuckDB.
- A valid custom range updates every affected chart/query on both the daily and hourly pages.
- The custom range remains shareable/bookmarkable through URL parameters.
- Preset filters continue to work exactly as they do today.

## Non-goals

- No backend changes.
- No runtime Socrata fetches.
- No changes to the Parquet data artifacts.
- No change to the 364-day weekday-alignment rule.

## Proposed implementation

### 1. Centralize custom date parsing and validation

Add helpers in `src/lib/alignment.ts` for date-only parsing and filter-to-period conversion:

- `parseISODateOnly(value: string): Date | null`
  - Accept only `YYYY-MM-DD`.
  - Construct dates with `new Date(year, monthIndex, day)` to avoid browser timezone shifts.
  - Reject impossible dates like `2026-02-31`.
- `normalizeDateRange(start: string | undefined, end: string | undefined): { range?: [Date, Date]; error?: string }`
  - Require both dates.
  - Reject `start > end`.
  - Optionally clamp or reject dates beyond available data once metadata bounds are exposed.
- `periodFromFilter(today: Date, state: FilterState): { period?: ComparablePeriod; error?: string }`
  - For non-custom presets, delegate to `comparablePeriod`.
  - For custom, return a validation error until the range is complete/valid instead of throwing.

Keep `comparablePeriod` strict if useful for internal callers, but do not call it directly from views with unvalidated custom state.

### 2. Make selecting Custom immediately usable

Choose one UX path and apply it consistently:

**Recommended:** seed default dates when the user selects `Custom`.

- In `FilterBar`, replace `onChange={(preset) => setState({ preset })}` with a handler.
- When switching to `custom` and either custom date is missing, set defaults such as the current `last_week` window or the current visible period.
- Preserve existing `customStart`/`customEnd` if the user previously set them.

Alternative acceptable path:

- Allow empty custom fields, but render an inline validation message and skip chart queries until complete.

The recommended seeding path is less disruptive because the charts continue to render immediately after the `Custom` toggle.

### 3. Update both views to consume validated periods

Refactor `DailyEntriesView` and `HourlyProfilesView` so they both use the centralized helper from step 1.

- Remove duplicated `customRange` construction from each view.
- If the helper returns an error, show an inline filter error panel near the filter bar and do not run data queries.
- If the helper returns a period, compute dependency keys from that period and run the existing query functions.

Because React hooks cannot be called conditionally, either:

- pass query functions that return `Promise.resolve([])` while invalid, or
- extend `useDuckQuery` with an `enabled` option and use `enabled: Boolean(period)`.

The `enabled` option is cleaner and prevents unnecessary loading states for invalid filters.

### 4. Preserve URL behavior

Update `useUrlState` carefully:

- Continue parsing `preset`, `entryType`, `dayType`, `customStart`, and `customEnd` from URL parameters.
- Keep custom date parameters only when `preset=custom`.
- Consider clearing custom params when switching away from custom only if the team does not want stale values restored later.
- Ensure malformed URL dates do not crash the app; they should become missing values and trigger validation/defaulting.

### 5. Keep SQL/query behavior unchanged for valid ranges

The existing query layer already accepts a `ComparablePeriod` and filters both the current and prior 364-day shifted windows. Once views supply a valid period, no SQL rewrite should be necessary.

Verify the dependency arrays include both custom boundaries so query hooks refetch when either date changes.

### 6. Add tests

Add or update Vitest coverage for:

- strict date-only parsing (`YYYY-MM-DD`, invalid calendar dates, malformed strings),
- missing custom start/end handling,
- `start > end` validation,
- valid custom period mapping to current and prior windows,
- URL parsing for malformed custom date params,
- `useDuckQuery` `enabled` behavior if that hook is changed.

If component testing utilities are available or added, add a regression test for selecting `Custom` and confirming the page does not throw before dates are filled.

### 7. Manual QA checklist

Run through both `/daily` and `/hourly`:

1. Load default page; confirm YTD still renders.
2. Select `Custom`; confirm no crash and date inputs are populated or a clear validation message appears.
3. Change start date; confirm charts refetch only after the range is valid.
4. Change end date; confirm charts update.
5. Test `start > end`; confirm no queries run and the validation message is clear.
6. Copy/paste a URL with valid custom params; confirm it restores the same view.
7. Copy/paste a URL with malformed custom params; confirm it does not crash.
8. Repeat with `Entry type` and, on `/hourly`, `Day type` filters.

## Acceptance criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- Selecting `Custom` no longer crashes either route.
- A valid custom date range updates all daily and hourly charts using the same 364-day comparison logic as presets.
- Invalid or incomplete custom date state is handled visibly and safely.
