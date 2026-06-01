"""
test_build_data_download.py
===========================
Covers Socrata CSV download retry behavior in build_data.py without making
network requests.
"""

import datetime
import os
import sys
import tempfile
import types
from pathlib import Path

import pytest

try:
    import requests
except ModuleNotFoundError:
    requests = types.ModuleType("requests")

    class Response:
        status_code = 200

    class RequestException(Exception):
        pass

    class Timeout(RequestException):
        pass

    class ConnectionError(RequestException):
        pass

    class ChunkedEncodingError(RequestException):
        pass

    class HTTPError(RequestException):
        def __init__(self, *args, response=None):
            super().__init__(*args)
            self.response = response

    def get(*args, **kwargs):
        raise AssertionError("requests.get should be monkeypatched in tests")

    requests.Response = Response
    requests.get = get
    requests.exceptions = types.SimpleNamespace(
        Timeout=Timeout,
        ConnectionError=ConnectionError,
        ChunkedEncodingError=ChunkedEncodingError,
        HTTPError=HTTPError,
    )
    sys.modules["requests"] = requests

try:
    import duckdb  # noqa: F401
except ModuleNotFoundError:
    sys.modules["duckdb"] = types.ModuleType("duckdb")

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

import build_data  # noqa: E402  (import after sys.path tweak)


class FakeResponse:
    def __init__(self, *, status_code=200, chunks=None, iter_error=None):
        self.status_code = status_code
        self.headers = {"content-length": str(sum(len(c) for c in chunks or []))}
        self._chunks = chunks or []
        self._iter_error = iter_error

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            response = requests.Response()
            response.status_code = self.status_code
            raise requests.exceptions.HTTPError(
                f"{self.status_code} Server Error",
                response=response,
            )

    def iter_content(self, chunk_size):
        yield from self._chunks
        if self._iter_error is not None:
            raise self._iter_error


@pytest.fixture()
def isolated_download_dir(monkeypatch, tmp_path):
    real_named_temporary_file = tempfile.NamedTemporaryFile

    def named_temporary_file(*args, **kwargs):
        kwargs["dir"] = tmp_path
        return real_named_temporary_file(*args, **kwargs)

    monkeypatch.setattr(build_data.tempfile, "NamedTemporaryFile", named_temporary_file)
    return tmp_path


@pytest.fixture()
def no_sleep(monkeypatch):
    sleeps = []
    monkeypatch.setattr(build_data.time, "sleep", sleeps.append)
    return sleeps


def test_download_csv_retries_transient_timeout_and_deletes_partial_file(
    monkeypatch,
    isolated_download_dir,
    no_sleep,
):
    calls = []

    def fake_get(*args, **kwargs):
        calls.append((args, kwargs))
        if len(calls) == 1:
            raise requests.exceptions.Timeout("read timed out")
        return FakeResponse(chunks=[b"header\n", b"row\n"])

    monkeypatch.setattr(build_data.requests, "get", fake_get)

    downloaded_path = build_data.download_csv("https://example.test/data.csv")

    assert len(calls) == 2
    assert no_sleep == [build_data.DOWNLOAD_BACKOFF_SECONDS]
    assert Path(downloaded_path).read_bytes() == b"header\nrow\n"
    assert sorted(p.name for p in isolated_download_dir.glob("crz_raw_*.csv")) == [
        Path(downloaded_path).name
    ]

    os.unlink(downloaded_path)


