# MTA CRZ Viewer — Project Plan

A web app that visualizes the MTA Congestion Relief Zone Vehicle Entries dataset, comparing 2026 vs. 2025 at the systemwide and per-facility level.

---

## Goal

Ship a static web app, deployed on Vercel, that lets a user see how CRZ vehicle entries have changed year-over-year — both as daily volumes and as hourly profiles — down to the facility and vehicle-class level.

## In scope

- Daily Entries view: systemwide YoY chart + per-facility small multiples + class drill-down on click.
- Hourly Profiles view: systemwide profile + per-facility small multiples + class drill-down on click.
- Period filter (YTD / last month / last week / custom) bounded to the current-year window.
- Entry-type toggle: CRZ only / Excluded Roadway only / Combined.
- Weekly automated data refresh.

## Out of scope (v1)

- Revenue, exemptions, or payment data (not in this dataset).
- Maps / geographic visualizations.
- User accounts, saved views, alerts.

---

## Locked-in tech decisions

| Concern              | Choice                                                  |
|----------------------|---------------------------------------------------------|
| Framework            | Vite + React + TypeScript                               |
| Styling              | TailwindCSS                                             |
| Charts               | Observable Plot (`@observablehq/plot`)                  |
| In-browser SQL       | DuckDB-Wasm (`@duckdb/duckdb-wasm`)                     |
| Data format          | Parquet, hosted as static assets                        |
| Data pipeline        | Python + DuckDB (build script), pulls from Socrata API  |
| URL state            | TanStack Router or `useSearchParams` (decide in Phase 2)|
| Hosting              | Vercel (static)                                         |
| Data refresh         | GitHub Actions cron, weekly                             |

---

## Data spec (lock these in writing — every downstream task depends on them)

### Source

- Dataset: `t6yz-b64h` on data.ny.gov ("MTA Congestion Relief Zone Vehicle Entries: Beginning 2025").
- API: `https://data.ny.gov/resource/t6yz-b64h.json` (Socrata SODA 2.1).
- CSV bulk export: `https://data.ny.gov/api/views/t6yz-b64h/rows.csv?accessType=DOWNLOAD`.
- Granularity: 10-minute intervals × detection group × vehicle class × CRZ-vs-Excluded.

### Weekday alignment rule

To compare 2026 to 2025, shift any 2026 date back by exactly **364 days**. 364 = 52 × 7, so the shifted date lands on the same day of the week. Compute once at build time as a `comparison_date` column on the 2026 rows (or equivalently shift 2025 forward by 364 days on the 2025 rows — pick one direction and stay consistent; default: add `comparison_date_2025 = date - 364 days` on 2026 rows and join).

Edge case: Jan 1–4 2026 has no 2025 comparable (CRZ launched Jan 5, 2025). Render those bins with the 2026 line only and a small "no prior-year data" note.

### Comparable period rule

Hourly profiles and any "current period" aggregate use the window `[Jan 1, current_year, today]`. The 2025 comparison window is the same calendar window shifted back 364 days. This sliding 2025 window must be recomputed every build.

### Aggregation grain shipped to the browser

Pre-aggregate to two Parquet files:

1. **`crz_daily.parquet`** — one row per `(date, detection_group, vehicle_class, entry_type)`, value = entry count. ~ 100k rows by end of 2026.
2. **`crz_hourly.parquet`** — one row per `(date, hour, detection_group, vehicle_class, entry_type)`, value = entry count. ~ 2.5M rows by end of 2026 → ~30–50 MB Parquet, acceptable for HTTP range fetch via DuckDB-Wasm.

Both tables include a `comparison_date` column for 2026 rows (NULL for 2025 rows). `entry_type` ∈ `{CRZ, Excluded}`.

---

## Repository layout

```
mta-crz-viewer/
├── .claude/
│   └── agents/                      # custom subagent definitions (see below)
├── .github/workflows/
│   ├── data-refresh.yml             # weekly cron → rebuild Parquet, commit
│   └── ci.yml                       # typecheck, test, build on PR
├── scripts/
│   ├── build_data.py                # pulls Socrata, aggregates, writes Parquet
│   ├── validate_data.py             # post-build sanity checks
│   └── requirements.txt
├── public/data/
│   ├── crz_daily.parquet
│   ├── crz_hourly.parquet
│   └── metadata.json                # last_updated, row counts, schema version
├── src/
│   ├── lib/
│   │   ├── duckdb.ts                # DuckDB-Wasm bootstrap + connection pool
│   │   ├── queries.ts               # named SQL fragments
│   │   ├── alignment.ts             # comparable-period helpers (pure functions)
│   │   └── types.ts
│   ├── hooks/
│   │   ├── useDuckQuery.ts
│   │   └── useUrlState.ts
│   ├── components/
│   │   ├── FilterBar.tsx
│   │   ├── ChangeBadge.tsx
│   │   ├── ClassBreakdownDrawer.tsx
│   │   └── charts/
│   │       ├── YoYDailyChart.tsx
│   │       ├── DailyFacilityGrid.tsx
│   │       ├── HourlyProfileChart.tsx
│   │       └── HourlyFacilityGrid.tsx
│   ├── views/
│   │   ├── DailyEntriesView.tsx
│   │   └── HourlyProfilesView.tsx
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   └── alignment.test.ts
├── CLAUDE.md                        # project context for Claude Code
├── PLAN.md                          # this file
└── README.md
```

