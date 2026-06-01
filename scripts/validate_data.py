"""
validate_data.py — Post-build sanity checks for the CRZ data pipeline
=======================================================================
Exits 0 on a clean build; exits non-zero and prints loud diagnostics on
any of the following failures:

  1. A detection_group value appears in 2026 data but not in 2025 data
     (would indicate a renamed detector breaking YoY joins).
  2. Daily totals disagree with corresponding hourly sums by > 0.1%.
  3. Any required column is missing or has the wrong dtype.
  4. metadata.json `last_updated` is older than 8 days.
  5. entry_type contains any value other than 'CRZ' or 'Excluded'.
  6. Current-year rows are missing or metadata date windows exceed source coverage.

Usage
-----
  python scripts/validate_data.py

Run after build_data.py.  Both scripts expect to be run from the repo root
or from any directory — paths are resolved relative to this file's location.
"""

import datetime
import json
import logging
import os
import sys
from typing import Any

import duckdb

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DATA_DIR = os.path.join(_REPO_ROOT, "public", "data")

DAILY_PARQUET = os.path.join(PUBLIC_DATA_DIR, "crz_daily.parquet")
HOURLY_PARQUET = os.path.join(PUBLIC_DATA_DIR, "crz_hourly.parquet")
METADATA_JSON = os.path.join(PUBLIC_DATA_DIR, "metadata.json")

STALENESS_DAYS = 8
DAILY_HOURLY_TOLERANCE = 0.001  # 0.1 %

# Expected columns: (name, duckdb_type_prefix)
# The prefix match allows e.g. "DATE" to match "DATE" exactly.
DAILY_EXPECTED_COLUMNS = [
    ("date", "DATE"),
    ("detection_group", "VARCHAR"),
    ("vehicle_class", "VARCHAR"),
    ("entry_type", "VARCHAR"),
    ("entries", "BIGINT"),
    ("comparison_date", "DATE"),
]

HOURLY_EXPECTED_COLUMNS = [
    ("date", "DATE"),
    ("hour", "TINYINT"),
    ("detection_group", "VARCHAR"),
    ("vehicle_class", "VARCHAR"),
    ("entry_type", "VARCHAR"),
    ("entries", "BIGINT"),
    ("comparison_date", "DATE"),
]

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("validate_data")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fail(msg: str) -> None:
    """Print a loud error and record a failure (does not exit immediately)."""
    print(f"\n{'='*70}", flush=True)
    print(f"VALIDATION FAILURE: {msg}", flush=True)
    print(f"{'='*70}\n", flush=True)


def _check_files_exist() -> bool:
    ok = True
    for path in (DAILY_PARQUET, HOURLY_PARQUET, METADATA_JSON):
        if not os.path.isfile(path):
            _fail(f"Required file missing: {path}")
            ok = False
    return ok


def _read_metadata() -> dict[str, Any]:
    with open(METADATA_JSON, encoding="utf-8") as f:
        meta = json.load(f)
    if not isinstance(meta, dict):
        raise ValueError("metadata.json must contain a JSON object")
    return meta


def _parse_iso_date(value: object, field: str) -> datetime.date | None:
    if not isinstance(value, str):
        _fail(f"metadata.json field '{field}' must be a YYYY-MM-DD string.")
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        _fail(
            f"metadata.json field '{field}' must be a valid YYYY-MM-DD date: {value!r}"
        )
        return None


def _get_schema(con: duckdb.DuckDBPyConnection, path: str) -> dict[str, str]:
    """Return {column_name: dtype_string} for a Parquet file.

    Uses DESCRIBE on a read_parquet() scan rather than parquet_schema()
    because parquet_schema() column names differ between DuckDB versions
    (e.g. 'column_name'/'column_type' vs 'name'/'duckdb_type').
    DESCRIBE returns a stable (column_name, column_type, …) tuple.
    """
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}')").fetchall()
    # DESCRIBE returns: column_name, column_type, null, key, default, extra
    return {r[0]: r[1] for r in rows}


def _check_columns(
    con: duckdb.DuckDBPyConnection,
    path: str,
    expected: list[tuple[str, str]],
    label: str,
) -> list[str]:
    """Return a list of error strings (empty means OK)."""
    errors: list[str] = []
    schema = _get_schema(con, path)
    for col_name, col_type_prefix in expected:
        if col_name not in schema:
            errors.append(f"{label}: missing column '{col_name}'")
        elif not schema[col_name].startswith(col_type_prefix):
            errors.append(
                f"{label}: column '{col_name}' has type '{schema[col_name]}', "
                f"expected prefix '{col_type_prefix}'"
            )
    return errors