def test_download_csv_deletes_partial_file_after_midstream_failure(
    monkeypatch,
    isolated_download_dir,
    no_sleep,
):
    calls = []

    def fake_get(*args, **kwargs):
        calls.append((args, kwargs))
        if len(calls) == 1:
            return FakeResponse(
                chunks=[b"header\n"],
                iter_error=requests.exceptions.ChunkedEncodingError("stream ended"),
            )
        return FakeResponse(chunks=[b"header\n", b"row\n"])

    monkeypatch.setattr(build_data.requests, "get", fake_get)

    downloaded_path = build_data.download_csv("https://example.test/data.csv")

    assert len(calls) == 2
    assert no_sleep == [build_data.DOWNLOAD_BACKOFF_SECONDS]
    assert Path(downloaded_path).read_bytes() == b"header\nrow\n"
    assert sorted(p.name for p in isolated_download_dir.glob("crz_raw_*.csv")) == [
        Path(downloaded_path).name
    ]

    os.unlink(downloaded_path)


def test_download_csv_retries_5xx_but_not_4xx(monkeypatch, isolated_download_dir, no_sleep):
    calls = []

    def fake_get(*args, **kwargs):
        calls.append((args, kwargs))
        return FakeResponse(status_code=503 if len(calls) == 1 else 404)

    monkeypatch.setattr(build_data.requests, "get", fake_get)

    with pytest.raises(requests.exceptions.HTTPError):
        build_data.download_csv("https://example.test/data.csv")

    assert len(calls) == 2
    assert no_sleep == [build_data.DOWNLOAD_BACKOFF_SECONDS]
    assert list(isolated_download_dir.glob("crz_raw_*.csv")) == []


def test_download_csv_exhausts_transient_retries_and_deletes_all_partials(
    monkeypatch,
    isolated_download_dir,
    no_sleep,
):
    calls = []

    def fake_get(*args, **kwargs):
        calls.append((args, kwargs))
        raise requests.exceptions.ConnectionError("connection dropped")

    monkeypatch.setattr(build_data.requests, "get", fake_get)

    with pytest.raises(requests.exceptions.ConnectionError):
        build_data.download_csv("https://example.test/data.csv")

    assert len(calls) == build_data.DOWNLOAD_ATTEMPTS
    assert no_sleep == [
        build_data.DOWNLOAD_BACKOFF_SECONDS,
        build_data.DOWNLOAD_BACKOFF_SECONDS * 2,
    ]
    assert list(isolated_download_dir.glob("crz_raw_*.csv")) == []


def test_create_raw_views_rejects_malformed_required_fields(tmp_path):
    duckdb_module = pytest.importorskip("duckdb")
    if not hasattr(duckdb_module, "connect"):
        pytest.skip("duckdb is required for raw CSV parsing coverage")

    csv_path = tmp_path / "crz_sample.csv"
    csv_path.write_text(
        "Toll Date,Toll Hour,Toll 10 Minute Block,Hour of Day,Day of Week Number,"
        "Month Number,Day of Week,Week Ending Date,Time Period,Vehicle Class,"
        "Detection Group,Detection Region,CRZ Entries,Excluded Roadway Entries\n"
        "06/10/2025,06/10/2025 05:00:00 AM,06/10/2025 05:00:00 AM,0,5,3,"
        "Tuesday,06/08/2025,Peak,5 - Motorcycles,Hugh L. Carey Tunnel,Brooklyn,{\n"
        "06/11/2025,06/11/2025 05:00:00 AM,06/11/2025 05:00:00 AM,1,5,3,"
        "Wednesday,06/08/2025,Peak,5 - Motorcycles,Hugh L. Carey Tunnel,Brooklyn,12,3\n",
        encoding="utf-8",
    )

    con = duckdb_module.connect()
    source_count, valid_count, rejected_count = build_data.create_raw_views(
        con,
        str(csv_path),
    )

    assert (source_count, valid_count, rejected_count) == (2, 1, 1)
    assert con.execute(
        """
        SELECT toll_date, hour_of_day, detection_group, vehicle_class,
               crz_entries, excluded_roadway_entries
        FROM raw
        """
    ).fetchall() == [
        (
            datetime.date(2025, 6, 11),
            1,
            "Hugh L. Carey Tunnel",
            "5 - Motorcycles",
            12,
            3,
        )
    ]
    con.close()
