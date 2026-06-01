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


def create_raw_views(con: duckdb.DuckDBPyConnection, csv_path: str) -> tuple[int, int, int]:
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

    parser = argparse.ArgumentParser(description="Build CRZ Parquet files from Socrata.")
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
    log.info("Unpivoted row count : %d  (expect 2× loaded source = %d)",
             unpivoted_count, valid_source_row_count * 2)

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
    # 5. Write Parquet files using DuckDB COPY … TO (FORMAT PARQUET).
    #    ZSTD compression gives a good size/speed tradeoff.
    #    We force the exact column order per the spec.
    # ------------------------------------------------------------------
    log.info("Writing %s ...", DAILY_PARQUET)
    con.execute(f"""
        COPY (
            SELECT
                date,
                detection_group,
                vehicle_class,
                entry_type,
                entries,
                comparison_date
            FROM crz_daily
            ORDER BY date, detection_group, vehicle_class, entry_type
        )
        TO '{DAILY_PARQUET}'
        (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    daily_size_mb = os.path.getsize(DAILY_PARQUET) / 1_048_576
    log.info("  → %d rows, %.1f MB", daily_count, daily_size_mb)

    log.info("Writing %s ...", HOURLY_PARQUET)
    con.execute(f"""
        COPY (
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
        )
        TO '{HOURLY_PARQUET}'
        (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    hourly_size_mb = os.path.getsize(HOURLY_PARQUET) / 1_048_576
    log.info("  → %d rows, %.1f MB", hourly_count, hourly_size_mb)

    # ------------------------------------------------------------------
    # 6. Compute metadata fields.
    # ------------------------------------------------------------------
    today_utc = datetime.date.today().isoformat()  # 2026-05-24

    data_as_of = con.execute(
        "SELECT MAX(date)::VARCHAR FROM crz_daily"
    ).fetchone()[0]

    # current_window_start is always Jan 1 of the current year.
    current_year = datetime.date.today().year
    current_window_start = f"{current_year}-01-01"
    current_window_end = today_utc  # inclusive, recomputed every build

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
        "data_as_of": data_as_of,
        "comparable_period_end": current_window_end,
        "rows_daily": daily_count,
        "rows_hourly": hourly_count,
    }

    log.info("Writing %s ...", METADATA_JSON)
    with open(METADATA_JSON, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        f.write("\n")

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
    log.info("  data_as_of         : %s", data_as_of)

    con.close()

    # Remove the temp CSV now that Parquet files are written (only if we created it).
    if cleanup_tmp:
        os.unlink(tmp_csv)
        log.info("Cleaned up temp file: %s", tmp_csv)


if __name__ == "__main__":
    main()