# ---------------------------------------------------------------------------
# Validation checks
# ---------------------------------------------------------------------------


def check_files_exist() -> bool:
    log.info("Check 1/6 — Required files exist")
    ok = _check_files_exist()
    if ok:
        log.info("  PASS: all three output files present")
    return ok


def check_columns(con: duckdb.DuckDBPyConnection) -> bool:
    log.info("Check 2/6 — Required columns and types")
    errors: list[str] = []
    errors.extend(
        _check_columns(con, DAILY_PARQUET, DAILY_EXPECTED_COLUMNS, "crz_daily")
    )
    errors.extend(
        _check_columns(con, HOURLY_PARQUET, HOURLY_EXPECTED_COLUMNS, "crz_hourly")
    )
    if errors:
        for e in errors:
            _fail(e)
        return False
    log.info("  PASS: all expected columns present with correct types")
    return True


def check_entry_types(con: duckdb.DuckDBPyConnection) -> bool:
    log.info("Check 3/6 — entry_type values are 'CRZ' or 'Excluded' only")
    bad_daily = con.execute(f"""
        SELECT DISTINCT entry_type
        FROM read_parquet('{DAILY_PARQUET}')
        WHERE entry_type NOT IN ('CRZ', 'Excluded')
    """).fetchall()
    bad_hourly = con.execute(f"""
        SELECT DISTINCT entry_type
        FROM read_parquet('{HOURLY_PARQUET}')
        WHERE entry_type NOT IN ('CRZ', 'Excluded')
    """).fetchall()
    if bad_daily or bad_hourly:
        bad = bad_daily + bad_hourly
        _fail(
            f"Unexpected entry_type values found: {[r[0] for r in bad]}  "
            "Only 'CRZ' and 'Excluded' are permitted."
        )
        return False
    log.info("  PASS: entry_type values are exactly {'CRZ', 'Excluded'}")
    return True


def check_detection_group_parity(con: duckdb.DuckDBPyConnection) -> bool:
    """Check 4: no 2026 detection_group missing from 2025 data."""
    log.info("Check 4/6 — 2026 detection groups are a subset of 2025 detection groups")
    only_in_2026 = con.execute(f"""
        WITH g2025 AS (
            SELECT DISTINCT detection_group
            FROM read_parquet('{DAILY_PARQUET}')
            WHERE YEAR(date) = 2025
        ),
        g2026 AS (
            SELECT DISTINCT detection_group
            FROM read_parquet('{DAILY_PARQUET}')
            WHERE YEAR(date) = 2026
        )
        SELECT g2026.detection_group
        FROM g2026
        LEFT JOIN g2025 USING (detection_group)
        WHERE g2025.detection_group IS NULL
        ORDER BY 1
    """).fetchall()

    if only_in_2026:
        names = [r[0] for r in only_in_2026]
        _fail(
            f"Detection groups present in 2026 but NOT in 2025: {names}  "
            "This likely indicates a renamed detector.  Update the alias map "
            "before shipping."
        )
        return False

    groups_2025 = con.execute(f"""
        SELECT COUNT(DISTINCT detection_group)
        FROM read_parquet('{DAILY_PARQUET}')
        WHERE YEAR(date) = 2025
    """).fetchone()[0]
    groups_2026 = con.execute(f"""
        SELECT COUNT(DISTINCT detection_group)
        FROM read_parquet('{DAILY_PARQUET}')
        WHERE YEAR(date) = 2026
    """).fetchone()[0]
    if groups_2026 == 0:
        _fail(
            "No 2026 detection groups were found. This indicates the build has "
            "no current-year data and must not be shipped."
        )
        return False

    log.info(
        "  PASS: 2026 groups (%d) are all present in 2025 (%d groups)",
        groups_2026,
        groups_2025,
    )
    return True


