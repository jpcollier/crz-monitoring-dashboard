"""
build_data.py — MTA CRZ data pipeline
======================================
Pulls the full MTA Congestion Relief Zone Vehicle Entries dataset from
Socrata (NYS Open Data, dataset t6yz-b64h), aggregates it to daily and
hourly grain per the data spec, and writes three files:

  public/data/crz_daily.parquet
  public/data/crz_hourly.parquet
  public/data/metadata.json

Weekday alignment rule
----------------------
2026 rows carry a `comparison_date = date - INTERVAL 364 DAY` column so
that each 2026 date aligns to the same day of the week in 2025.
(364 = 52 × 7)  2025 rows have comparison_date = NULL.

entry_type normalisation
------------------------
The raw data encodes CRZ vs Excluded Roadway as two parallel numeric
columns (`crz_entries`, `excluded_roadway_entries`).  We UNPIVOT them
into a single `entry_type VARCHAR` column with values 'CRZ' and
'Excluded', summing the counts at aggregation time.

Idempotent: running the script twice produces byte-identical Parquet
output because all ORDER BY clauses include every dimension column as a
tiebreaker.

Usage
-----
  python scripts/build_data.py

Requirements: duckdb, pandas, pyarrow, requests  (see requirements.txt)
"""

import datetime
import json
import logging
import os
import sys
import tempfile
import time

import duckdb
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CSV_URL = "https://data.ny.gov/api/views/t6yz-b64h/rows.csv?accessType=DOWNLOAD"

# Resolve paths relative to repo root, not CWD, so the script works when
# invoked from any directory.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DATA_DIR = os.path.join(_REPO_ROOT, "public", "data")

DAILY_PARQUET = os.path.join(PUBLIC_DATA_DIR, "crz_daily.parquet")
HOURLY_PARQUET = os.path.join(PUBLIC_DATA_DIR, "crz_hourly.parquet")
METADATA_JSON = os.path.join(PUBLIC_DATA_DIR, "metadata.json")

SCHEMA_VERSION = 1

SOURCE_ROW_REGRESSION_TOLERANCE = 0.01  # allow up to a 1% row-count drop

DOWNLOAD_ATTEMPTS = 3
DOWNLOAD_BACKOFF_SECONDS = 2

MAX_REJECTED_SOURCE_ROWS = 1_000
MAX_REJECTED_SOURCE_RATE = 0.001  # 0.1%