---

## Custom subagents to define

Create these in `.claude/agents/` before kicking off Phase 1. Each is invoked explicitly (`@agent-<name>` or via the Task tool) — don't rely on auto-routing.

### `data-explorer` (read-only, Haiku)

Owns: Socrata schema reconnaissance, sample profiling, writing findings to `docs/dataset-notes.md`. Tools: `Read`, `Bash`, `WebFetch`. No file writes outside `docs/`.

### `data-pipeline` (general-purpose, Sonnet)

Owns: `scripts/build_data.py`, `scripts/validate_data.py`, and the GitHub Actions workflow that runs them. Knows the data spec (weekday alignment, comparable period, aggregation grain). Tools: full.

### `chart-builder` (general-purpose, Sonnet)

Owns: a single chart component file at a time. Given a spec (data shape, axes, faceting, badge content), produces one `.tsx` file using Observable Plot. Tools: `Read`, `Write`, `Edit`. Forbidden from touching `scripts/` or shared `lib/`.

### `doc-writer` (general-purpose, Haiku)

Owns: `README.md` and any user-facing docs. Runs at end of project against the finished codebase.

---

## Phased task breakdown

Each task lists: **owner**, **inputs**, **outputs**, **done when**, and **parallelizable with**. Tasks in the same phase tagged `‖` can run as parallel subagent invocations.

### Phase 0 — Discovery (½ day, sequential)

**0.1 — Profile the dataset**
- Owner: `data-explorer`
- Inputs: dataset ID `t6yz-b64h`.
- Outputs: `docs/dataset-notes.md` containing: exact column names + types, full list of detection groups with row counts per group, vehicle class taxonomy with row counts, CRZ-vs-Excluded encoding (column name + exact string values), date range covered, any nulls/anomalies, and a 50-row sample.
- Done when: file exists and answers every question above using actual API responses (not memory).

### Phase 1 — Data pipeline (1–1.5 days)

**1.1 — `build_data.py`** (sequential, blocks everything downstream)
- Owner: `data-pipeline`
- Inputs: `docs/dataset-notes.md`, the data spec from this file.
- Outputs: `scripts/build_data.py` that (a) pulls full dataset via Socrata paginated `$limit/$offset` or CSV bulk export, (b) loads to DuckDB, (c) aggregates to daily and hourly grain per spec, (d) computes `comparison_date` for 2026 rows via `date - INTERVAL 364 DAY`, (e) writes `public/data/crz_daily.parquet`, `public/data/crz_hourly.parquet`, `public/data/metadata.json`.
- Done when: running locally produces all three files in < 5 minutes; row counts logged match the source within rounding.

**1.2 — `validate_data.py`** ‖ with 1.3
- Owner: `data-pipeline`
- Inputs: built Parquet files.
- Outputs: a script that fails non-zero if: any 2026 detection_group is missing from 2025, daily totals disagree with hourly sums by > 0.1%, any expected column is missing, or `metadata.json` is stale by > 8 days.
- Done when: script exits 0 on a healthy build and non-zero on a deliberately broken one (write one test case).

**1.3 — GitHub Actions weekly refresh** ‖ with 1.2
- Owner: `data-pipeline`
- Inputs: working `build_data.py` and `validate_data.py`.
- Outputs: `.github/workflows/data-refresh.yml` that runs Mondays at 06:00 ET, installs Python deps, runs build + validate, commits any changed Parquet files to `main`, and triggers a Vercel deploy via the standard git-push mechanism.
- Done when: the workflow runs green on a manual `workflow_dispatch`.

### Phase 2 — App scaffold + data layer (1 day, sequential)

**2.1 — Bootstrap project**
- Owner: main thread
- Outputs: Vite + React + TS scaffolded, Tailwind configured, Observable Plot and DuckDB-Wasm installed, `vercel.json` if needed, basic page skeleton with a header and routing for `/daily` and `/hourly`.
- Done when: `pnpm dev` shows two empty routes.

**2.2 — DuckDB-Wasm bootstrap in `lib/duckdb.ts`**
- Owner: main thread
- Outputs: a singleton that initializes DuckDB-Wasm, registers the two Parquet files as views (`daily`, `hourly`) via HTTP range, and exports an async `query<T>(sql, params)` function.
- Done when: a manual call in dev console returns row counts from both views.

**2.3 — `lib/alignment.ts` + tests** ‖ with 2.4
- Owner: main thread or `chart-builder`
- Outputs: pure functions `comparablePeriod(today: Date, preset: 'ytd'|'last_month'|'last_week'|'custom', custom?: [Date, Date]): { current: [Date, Date]; prior: [Date, Date] }` and `shift364(date: Date): Date`. Plus Vitest tests covering: YTD on May 24 2026, last-7-days that straddles a year boundary, custom range, and the Jan 1–4 2026 edge case.
- Done when: tests pass.

