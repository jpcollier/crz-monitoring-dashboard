"""
test_validate_bad_fixture.py
============================
Proves that validate_data.py actually fails on deliberately broken input.

This test creates a minimal, intentionally-broken set of Parquet + metadata
files in a temporary directory, then imports and calls each validation check
directly with a DuckDB connection pointed at those files.

Each test function corresponds to one validation rule and asserts the check
returns False (i.e., triggers a failure) for the bad fixture.

Run with:  pytest tests/test_validate_bad_fixture.py -v
"""

import datetime
import json
import os
import sys
import tempfile
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

# ---------------------------------------------------------------------------
# Make the scripts/ package importable when tests are run from the repo root.
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

# We patch the module-level path constants before importing the module so
# the validator reads from our temp directory during tests.
# We do this by monkey-patching after import.
import validate_data  # noqa: E402  (import after sys.path tweak)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_good_daily_table() -> pa.Table:
    """Minimal valid daily Parquet with both 2025 and 2026 rows."""
    today_2026 = datetime.date(2026, 5, 24)
    compare_date = today_2026 - datetime.timedelta(days=364)
    prior_2025 = datetime.date(2025, 5, 25)

    return pa.table(
        {
            "date": pa.array([today_2026, prior_2025], type=pa.date32()),
            "detection_group": pa.array(
                ["Brooklyn Bridge", "Brooklyn Bridge"], type=pa.string()
            ),
            "vehicle_class": pa.array(
                ["1 - Cars, Pickups and Vans"] * 2, type=pa.string()
            ),
            "entry_type": pa.array(["CRZ", "CRZ"], type=pa.string()),
            "entries": pa.array([100, 95], type=pa.int64()),
            "comparison_date": pa.array([compare_date, None], type=pa.date32()),
        }
    )


def _make_good_hourly_table() -> pa.Table:
    """Minimal valid hourly Parquet consistent with the daily table above."""
    today_2026 = datetime.date(2026, 5, 24)
    compare_date = today_2026 - datetime.timedelta(days=364)
    prior_2025 = datetime.date(2025, 5, 25)

    # Distribute the daily entries across two hours to keep totals matching.
    return pa.table(
        {
            "date": pa.array(
                [today_2026, today_2026, prior_2025, prior_2025], type=pa.date32()
            ),
            "hour": pa.array([9, 10, 9, 10], type=pa.int8()),
            "detection_group": pa.array(["Brooklyn Bridge"] * 4, type=pa.string()),
            "vehicle_class": pa.array(
                ["1 - Cars, Pickups and Vans"] * 4, type=pa.string()
            ),
            "entry_type": pa.array(["CRZ"] * 4, type=pa.string()),
            "entries": pa.array([60, 40, 55, 40], type=pa.int64()),
            "comparison_date": pa.array(
                [compare_date, compare_date, None, None], type=pa.date32()
            ),
        }
    )


def _make_good_metadata(tmpdir: str, daily_path: str, hourly_path: str) -> str:
    meta = {
        "last_updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_row_count": 5_152_896,
        "daily_row_count": 2,
        "hourly_row_count": 4,
        "current_window_start": "2026-01-01",
        "current_window_end": "2026-05-24",
        "schema_version": 1,
        "data_as_of": "2026-05-24",
        "comparable_period_end": "2026-05-24",
        "rows_daily": 2,
        "rows_hourly": 4,
    }
    path = os.path.join(tmpdir, "metadata.json")
    with open(path, "w") as f:
        json.dump(meta, f)
    return path


@pytest.fixture()
def tmpdir_fixture():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture()
def good_build(tmpdir_fixture):
    """Write a complete, valid build to a temp directory."""
    daily_path = os.path.join(tmpdir_fixture, "crz_daily.parquet")
    hourly_path = os.path.join(tmpdir_fixture, "crz_hourly.parquet")
    meta_path = _make_good_metadata(tmpdir_fixture, daily_path, hourly_path)

    pq.write_table(_make_good_daily_table(), daily_path)
    pq.write_table(_make_good_hourly_table(), hourly_path)

    return {
        "daily": daily_path,
        "hourly": hourly_path,
        "meta": meta_path,
        "dir": tmpdir_fixture,
    }


# ---------------------------------------------------------------------------
# Helper: patch validate_data paths and get a fresh DuckDB connection.
# ---------------------------------------------------------------------------


def _patched_con(build: dict) -> duckdb.DuckDBPyConnection:
    validate_data.DAILY_PARQUET = build["daily"]
    validate_data.HOURLY_PARQUET = build["hourly"]
    validate_data.METADATA_JSON = build["meta"]
    return duckdb.connect()


# ---------------------------------------------------------------------------
# Test: good fixture passes all checks
# ---------------------------------------------------------------------------


