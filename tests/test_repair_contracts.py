from __future__ import annotations

import os
import json
import re
import sqlite3
import zipfile
from contextlib import closing
from pathlib import Path

import pytest

os.environ.setdefault("TESTING", "1")

from scripts.utils.db_helpers import staged_database
from scripts.validation.validate_data import Results


ROOT = Path(__file__).resolve().parents[1]


def _text(value: tuple[int, ...]) -> str:
    return "".join(map(chr, value))


def _public_documents_are_self_contained() -> list[tuple[str, str]]:
    denied = (
        _text((67, 82, 79, 83, 83, 87, 65, 76, 75)),
        "worker" + " evidence",
        "worker_" + "observed",
        "pre" + "-drift",
        "original_" + "snapshot",
        "Project_" + "Analytics_Dashboard",
    )
    findings: list[tuple[str, str]] = []
    for pattern in ("*.md", "*.json"):
        for path in ROOT.rglob(pattern):
            content = path.read_text(encoding="utf-8", errors="ignore").casefold()
            for token in denied:
                if token.casefold() in content:
                    findings.append((str(path.relative_to(ROOT)), token))
    return findings


def _private_query_identity_findings() -> list[str]:
    denied = (
        _text((65, 80, 81)),
        _text((65, 80, 32, 81, 117, 101, 114, 105, 101, 115)),
        _text((65, 80, 32, 81, 117, 101, 114, 121)),
        "AP_" + "QUERIES",
        "ap" + "-queries",
    )
    tokens = tuple(token.casefold().encode("utf-8") for token in denied)
    text_suffixes = {
        ".bat", ".cmd", ".css", ".csv", ".html", ".js", ".json", ".md",
        ".ps1", ".py", ".sql", ".svg", ".ts", ".txt", ".xml",
    }
    archive_suffixes = {".docx", ".xlsm", ".xlsx", ".zip"}
    findings: list[str] = []
    for path in ROOT.rglob("*"):
        relative = str(path.relative_to(ROOT)).replace("\\", "/")
        relative_folded = relative.casefold().encode("utf-8")
        if any(token in relative_folded for token in tokens):
            findings.append(f"path:{relative}")
        if not path.is_file():
            continue
        suffix = path.suffix.casefold()
        if suffix in text_suffixes or suffix == ".sqlite":
            payload = path.read_bytes()
            payload = re.sub(
                rb"(?i)(base64,)[a-z0-9+/=\r\n]+",
                rb"\1<synthetic-payload>",
                payload,
            ).lower()
            if any(token in payload for token in tokens):
                findings.append(f"file:{relative}")
        if suffix in archive_suffixes:
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    member_name = member.filename.casefold().encode("utf-8")
                    member_payload = archive.read(member)
                    member_payload = re.sub(
                        rb"(?i)(base64,)[a-z0-9+/=\r\n]+",
                        rb"\1<synthetic-payload>",
                        member_payload,
                    ).lower()
                    if any(token in member_name or token in member_payload for token in tokens):
                        findings.append(f"archive:{relative}!{member.filename}")
    return findings


def _value(db: Path) -> str:
    with closing(sqlite3.connect(db)) as connection:
        return connection.execute("select value from fixture").fetchone()[0]


def test_zero_check_summaries_fail_closed(capsys: pytest.CaptureFixture[str]) -> None:
    overall = Results()
    assert overall.summary() != 0
    stage = Results()
    assert stage.stage_summary("SYNTHETIC STAGE") != 0
    output = capsys.readouterr().out
    assert "NO CHECKS EXECUTED" in output
    assert "ALL CHECKS PASSED" not in output


def test_public_documents_are_self_contained() -> None:
    assert _public_documents_are_self_contained() == []


def test_query_subpack_uses_only_neutral_synthetic_identity() -> None:
    assert _private_query_identity_findings() == []


def test_synthetic_query_shell_references_shipped_assets() -> None:
    app_root = ROOT / "data" / "Synthetic Queries"
    index = app_root / "index.html"
    release_manifest = app_root / "SYNTHETIC_QUERY_RELEASE_MANIFEST.json"
    assert index.is_file()
    assert release_manifest.is_file()
    html = index.read_text(encoding="utf-8")
    sources = re.findall(r'<script[^>]+src="([^"]+)"', html)
    assert sources
    assert all((app_root / source).is_file() for source in sources)
    manifest = json.loads((app_root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["name"] == "Synthetic Query Launcher"


def test_vendor_matrix_uses_stable_synthetic_filename() -> None:
    expected = ROOT / "data" / "master" / "Synthetic_Vendor_Master_Matrix.csv"
    old_name = "Copy" + " of Vendor Master Matrix.csv"
    assert expected.is_file()
    assert not (expected.parent / old_name).exists()
    stale_references = []
    for path in ROOT.rglob("*"):
        if old_name.casefold() in path.name.casefold():
            stale_references.append(str(path.relative_to(ROOT)))
        if path.is_file() and path.suffix.casefold() in {".csv", ".json", ".md", ".py", ".sql", ".txt"}:
            if old_name.casefold() in path.read_text(encoding="utf-8", errors="ignore").casefold():
                stale_references.append(str(path.relative_to(ROOT)))
    assert stale_references == []


def test_staged_database_preserves_target_on_failure(tmp_path: Path) -> None:
    target = tmp_path / "fixture.sqlite"
    with closing(sqlite3.connect(target)) as connection:
        connection.execute("create table fixture(value text not null)")
        connection.execute("insert into fixture values ('before')")
        connection.commit()

    with pytest.raises(RuntimeError, match="synthetic failure"):
        with staged_database(target) as stage:
            with closing(sqlite3.connect(stage)) as connection:
                connection.execute("update fixture set value = 'uncommitted replacement'")
                connection.commit()
            raise RuntimeError("synthetic failure")

    assert _value(target) == "before"
    assert not list(tmp_path.glob("*.stage*"))


def test_staged_database_promotes_only_valid_database(tmp_path: Path) -> None:
    target = tmp_path / "fixture.sqlite"
    with closing(sqlite3.connect(target)) as connection:
        connection.execute("create table fixture(value text not null)")
        connection.execute("insert into fixture values ('before')")
        connection.commit()

    with staged_database(target) as stage:
        with closing(sqlite3.connect(stage)) as connection:
            connection.execute("update fixture set value = 'after'")
            connection.commit()

    assert _value(target) == "after"
    assert not list(tmp_path.glob("*.stage*"))