**2.4 — `FilterBar` component + URL state** ‖ with 2.3
- Owner: main thread
- Outputs: `FilterBar.tsx` with period preset selector and CRZ/Excluded/Combined toggle, both wired to URL search params via `useUrlState` so views are shareable.
- Done when: changing any control updates the URL and survives a refresh.

### Phase 3 — Daily Entries view (1.5 days; 3.2 and 3.3 ‖)

**3.1 — `YoYDailyChart`** (foreground, blocks 3.4)
- Owner: `chart-builder`
- Inputs: `daily` view in DuckDB, filter state.
- Outputs: full-width chart with two lines (2025 weekday-aligned vs 2026), date on x-axis using 2026 dates, hover tooltip showing both values + delta + %, plus a `ChangeBadge` in the top-right showing aggregate % change for the visible window. Honors CRZ/Excluded/Combined toggle.
- Done when: visually correct on the latest build; total in badge matches a hand-spot-check from a separate SQL run.

**3.2 — `DailyFacilityGrid` (small multiples)** ‖ with 3.3
- Owner: `chart-builder`
- Outputs: grid of facility-level charts using Plot's `fx` facet, each card with its own `ChangeBadge` in the top-right. Sort cards by 2026 volume descending. Each card is clickable.
- Done when: all detection groups render; clicking emits an event with the group name.

**3.3 — `ChangeBadge` component** ‖ with 3.2
- Owner: `chart-builder`
- Outputs: a small reusable badge component showing `+12.3%` / `−4.1%` with color (green for decrease in entries since that's the program goal — or pick the opposite, document it), an arrow icon, and an optional tooltip. Pure presentation, no data fetching.
- Done when: storybook-style preview in `App.tsx` shows positive, negative, and zero states.

**3.4 — `ClassBreakdownDrawer`** (depends on 3.2)
- Owner: `chart-builder`
- Outputs: side drawer that opens when a facility card is clicked. Shows the same YoY daily comparison but broken out by `vehicle_class` as small multiples or stacked area (prototype both, pick one).
- Done when: opens, closes, shows correct facility name, charts render from DuckDB query.

### Phase 4 — Hourly Profiles view (1.5 days; 4.1 and 4.2 ‖)

**4.1 — `HourlyProfileChart`** ‖ with 4.2
- Owner: `chart-builder`
- Outputs: 0–23 x-axis, average entries-per-hour over the comparable period, 2025 vs 2026 overlay. Reuses `FilterBar` state for period and entry-type.
- Done when: switching period preset visibly changes both lines.

**4.2 — `HourlyFacilityGrid`** ‖ with 4.1
- Owner: `chart-builder`
- Outputs: small multiples of hourly profiles per facility. Same click-to-drill pattern.
- Done when: parity with the daily small-multiples grid.

**4.3 — Hook drill-down into `ClassBreakdownDrawer`**
- Owner: `chart-builder`
- Outputs: drawer gains a mode prop (`'daily' | 'hourly'`); renders by-class hourly profile when invoked from hourly grid.
- Done when: clicking a card in either view opens the correct breakdown.

### Phase 5 — Polish, docs, deploy (½–1 day)

**5.1 — Empty / loading / error states** — main thread.
**5.2 — Mobile layout pass** — main thread. Small multiples collapse to single column < 640px.
**5.3 — `README.md`** — `doc-writer`. Inputs: finished repo + this plan. Covers install, dev, manual data refresh, deploy, where the data comes from.
**5.4 — `CLAUDE.md`** — main thread. Project context for future Claude Code sessions: data spec recap, dir layout, run commands, do/don't list.
**5.5 — Vercel deploy** — main thread. Connect repo, verify Parquet files serve correctly (no Vercel size limit hit), confirm the cron-driven data refresh redeploys the site.

---

## Open questions to resolve in Phase 0

- Exact name of the column holding CRZ vs Excluded distinction, and exact string values.
- Whether `vehicle_class` includes a "Total" or "Unclassified" row that needs to be filtered out to avoid double counting.
- Whether Socrata's CSV bulk endpoint is fast enough or if pagination via JSON API is needed.
- Whether the `public/data` Parquet files exceed any Vercel asset size limit (currently 100 MB per file on Hobby; we expect ~30–50 MB).

## Risks and mitigations

- **Detection group renames between 2025 and 2026.** Mitigation: 1.2 fails the build if any 2026 group is missing from 2025; a maintenance task adds an alias map if needed.
- **DuckDB-Wasm cold start latency.** Mitigation: show a single global "Loading data…" state on first nav; subsequent queries are fast.
- **Plot facet performance with 13+ facilities.** Mitigation: pre-aggregate aggressively; if still slow, render facets lazily as they scroll into view (IntersectionObserver).
- **Opus over-spawning subagents.** Mitigation: invoke subagents explicitly; for trivial edits, keep work on the main thread.