def test_good_fixture_passes_all_checks(good_build):
    """Sanity check: the good fixture should pass every validation."""
    con = _patched_con(good_build)

    assert validate_data.check_columns(con) is True
    assert validate_data.check_entry_types(con) is True
    assert validate_data.check_detection_group_parity(con) is True
    assert validate_data.check_daily_hourly_consistency(con) is True
    assert validate_data.check_current_year_coverage(con) is True
    assert validate_data.check_metadata_freshness() is True

    con.close()


# ---------------------------------------------------------------------------
# Test 1: bad entry_type → check_entry_types must fail
# ---------------------------------------------------------------------------


def test_bad_entry_type_fails(tmpdir_fixture):
    """Replace 'CRZ' with 'TOTAL' — validator must return False."""
    daily = _make_good_daily_table()
    bad_daily = daily.set_column(
        daily.schema.get_field_index("entry_type"),
        "entry_type",
        pa.array(["TOTAL", "CRZ"], type=pa.string()),
    )
    daily_path = os.path.join(tmpdir_fixture, "crz_daily.parquet")
    hourly_path = os.path.join(tmpdir_fixture, "crz_hourly.parquet")
    pq.write_table(bad_daily, daily_path)
    pq.write_table(_make_good_hourly_table(), hourly_path)
    meta_path = _make_good_metadata(tmpdir_fixture, daily_path, hourly_path)

    build = {"daily": daily_path, "hourly": hourly_path, "meta": meta_path}
    con = _patched_con(build)

    result = validate_data.check_entry_types(con)
    con.close()
    assert result is False, "check_entry_types should fail when entry_type='TOTAL'"


# ---------------------------------------------------------------------------
# Test 2: 2026 detection_group missing from 2025 → check_detection_group_parity fails
# ---------------------------------------------------------------------------


def test_new_2026_detection_group_fails(tmpdir_fixture):
    """Add a 2026-only detection group that doesn't exist in 2025."""
    today_2026 = datetime.date(2026, 5, 24)
    compare_date = today_2026 - datetime.timedelta(days=364)
    prior_2025 = datetime.date(2025, 5, 25)

    bad_daily = pa.table(
        {
            "date": pa.array([today_2026, today_2026, prior_2025], type=pa.date32()),
            "detection_group": pa.array(
                [
                    "Brooklyn Bridge",
                    "New Phantom Tunnel",  # 2026-only — should trigger failure
                    "Brooklyn Bridge",
                ],
                type=pa.string(),
            ),
            "vehicle_class": pa.array(
                ["1 - Cars, Pickups and Vans"] * 3, type=pa.string()
            ),
            "entry_type": pa.array(["CRZ"] * 3, type=pa.string()),
            "entries": pa.array([100, 50, 95], type=pa.int64()),
            "comparison_date": pa.array(
                [compare_date, compare_date, None], type=pa.date32()
            ),
        }
    )

    daily_path = os.path.join(tmpdir_fixture, "crz_daily.parquet")
    hourly_path = os.path.join(tmpdir_fixture, "crz_hourly.parquet")
    pq.write_table(bad_daily, daily_path)
    pq.write_table(_make_good_hourly_table(), hourly_path)
    meta_path = _make_good_metadata(tmpdir_fixture, daily_path, hourly_path)

    build = {"daily": daily_path, "hourly": hourly_path, "meta": meta_path}
    con = _patched_con(build)

    result = validate_data.check_detection_group_parity(con)
    con.close()
    assert result is False, (
        "check_detection_group_parity should fail when a 2026 group "
        "is absent from 2025"
    )


# ---------------------------------------------------------------------------
# Test 3: daily/hourly totals disagree → check_daily_hourly_consistency fails
# ---------------------------------------------------------------------------


def test_daily_hourly_mismatch_fails(tmpdir_fixture):
    """Corrupt the daily Parquet so totals differ from hourly sums by > 0.1%."""
    today_2026 = datetime.date(2026, 5, 24)
    compare_date = today_2026 - datetime.timedelta(days=364)
    prior_2025 = datetime.date(2025, 5, 25)

    # Daily says 200, but hourly sums to 100 → 100% mismatch.
    bad_daily = pa.table(
        {
            "date": pa.array([today_2026, prior_2025], type=pa.date32()),
            "detection_group": pa.array(["Brooklyn Bridge"] * 2, type=pa.string()),
            "vehicle_class": pa.array(
                ["1 - Cars, Pickups and Vans"] * 2, type=pa.string()
            ),
            "entry_type": pa.array(["CRZ"] * 2, type=pa.string()),
            "entries": pa.array([200, 95], type=pa.int64()),  # inflated daily for 2026
            "comparison_date": pa.array([compare_date, None], type=pa.date32()),
        }
    )

    daily_path = os.path.join(tmpdir_fixture, "crz_daily.parquet")
    hourly_path = os.path.join(tmpdir_fixture, "crz_hourly.parquet")
    pq.write_table(bad_daily, daily_path)
    pq.write_table(_make_good_hourly_table(), hourly_path)
    meta_path = _make_good_metadata(tmpdir_fixture, daily_path, hourly_path)

    build = {"daily": daily_path, "hourly": hourly_path, "meta": meta_path}
    con = _patched_con(build)

    result = validate_data.check_daily_hourly_consistency(con)
    con.close()
    assert result is False, (
        "check_daily_hourly_consistency should fail when daily total "
        "exceeds hourly sum by more than 0.1%"
    )