def check_daily_hourly_consistency(con: duckdb.DuckDBPyConnection) -> bool:
    """Check 5: daily totals agree with hourly sums within 0.1%."""
    log.info("Check 5/6 — Daily totals agree with hourly sums (tolerance 0.1%%)")

    mismatches = con.execute(f"""
        WITH d AS (
            SELECT
                date, detection_group, vehicle_class, entry_type,
                SUM(entries) AS daily_total
            FROM read_parquet('{DAILY_PARQUET}')
            GROUP BY date, detection_group, vehicle_class, entry_type
        ),
        h AS (
            SELECT
                date, detection_group, vehicle_class, entry_type,
                SUM(entries) AS hourly_total
            FROM read_parquet('{HOURLY_PARQUET}')
            GROUP BY date, detection_group, vehicle_class, entry_type
        )
        SELECT
            d.date,
            d.detection_group,
            d.vehicle_class,
            d.entry_type,
            d.daily_total,
            h.hourly_total,
            ABS(d.daily_total - h.hourly_total) AS abs_diff,
            CASE
                WHEN d.daily_total = 0 THEN 0.0
                ELSE CAST(ABS(d.daily_total - h.hourly_total) AS DOUBLE) / d.daily_total
            END AS rel_diff
        FROM d
        JOIN h USING (date, detection_group, vehicle_class, entry_type)
        WHERE rel_diff > {DAILY_HOURLY_TOLERANCE}
        ORDER BY rel_diff DESC
        LIMIT 20
    """).fetchall()

    if mismatches:
        _fail(
            f"Daily/hourly total mismatches exceed {DAILY_HOURLY_TOLERANCE*100:.1f}% "
            f"tolerance — {len(mismatches)} rows shown (capped at 20):\n"
            + "\n".join(
                f"  {r[0]} | {r[1]} | {r[2]} | {r[3]} "
                f"daily={r[4]} hourly={r[5]} rel={r[7]:.4%}"
                for r in mismatches
            )
        )
        return False

    log.info(
        "  PASS: daily totals match hourly sums within %.1f%% for all rows",
        DAILY_HOURLY_TOLERANCE * 100,
    )
    return True


def check_current_year_coverage(con: duckdb.DuckDBPyConnection) -> bool:
    """Fail if current-year rows or metadata/source date consistency are wrong."""
    log.info("Check 6/6 — current-year coverage and metadata date consistency")
    try:
        meta = _read_metadata()
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        _fail(f"Could not read metadata.json: {exc}")
        return False

    current_window_start = _parse_iso_date(
        meta.get("current_window_start"),
        "current_window_start",
    )
    current_window_end = _parse_iso_date(
        meta.get("current_window_end"),
        "current_window_end",
    )
    data_as_of = _parse_iso_date(meta.get("data_as_of"), "data_as_of")
    comparable_period_end = _parse_iso_date(
        meta.get("comparable_period_end"),
        "comparable_period_end",
    )

    if not all(
        [current_window_start, current_window_end, data_as_of, comparable_period_end]
    ):
        return False

    assert current_window_start is not None
    assert current_window_end is not None
    assert data_as_of is not None
    assert comparable_period_end is not None

    expected_year = current_window_start.year
    if current_window_start != datetime.date(expected_year, 1, 1):
        _fail(
            "metadata.current_window_start must be Jan 1 of the expected current "
            f"year, got {current_window_start.isoformat()}."
        )
        return False

    if current_window_end > data_as_of:
        _fail(
            f"metadata.current_window_end ({current_window_end.isoformat()}) is later "
            f"than metadata.data_as_of ({data_as_of.isoformat()})."
        )
        return False

    if comparable_period_end != current_window_end:
        _fail(
            "metadata.comparable_period_end must match current_window_end, got "
            f"{comparable_period_end.isoformat()} vs {current_window_end.isoformat()}."
        )
        return False

    daily_current_rows, daily_current_max, daily_overall_max = con.execute(
        f"""
        SELECT
            COUNT(*) FILTER (WHERE YEAR(date) = ?),
            MAX(date) FILTER (WHERE YEAR(date) = ?),
            MAX(date)
        FROM read_parquet('{DAILY_PARQUET}')
    """,
        [expected_year, expected_year],
    ).fetchone()

    hourly_current_rows, hourly_current_max, hourly_overall_max = con.execute(
        f"""
        SELECT
            COUNT(*) FILTER (WHERE YEAR(date) = ?),
            MAX(date) FILTER (WHERE YEAR(date) = ?),
            MAX(date)
        FROM read_parquet('{HOURLY_PARQUET}')
    """,
        [expected_year, expected_year],
    ).fetchone()

    if daily_current_rows == 0 or hourly_current_rows == 0:
        _fail(
            f"Current-year coverage is missing for {expected_year}: "
            f"daily rows={daily_current_rows}, hourly rows={hourly_current_rows}."
        )
        return False

    if daily_current_max != hourly_current_max:
        _fail(
            f"Current-year max date mismatch: daily={daily_current_max}, "
            f"hourly={hourly_current_max}."
        )
        return False

    if daily_current_max != data_as_of:
        _fail(
            f"metadata.data_as_of ({data_as_of.isoformat()}) must equal the max "
            f"{expected_year} source date in Parquet ({daily_current_max})."
        )
        return False

    if daily_overall_max and daily_overall_max < data_as_of:
        _fail(
            f"Overall daily max date ({daily_overall_max}) is earlier than "
            f"metadata.data_as_of ({data_as_of.isoformat()})."
        )
        return False

    if hourly_overall_max and hourly_overall_max < data_as_of:
        _fail(
            f"Overall hourly max date ({hourly_overall_max}) is earlier than "
            f"metadata.data_as_of ({data_as_of.isoformat()})."
        )
        return False

    log.info(
        "  PASS: %d coverage exists through %s (daily rows=%d, hourly rows=%d)",
        expected_year,
        data_as_of.isoformat(),
        daily_current_rows,
        hourly_current_rows,
    )
    return True