REQUIRED_RAW_HEADERS = {
    "Toll Date",
    "Hour of Day",
    "Detection Group",
    "Vehicle Class",
    "CRZ Entries",
    "Excluded Roadway Entries",
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("build_data")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def ensure_output_dir() -> None:
    os.makedirs(PUBLIC_DATA_DIR, exist_ok=True)
    log.info("Output directory: %s", PUBLIC_DATA_DIR)


def _is_transient_download_error(exc: Exception) -> bool:
    """Return True when *exc* is worth retrying during CSV download."""
    if isinstance(
        exc,
        (
            requests.exceptions.Timeout,
            requests.exceptions.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
        ),
    ):
        return True

    if isinstance(exc, requests.exceptions.HTTPError):
        response = exc.response
        return response is not None and 500 <= response.status_code < 600

    return False


def _delete_partial_download(path: str) -> None:
    """Best-effort cleanup for a failed Socrata CSV download attempt."""
    try:
        os.unlink(path)
    except FileNotFoundError:
        return
    except OSError as cleanup_error:
        log.warning("Could not delete partial download %s: %s", path, cleanup_error)


def _duckdb_string_literal(value: str) -> str:
    """Return *value* quoted as a DuckDB SQL string literal."""
    return "'" + value.replace("'", "''") + "'"


def _parse_iso_date(value: object) -> datetime.date | None:
    """Parse a YYYY-MM-DD metadata value, returning None for absent/invalid values."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        return None


def _load_existing_metadata() -> dict | None:
    """Load existing metadata.json when present, for regression checks."""
    if not os.path.isfile(METADATA_JSON):
        return None

    try:
        with open(METADATA_JSON, encoding="utf-8") as f:
            metadata = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read existing metadata.json: {exc}") from exc

    if not isinstance(metadata, dict):
        raise ValueError("Existing metadata.json must contain a JSON object.")
    return metadata


def _validate_source_coverage(
    *,
    source_row_count: int,
    min_source_date: datetime.date | None,
    max_source_date: datetime.date | None,
    current_year: int,
    current_year_source_row_count: int,
    current_year_data_as_of: str | None,
    existing_metadata: dict | None,
) -> None:
    """Abort suspicious source exports before artifacts are replaced.

    The Socrata bulk CSV endpoint can occasionally return a truncated or
    stale-looking export.  Do not let that overwrite a better committed build.
    """
    if min_source_date is None or max_source_date is None:
        raise ValueError("No valid dated source rows were loaded from Socrata.")

    if current_year >= 2026 and current_year_source_row_count == 0:
        raise ValueError(
            f"No {current_year} rows were loaded from Socrata. "
            "Refusing to publish a current-year dashboard with only prior-year data."
        )

    if current_year >= 2026 and current_year_data_as_of is None:
        raise ValueError(
            f"No current-year data_as_of could be computed for {current_year}."
        )

    if existing_metadata is None:
        return

    previous_source_rows = existing_metadata.get("source_valid_row_count")
    if not isinstance(previous_source_rows, int):
        previous_source_rows = existing_metadata.get("source_row_count")

    if isinstance(previous_source_rows, int) and previous_source_rows > 0:
        minimum_allowed_rows = int(
            previous_source_rows * (1 - SOURCE_ROW_REGRESSION_TOLERANCE)
        )
        if source_row_count < minimum_allowed_rows:
            raise ValueError(
                f"Source row count regressed from {previous_source_rows:,} to "
                f"{source_row_count:,}, exceeding the "
                f"{SOURCE_ROW_REGRESSION_TOLERANCE:.0%} tolerance. "
                "This likely indicates a partial Socrata export."
            )

    previous_data_as_of = _parse_iso_date(existing_metadata.get("data_as_of"))
    if previous_data_as_of and max_source_date < previous_data_as_of:
        raise ValueError(
            f"Source max date regressed from {previous_data_as_of.isoformat()} to "
            f"{max_source_date.isoformat()}. Refusing to overwrite fresher data."
        )


def _copy_view_to_temp_parquet(
    con: duckdb.DuckDBPyConnection,
    sql: str,
    dest_path: str,
) -> str:
    """Write *sql* to a sibling temp Parquet path and return that path."""
    tmp_path = f"{dest_path}.tmp"
    try:
        con.execute(f"""
            COPY ({sql})
            TO '{tmp_path}'
            (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        return tmp_path
    except Exception:
        _delete_partial_download(tmp_path)
        raise


def _write_metadata_atomically(metadata: dict, dest_path: str) -> None:
    """Write metadata JSON atomically to avoid leaving partial files behind."""
    fd, tmp_path = tempfile.mkstemp(
        suffix=".tmp",
        prefix="metadata_",
        dir=os.path.dirname(dest_path),
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, dest_path)
    except Exception:
        _delete_partial_download(tmp_path)
        raise


def create_raw_views(
    con: duckdb.DuckDBPyConnection, csv_path: str
) -> tuple[int, int, int]:
    """Create raw CSV views and return (source, valid, rejected) row counts.

    Socrata's full CSV export occasionally contains malformed trailing fields in
    columns the pipeline does not consume.  Read the export as VARCHAR with NULL
    padding, then explicitly parse and keep only rows where the six fields needed
    for aggregation are present and valid.  This avoids failing the whole weekly
    refresh because of a bad unused field while still rejecting rows with corrupt
    dates, hours, dimensions, or entry counts.
    """
    safe_path = csv_path.replace("\\", "/")
    csv_literal = _duckdb_string_literal(safe_path)

    con.execute(f"""
        CREATE VIEW raw_source AS
        SELECT *
        FROM read_csv_auto(
            {csv_literal},
            all_varchar = true,
            null_padding = true,
            ignore_errors = false
        )
    """)

    source_headers = {r[0] for r in con.execute("DESCRIBE raw_source").fetchall()}
    missing_headers = REQUIRED_RAW_HEADERS - source_headers
    if missing_headers:
        raise ValueError(
            "Required columns missing from source: "
            f"{sorted(missing_headers)}. The source schema may have changed."
        )

    con.execute("""
        CREATE VIEW raw_parsed AS
        SELECT
            CAST(try_strptime("Toll Date", '%m/%d/%Y') AS DATE)      AS toll_date,
            TRY_CAST("Hour of Day" AS TINYINT)                      AS hour_of_day,
            NULLIF(TRIM("Detection Group"), '')                     AS detection_group,
            NULLIF(TRIM("Vehicle Class"), '')                       AS vehicle_class,
            TRY_CAST("CRZ Entries" AS BIGINT)                       AS crz_entries,
            TRY_CAST("Excluded Roadway Entries" AS BIGINT)          AS excluded_roadway_entries,
            "Toll Date"                                             AS source_toll_date,
            "Hour of Day"                                           AS source_hour_of_day,
            "Detection Group"                                       AS source_detection_group,
            "Vehicle Class"                                         AS source_vehicle_class,
            "CRZ Entries"                                           AS source_crz_entries,
            "Excluded Roadway Entries"                              AS source_excluded_roadway_entries
        FROM raw_source
    """)

    validity_predicate = """
        toll_date IS NOT NULL
        AND hour_of_day IS NOT NULL
        AND hour_of_day BETWEEN 0 AND 23
        AND detection_group IS NOT NULL
        AND vehicle_class IS NOT NULL
        AND crz_entries IS NOT NULL
        AND excluded_roadway_entries IS NOT NULL
    """

    con.execute(f"""
        CREATE VIEW raw AS
        SELECT
            toll_date,
            hour_of_day,
            detection_group,
            vehicle_class,
            crz_entries,
            excluded_roadway_entries
        FROM raw_parsed
        WHERE {validity_predicate}
    """)

    source_row_count = con.execute("SELECT COUNT(*) FROM raw_source").fetchone()[0]
    valid_row_count = con.execute("SELECT COUNT(*) FROM raw").fetchone()[0]
    rejected_row_count = source_row_count - valid_row_count

    if rejected_row_count:
        rejected_samples = con.execute(f"""
            SELECT
                source_toll_date,
                source_hour_of_day,
                source_detection_group,
                source_vehicle_class,
                source_crz_entries,
                source_excluded_roadway_entries
            FROM raw_parsed
            WHERE NOT ({validity_predicate})
            LIMIT 5
        """).fetchall()
        log.warning(
            "Rejected %d malformed source row(s) with invalid required fields. "
            "Sample rejected values: %s",
            rejected_row_count,
            rejected_samples,
        )

        max_rejected_rows = max(
            MAX_REJECTED_SOURCE_ROWS,
            int(source_row_count * MAX_REJECTED_SOURCE_RATE),
        )
        if rejected_row_count > max_rejected_rows:
            raise ValueError(
                f"Rejected {rejected_row_count} of {source_row_count} source rows, "
                f"exceeding the safety limit of {max_rejected_rows}."
            )

    return source_row_count, valid_row_count, rejected_row_count


def download_csv(url: str) -> str:
    """Stream-download *url* to a named temp file and return its path.

    Uses requests so we control timeouts, show progress, and retry transient
    Socrata/network failures consistently in both local runs and CI.  The caller
    is responsible for deleting the file when done.

    Timeout tuple: (connect_seconds, read_seconds_between_chunks).
    The read timeout applies per chunk, not to the total transfer, so 120 s
    is generous even for slow connections.
    """
    log.info("Downloading CSV: %s", url)
    chunk_size = 4 * 1024 * 1024  # 4 MB chunks

    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        tmp = tempfile.NamedTemporaryFile(
            suffix=".csv", prefix="crz_raw_", delete=False
        )
        written = 0
        try:
            log.info(
                "Download attempt %d/%d: %s",
                attempt,
                DOWNLOAD_ATTEMPTS,
                tmp.name,
            )
            with requests.get(url, stream=True, timeout=(30, 120)) as resp:
                resp.raise_for_status()
                total_bytes = int(resp.headers.get("content-length", 0))
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    if not chunk:
                        continue
                    tmp.write(chunk)
                    written += len(chunk)
                    if total_bytes:
                        log.info(
                            "  %.1f%% — %d MB / %d MB",
                            written / total_bytes * 100,
                            written // 1_048_576,
                            total_bytes // 1_048_576,
                        )
            tmp.flush()
            tmp.close()
            log.info(
                "Download complete: %s (%.1f MB)",
                tmp.name,
                written / 1_048_576,
            )
            return tmp.name
        except Exception as exc:
            tmp.close()
            _delete_partial_download(tmp.name)

            if not _is_transient_download_error(exc):
                log.error("Non-retryable CSV download failure: %s", exc)
                raise

            if attempt >= DOWNLOAD_ATTEMPTS:
                log.error(
                    "CSV download failed after %d attempts; last error: %s",
                    DOWNLOAD_ATTEMPTS,
                    exc,
                )
                raise

            backoff = DOWNLOAD_BACKOFF_SECONDS * (2 ** (attempt - 1))
            log.warning(
                "Transient CSV download failure on attempt %d/%d: %s. "
                "Deleted partial file and retrying in %d s.",
                attempt,
                DOWNLOAD_ATTEMPTS,
                exc,
                backoff,
            )
            time.sleep(backoff)

    raise RuntimeError("unreachable: CSV download retry loop exhausted")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Build CRZ Parquet files from Socrata."
    )
    parser.add_argument(
        "--local-csv",
        metavar="PATH",
        help="Skip the Socrata download and use this local CSV file instead. "
        "Useful for re-running the aggregation after an interrupted build.",
    )
    args = parser.parse_args()

    build_start = datetime.datetime.now(datetime.timezone.utc)
    log.info("=== CRZ data pipeline starting ===")
    log.info("Build UTC time : %s", build_start.isoformat())

    ensure_output_dir()

    # ------------------------------------------------------------------
    # 1. Download the CSV to a local temp file, then load with DuckDB.
    #    DuckDB's httpfs extension times out on the ~1 GB Socrata file;
    #    downloading via requests first avoids that constraint entirely.
    # ------------------------------------------------------------------
    if args.local_csv:
        tmp_csv = args.local_csv
        cleanup_tmp = False  # don't delete a file the caller owns
        log.info("Using local CSV (skipping download): %s", tmp_csv)
    else:
        tmp_csv = download_csv(CSV_URL)
        cleanup_tmp = True

    log.info("Connecting to DuckDB (in-memory)...")
    con = duckdb.connect()

    # The CSV bulk export uses display-name headers ("Toll Date", "CRZ Entries")
    # while the JSON API uses snake_case. Normalize to snake_case here so all
    # downstream SQL stays consistent with the documented field names.
    try:
        (
            source_row_count,
            valid_source_row_count,
            rejected_source_row_count,
        ) = create_raw_views(con, tmp_csv)
    except ValueError as exc:
        log.error("ABORT: %s", exc)
        sys.exit(1)

    log.info("Source rows found  : %d", source_row_count)
    log.info("Source rows loaded : %d", valid_source_row_count)
    log.info("Source rows rejected: %d", rejected_source_row_count)

    source_min_date, source_max_date, current_year_source_row_count = con.execute(
        """
        SELECT
            MIN(toll_date),
            MAX(toll_date),
            COUNT(*) FILTER (WHERE YEAR(toll_date) = ?)
        FROM raw
    """,
        [build_start.date().year],
    ).fetchone()
    log.info("Source date range  : %s → %s", source_min_date, source_max_date)
    log.info(
        "Source %d rows : %d",
        build_start.date().year,
        current_year_source_row_count,
    )

    try:
        existing_metadata = _load_existing_metadata()
    except ValueError as exc:
        log.error("ABORT: %s", exc)
        sys.exit(1)

    raw_columns = [r[0] for r in con.execute("DESCRIBE raw").fetchall()]
    log.info("Raw columns (%d): %s", len(raw_columns), raw_columns)

    # ------------------------------------------------------------------
    # 2. Unpivot the two entry columns into entry_type rows and derive
    #    comparison_date.  We do this entirely in DuckDB SQL.
    #
    #    UNPIVOT strategy: UNION ALL of two sub-selects, one per entry
    #    column.  This keeps the SQL readable without requiring DuckDB's
    #    UNPIVOT syntax (which varies by version).
    #
    #    comparison_date:
    #      - 2026 rows → date - INTERVAL 364 DAY   (same weekday in 2025)
    #      - 2025 rows → NULL
    # ------------------------------------------------------------------
    log.info("Building unpivoted + comparison_date view...")

    con.execute("""
        CREATE VIEW unpivoted AS
        SELECT
            CAST(toll_date AS DATE)                                         AS date,
            CAST(hour_of_day AS TINYINT)                                    AS hour,
            detection_group                                                  AS detection_group,
            vehicle_class                                                    AS vehicle_class,
            'CRZ'                                                            AS entry_type,
            CAST(crz_entries AS BIGINT)                                     AS entries,
            CASE
                WHEN YEAR(CAST(toll_date AS DATE)) = 2026
                THEN CAST(CAST(toll_date AS DATE) - INTERVAL 364 DAY AS DATE)
                ELSE NULL
            END                                                              AS comparison_date
        FROM raw

        UNION ALL

        SELECT
            CAST(toll_date AS DATE)                                         AS date,
            CAST(hour_of_day AS TINYINT)                                    AS hour,
            detection_group                                                  AS detection_group,
            vehicle_class                                                    AS vehicle_class,
            'Excluded'                                                       AS entry_type,
            CAST(excluded_roadway_entries AS BIGINT)                        AS entries,
            CASE
                WHEN YEAR(CAST(toll_date AS DATE)) = 2026
                THEN CAST(CAST(toll_date AS DATE) - INTERVAL 364 DAY AS DATE)
                ELSE NULL
            END                                                              AS comparison_date
        FROM raw
    """)

    unpivoted_count = con.execute("SELECT COUNT(*) FROM unpivoted").fetchone()[0]
    log.info(
        "Unpivoted row count : %d  (expect 2× loaded source = %d)",
        unpivoted_count,
        valid_source_row_count * 2,
    )

    # Sanity-check entry_type values — must only be 'CRZ' or 'Excluded'.
    bad_entry_types = con.execute("""
        SELECT DISTINCT entry_type FROM unpivoted
        WHERE entry_type NOT IN ('CRZ', 'Excluded')
    """).fetchall()
    if bad_entry_types:
        log.error("ABORT: Unexpected entry_type values: %s", bad_entry_types)
        sys.exit(1)

    # Sanity-check: no 'Total' or 'Unclassified' vehicle classes.
    bad_classes = con.execute("""
        SELECT DISTINCT vehicle_class FROM unpivoted
        WHERE LOWER(vehicle_class) IN ('total', 'unclassified')
    """).fetchall()
    if bad_classes:
        log.error(
            "ABORT: 'Total' or 'Unclassified' vehicle_class values found: %s  "
            "These would cause double counting — investigate before proceeding.",
            bad_classes,
        )
        sys.exit(1)

    # ------------------------------------------------------------------
    # 3. Aggregate to DAILY grain.
    #
    #    GROUP BY (date, detection_group, vehicle_class, entry_type).
    #    comparison_date is the same for every row within a given date
    #    so taking MIN is safe and deterministic.
    #
    #    ORDER BY covers all dimension columns to ensure byte-identical
    #    Parquet output on repeat runs (idempotency).
    # ------------------------------------------------------------------
    log.info("Aggregating to daily grain...")

    con.execute("""
        CREATE VIEW crz_daily AS
        SELECT
            date                                        AS date,
            detection_group                             AS detection_group,
            vehicle_class                               AS vehicle_class,
            entry_type                                  AS entry_type,
            CAST(SUM(entries) AS BIGINT)                AS entries,
            CAST(MIN(comparison_date) AS DATE)          AS comparison_date
        FROM unpivoted
        GROUP BY
            date,
            detection_group,
            vehicle_class,
            entry_type
        ORDER BY
            date,
            detection_group,
            vehicle_class,
            entry_type
    """)

    daily_count = con.execute("SELECT COUNT(*) FROM crz_daily").fetchone()[0]
    log.info("Daily rows         : %d", daily_count)

    # ------------------------------------------------------------------
    # 4. Aggregate to HOURLY grain.
    #
    #    GROUP BY (date, hour, detection_group, vehicle_class, entry_type).
    # ------------------------------------------------------------------
    log.info("Aggregating to hourly grain...")

    con.execute("""
        CREATE VIEW crz_hourly AS
        SELECT
            date                                        AS date,
            hour                                        AS hour,
            detection_group                             AS detection_group,
            vehicle_class                               AS vehicle_class,
            entry_type                                  AS entry_type,
            CAST(SUM(entries) AS BIGINT)                AS entries,
            CAST(MIN(comparison_date) AS DATE)          AS comparison_date
        FROM unpivoted
        GROUP BY
            date,
            hour,
            detection_group,
            vehicle_class,
            entry_type
        ORDER BY
            date,
            hour,
            detection_group,
            vehicle_class,
            entry_type
    """)

    hourly_count = con.execute("SELECT COUNT(*) FROM crz_hourly").fetchone()[0]
    log.info("Hourly rows        : %d", hourly_count)

    # Cross-check: daily totals should equal hourly sums (aggregation is
    # consistent because there are no partial-hour rows — each day has
    # exactly 24 hourly blocks).
    log.info("Cross-checking daily vs hourly totals...")
    mismatch = con.execute("""
        WITH daily_sum AS (
            SELECT
                date, detection_group, vehicle_class, entry_type,
                SUM(entries) AS daily_entries
            FROM crz_daily
            GROUP BY date, detection_group, vehicle_class, entry_type
        ),
        hourly_sum AS (
            SELECT
                date, detection_group, vehicle_class, entry_type,
                SUM(entries) AS hourly_entries
            FROM crz_hourly
            GROUP BY date, detection_group, vehicle_class, entry_type
        )
        SELECT COUNT(*)
        FROM daily_sum d
        JOIN hourly_sum h
          USING (date, detection_group, vehicle_class, entry_type)
        WHERE ABS(d.daily_entries - h.hourly_entries) > 0
    """).fetchone()[0]

    if mismatch > 0:
        log.error(
            "ABORT: %d daily/hourly total mismatches detected.  "
            "The aggregation is inconsistent — aborting.",
            mismatch,
        )
        sys.exit(1)
    log.info("Cross-check passed : daily totals == hourly sums for all rows.")

    # ------------------------------------------------------------------
    # 5. Compute and validate metadata fields before replacing artifacts.
    # ------------------------------------------------------------------
    current_year = build_start.date().year
    current_data_as_of = con.execute(
        "SELECT MAX(date)::VARCHAR FROM crz_daily WHERE YEAR(date) = ?",
        [current_year],
    ).fetchone()[0]
    overall_data_as_of = con.execute(
        "SELECT MAX(date)::VARCHAR FROM crz_daily"
    ).fetchone()[0]

    try:
        _validate_source_coverage(
            source_row_count=valid_source_row_count,
            min_source_date=source_min_date,
            max_source_date=source_max_date,
            current_year=current_year,
            current_year_source_row_count=current_year_source_row_count,
            current_year_data_as_of=current_data_as_of,
            existing_metadata=existing_metadata,
        )
    except ValueError as exc:
        log.error("ABORT: %s", exc)
        sys.exit(1)

    if current_data_as_of is None:
        log.error(
            "ABORT: No data_as_of date found for current year %d. "
            "Refusing to build current-year dashboard artifacts.",
            current_year,
        )
        sys.exit(1)

    # current_window_end is anchored to source availability, not build date.
    current_window_start = f"{current_year}-01-01"
    current_window_end = current_data_as_of

    build_end = datetime.datetime.now(datetime.timezone.utc)
    elapsed = (build_end - build_start).total_seconds()

    metadata = {
        "last_updated": build_end.isoformat(),
        "source_row_count": source_row_count,
        "source_valid_row_count": valid_source_row_count,
        "source_rejected_row_count": rejected_source_row_count,
        "daily_row_count": daily_count,
        "hourly_row_count": hourly_count,
        "current_window_start": current_window_start,
        "current_window_end": current_window_end,
        "schema_version": SCHEMA_VERSION,
        # Legacy / convenience fields kept for browser consumers
        "data_as_of": current_data_as_of,
        "source_data_as_of": overall_data_as_of,
        "comparable_period_end": current_window_end,
        "rows_daily": daily_count,
        "rows_hourly": hourly_count,
    }

    # ------------------------------------------------------------------
    # 6. Write Parquet and metadata artifacts. Parquet files are written to
    #    sibling temp files first, then swapped into place only after both
    #    writes succeed so a failed build does not leave mixed artifacts.
    # ------------------------------------------------------------------
    daily_tmp = ""
    hourly_tmp = ""
    try:
        log.info("Writing temporary Parquet for %s ...", DAILY_PARQUET)
        daily_tmp = _copy_view_to_temp_parquet(
            con,
            """
            SELECT
                date,
                detection_group,
                vehicle_class,
                entry_type,
                entries,
                comparison_date
            FROM crz_daily
            ORDER BY date, detection_group, vehicle_class, entry_type
        """,
            DAILY_PARQUET,
        )

        log.info("Writing temporary Parquet for %s ...", HOURLY_PARQUET)
        hourly_tmp = _copy_view_to_temp_parquet(
            con,
            """
            SELECT
                date,
                hour,
                detection_group,
                vehicle_class,
                entry_type,
                entries,
                comparison_date
            FROM crz_hourly
            ORDER BY date, hour, detection_group, vehicle_class, entry_type
        """,
            HOURLY_PARQUET,
        )

        os.replace(daily_tmp, DAILY_PARQUET)
        daily_tmp = ""
        daily_size_mb = os.path.getsize(DAILY_PARQUET) / 1_048_576
        log.info("  %s → %d rows, %.1f MB", DAILY_PARQUET, daily_count, daily_size_mb)

        os.replace(hourly_tmp, HOURLY_PARQUET)
        hourly_tmp = ""
        hourly_size_mb = os.path.getsize(HOURLY_PARQUET) / 1_048_576
        log.info(
            "  %s → %d rows, %.1f MB", HOURLY_PARQUET, hourly_count, hourly_size_mb
        )

        log.info("Writing %s ...", METADATA_JSON)
        _write_metadata_atomically(metadata, METADATA_JSON)
    finally:
        if daily_tmp:
            _delete_partial_download(daily_tmp)
        if hourly_tmp:
            _delete_partial_download(hourly_tmp)

    # ------------------------------------------------------------------
    # 7. Final summary
    # ------------------------------------------------------------------
    log.info("=== Build complete in %.1f s ===", elapsed)
    log.info("  crz_daily.parquet  : %d rows, %.1f MB", daily_count, daily_size_mb)
    log.info("  crz_hourly.parquet : %d rows, %.1f MB", hourly_count, hourly_size_mb)
    log.info("  metadata.json      : last_updated=%s", metadata["last_updated"])
    log.info("  source_row_count   : %d", source_row_count)
    log.info("  source rows loaded : %d", valid_source_row_count)
    log.info("  source rows rejected: %d", rejected_source_row_count)
    log.info("  data_as_of         : %s", current_data_as_of)
    log.info("  source_data_as_of  : %s", overall_data_as_of)

    con.close()

    # Remove the temp CSV now that Parquet files are written (only if we created it).
    if cleanup_tmp:
        os.unlink(tmp_csv)
        log.info("Cleaned up temp file: %s", tmp_csv)


if __name__ == "__main__":
    main()