# ---------------------------------------------------------------------------
# Test 4: stale metadata → check_metadata_freshness fails
# ---------------------------------------------------------------------------


def test_stale_metadata_fails(tmpdir_fixture, good_build):
    """Set last_updated to 10 days ago — should exceed the 8-day limit."""
    stale_dt = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        days=10
    )
    with open(good_build["meta"], "r") as f:
        meta = json.load(f)
    meta["last_updated"] = stale_dt.isoformat()
    with open(good_build["meta"], "w") as f:
        json.dump(meta, f)

    validate_data.METADATA_JSON = good_build["meta"]
    result = validate_data.check_metadata_freshness()
    assert (
        result is False
    ), "check_metadata_freshness should fail when last_updated is 10 days old"


# ---------------------------------------------------------------------------
# Test 5: missing required column → check_columns fails
# ---------------------------------------------------------------------------


def test_missing_column_fails(tmpdir_fixture):
    """Drop the 'entries' column — schema check should fail."""
    daily = _make_good_daily_table()
    idx = daily.schema.get_field_index("entries")
    bad_daily = daily.remove_column(idx)

    daily_path = os.path.join(tmpdir_fixture, "crz_daily.parquet")
    hourly_path = os.path.join(tmpdir_fixture, "crz_hourly.parquet")
    pq.write_table(bad_daily, daily_path)
    pq.write_table(_make_good_hourly_table(), hourly_path)
    meta_path = _make_good_metadata(tmpdir_fixture, daily_path, hourly_path)

    build = {"daily": daily_path, "hourly": hourly_path, "meta": meta_path}
    con = _patched_con(build)

    result = validate_data.check_columns(con)
    con.close()
    assert result is False, "check_columns should fail when 'entries' column is absent"


# ---------------------------------------------------------------------------
# Test 6: no current-year rows or future metadata window → coverage check fails
# ---------------------------------------------------------------------------


def test_current_year_coverage_missing_fails(tmpdir_fixture):
    """A 2025-only artifact must not pass as a 2026 dashboard build."""
    prior_2025 = datetime.date(2025, 6, 5)
    bad_daily = pa.table(
        {
            "date": pa.array([prior_2025], type=pa.date32()),
            "detection_group": pa.array(["Brooklyn Bridge"], type=pa.string()),
            "vehicle_class": pa.array(["1 - Cars, Pickups and Vans"], type=pa.string()),
            "entry_type": pa.array(["CRZ"], type=pa.string()),
            "entries": pa.array([95], type=pa.int64()),
            "comparison_date": pa.array([None], type=pa.date32()),
        }
    )
    bad_hourly = pa.table(
        {
            "date": pa.array([prior_2025], type=pa.date32()),
            "hour": pa.array([9], type=pa.int8()),
            "detection_group": pa.array(["Brooklyn Bridge"], type=pa.string()),
            "vehicle_class": pa.array(["1 - Cars, Pickups and Vans"], type=pa.string()),
            "entry_type": pa.array(["CRZ"], type=pa.string()),
            "entries": pa.array([95], type=pa.int64()),
            "comparison_date": pa.array([None], type=pa.date32()),
        }
    )

    daily_path = os.path.join(tmpdir_fixture, "crz_daily.parquet")
    hourly_path = os.path.join(tmpdir_fixture, "crz_hourly.parquet")
    pq.write_table(bad_daily, daily_path)
    pq.write_table(bad_hourly, hourly_path)
    meta_path = _make_good_metadata(tmpdir_fixture, daily_path, hourly_path)
    with open(meta_path, "r") as f:
        meta = json.load(f)
    meta["data_as_of"] = "2025-06-05"
    meta["current_window_end"] = "2026-06-01"
    meta["comparable_period_end"] = "2026-06-01"
    with open(meta_path, "w") as f:
        json.dump(meta, f)

    build = {"daily": daily_path, "hourly": hourly_path, "meta": meta_path}
    con = _patched_con(build)

    assert validate_data.check_detection_group_parity(con) is False
    assert validate_data.check_current_year_coverage(con) is False

    con.close()


def test_metadata_window_later_than_source_fails(good_build):
    """The dashboard window must not extend beyond source data_as_of."""
    with open(good_build["meta"], "r") as f:
        meta = json.load(f)
    meta["current_window_end"] = "2026-06-01"
    meta["comparable_period_end"] = "2026-06-01"
    with open(good_build["meta"], "w") as f:
        json.dump(meta, f)

    con = _patched_con(good_build)
    result = validate_data.check_current_year_coverage(con)
    con.close()

    assert result is False, "current_window_end after data_as_of should fail"
