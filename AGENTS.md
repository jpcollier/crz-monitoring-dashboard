# AGENTS.md

Context for Codex sessions on this repo. Read this before doing anything; the full task breakdown lives in `PLAN.md`.

## What this is

A static web app that visualizes the MTA Congestion Relief Zone (CRZ) Vehicle Entries dataset, comparing 2026 vs. 2025 at both daily and hourly grain. Deployed on Vercel, data refreshed weekly via GitHub Actions.

## Stack (locked)

- Vite + React + TypeScript, TailwindCSS
- Observable Plot for all charts (`@observablehq/plot`)
- DuckDB-Wasm in the browser for ad-hoc SQL over hosted Parquet
- Python + DuckDB at build time for the data pipeline
- Source: NYS Open Data dataset `t6yz-b64h` (Socrata SODA API)

## Data spec — memorize this

**Weekday alignment**: To compare 2026 to 2025, shift by exactly **364 days** (52 × 7, same day of week). Done at build time: 2026 rows carry a `comparison_date = date - INTERVAL 364 DAY` column used to join against 2025 rows.

**Comparable period**: Any "current period" aggregate uses `[Jan 1 of current year, today]`. The 2025 comparison window is the same calendar window shifted back 364 days. Recomputed every build.

**Edge case**: Jan 1–4 2026 has no 2025 comparable (CRZ launched Jan 5, 2025). Render the 2026 value only with a small "no prior-year" note.

**Aggregation grain shipped to the browser**:
- `public/data/crz_daily.parquet` — `(date, detection_group, vehicle_class, entry_type, entries)`
- `public/data/crz_hourly.parquet` — `(date, hour, detection_group, vehicle_class, entry_type, entries)`
- `entry_type ∈ {CRZ, Excluded}`

## Directory map

```
.Codex/agents/   custom subagents — invoke explicitly with @agent-<name>
scripts/          Python data pipeline (build_data.py, validate_data.py)
public/data/      Parquet artifacts + metadata.json (committed by CI)
src/lib/          DuckDB bootstrap, alignment helpers, queries — shared, edit carefully
src/hooks/        useDuckQuery, useUrlState
src/components/   FilterBar, ChangeBadge, ClassBreakdownDrawer
src/components/charts/   one file per chart component
src/views/        DailyEntriesView, HourlyProfilesView
tests/            Vitest tests (alignment logic is the main thing under test)
```

## Commands

```bash
pnpm install
pnpm dev            # local dev server
pnpm build          # production build
pnpm test           # vitest
pnpm typecheck      # tsc --noEmit

# Data refresh (runs in CI weekly; can be run locally):
cd scripts && pip install -r requirements.txt && python build_data.py && python validate_data.py
```

## Subagent usage

Four custom agents live in `.Codex/agents/`. Invoke them explicitly — auto-routing is unreliable.

- `@agent-data-explorer` — read-only schema/data investigation, writes to `docs/`
- `@agent-data-pipeline` — anything in `scripts/` or `.github/workflows/`
- `@agent-chart-builder` — one chart component in `src/components/charts/`
- `@agent-doc-writer` — `README.md` and other user-facing docs

For trivial edits, stay on the main thread — spawning a subagent for a one-line change is wasteful.

## Conventions

- TypeScript strict mode. No `any` without a `// reason:` comment.
- All SQL goes through `src/lib/queries.ts` or inline via the `useDuckQuery` hook — never construct queries inside components.
- All date math goes through `src/lib/alignment.ts`. Components do not do `new Date(...)` arithmetic.
- Tailwind utility classes only; no separate CSS files except `index.css` for globals.
- Color convention for YoY series: 2025 = neutral gray, 2026 = brand accent.
- `ChangeBadge` color direction: **decrease shown in green** (the program's stated goal is fewer entries). Document any deviation.

## Do not

- Hardcode detection group names or vehicle class strings in components. Read them from the data.
- Add a backend. This stays static.
- Pull data from Socrata at runtime in the browser. The Parquet is the API.
- Edit the Parquet files by hand — they're build artifacts.

## Where things are documented

- `PLAN.md` — phased task breakdown with acceptance criteria
- `docs/dataset-notes.md` — output of Phase 0 reconnaissance (created by `@agent-data-explorer`)
- `README.md` — user-facing, generated at the end of the project