def check_metadata_freshness() -> bool:
    """Fail if metadata.last_updated is older than STALENESS_DAYS days."""
    log.info(
        "Check (metadata) — last_updated is not older than %d days",
        STALENESS_DAYS,
    )
    try:
        meta = _read_metadata()
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        _fail(f"Could not read metadata.json: {exc}")
        return False

    last_updated_str = meta.get("last_updated", "")
    if not last_updated_str:
        _fail("metadata.json is missing the 'last_updated' field.")
        return False

    try:
        last_updated = datetime.datetime.fromisoformat(last_updated_str)
    except ValueError:
        _fail(
            f"metadata.json 'last_updated' is not a valid ISO 8601 timestamp: "
            f"'{last_updated_str}'"
        )
        return False

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    if last_updated.tzinfo is None:
        last_updated = last_updated.replace(tzinfo=datetime.timezone.utc)
    age_days = (now_utc - last_updated).days

    if age_days > STALENESS_DAYS:
        _fail(
            f"metadata.json is stale: last_updated={last_updated_str} "
            f"is {age_days} days old (limit: {STALENESS_DAYS} days)."
        )
        return False

    log.info(
        "  PASS: metadata last_updated=%s (%d days old)", last_updated_str, age_days
    )

    # Also validate that all required keys exist.
    required_keys = {
        "last_updated",
        "source_row_count",
        "daily_row_count",
        "hourly_row_count",
        "current_window_start",
        "current_window_end",
        "data_as_of",
        "comparable_period_end",
        "schema_version",
    }
    missing_keys = required_keys - set(meta.keys())
    if missing_keys:
        _fail(f"metadata.json is missing required keys: {sorted(missing_keys)}")
        return False
    log.info("  PASS: all required metadata keys present")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    log.info("=== CRZ validate_data.py starting ===")
    failures: list[str] = []

    # Check 1: files exist (prerequisite for all other checks).
    if not check_files_exist():
        failures.append("required files missing")
        log.error(
            "Cannot continue — required files are absent.  " "Run build_data.py first."
        )
        sys.exit(1)

    con = duckdb.connect()

    # Check 2: column names and types.
    if not check_columns(con):
        failures.append("column schema mismatch")

    # Check 3: entry_type values.
    if not check_entry_types(con):
        failures.append("invalid entry_type values")

    # Check 4: detection group parity between years.
    if not check_detection_group_parity(con):
        failures.append("detection_group parity failure")

    # Check 5: daily/hourly total consistency.
    if not check_daily_hourly_consistency(con):
        failures.append("daily/hourly total mismatch")

    # Current-year coverage and metadata/source date consistency.
    if not check_current_year_coverage(con):
        failures.append("current-year coverage or metadata date consistency failure")

    # Metadata freshness (separate from Parquet checks).
    if not check_metadata_freshness():
        failures.append("metadata staleness or missing keys")

    con.close()

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print()
    if failures:
        print("=" * 70)
        print(f"VALIDATION FAILED  ({len(failures)} issue(s)):")
        for f in failures:
            print(f"  - {f}")
        print("=" * 70)
        sys.exit(1)
    else:
        print("=" * 70)
        print("VALIDATION PASSED — all checks green.")
        print("=" * 70)
        sys.exit(0)


if __name__ == "__main__":
    main()
