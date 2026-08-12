"""Read-only local preflight for the portable Ledger dashboard pack."""
from __future__ import annotations

import argparse
import importlib
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
READABLE_WORKBOOK_DIRS = {
    "data/key",
    "data/ledger",
    "data/SyntheticReview",
}


class CheckRun:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.warnings: list[str] = []

    def ok(self, message: str) -> None:
        print(f"[OK] {message}")

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"[WARN] {message}")

    def fail(self, message: str) -> None:
        self.failures.append(message)
        print(f"[FAIL] {message}")


def _is_cloud_placeholder(path: Path) -> bool:
    if os.name != "nt":
        return False
    attrs = getattr(path.stat(), "st_file_attributes", 0)
    return bool(attrs & (0x1000 | 0x40000 | 0x400000))


def _check_file_readable(run: CheckRun, path: Path, *, opener=None) -> None:
    cloud_placeholder = _is_cloud_placeholder(path)
    open_file = opener or path.open
    try:
        with open_file("rb") as handle:
            handle.read(1)
    except PermissionError:
        run.fail(
            f"Input workbook not readable: {path} "
            "(permission denied; CLOSE EXCEL BEFORE STARTING, then wait for cloud sync and retry)"
        )
    except OSError as exc:
        run.fail(f"Input workbook not readable: {path} ({exc})")
    else:
        if cloud_placeholder:
            run.warn(f"Input workbook readable after cloud hydration: {path.name}")
        else:
            run.ok(f"Input workbook readable: {path.name}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("local", "manual", "daily", "full"), default="local")
    parser.parse_args(argv)
    failures: list[str] = []
    for module in ("pandas", "openpyxl"):
        try: importlib.import_module(module)
        except Exception as exc: failures.append(f"dependency {module}: {exc}")
    for rel in ("dashboard/dashboard.html", "dashboard/dashboard_data.js", "dashboard/status.json", "dashboard/favicon.svg", "data/master/Owner_map.csv", "data/master/Synthetic_Vendor_Master_Matrix.csv"):
        if not (ROOT / rel).is_file(): failures.append(f"missing {rel}")
    expected = {"ledger_weekly.sqlite": ("ledger_lines", 4), "key_weekly.sqlite": ("key_lines", 4), "synthetic_review_daily.sqlite": ("synthetic_review_lines", 1), "escalation_daily.sqlite": ("escalation_lines", 1)}
    for filename, (table, minimum) in expected.items():
        path = ROOT / "runtime/db" / filename
        try:
            with sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True) as conn:
                if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok": failures.append(f"integrity {filename}")
                count = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
                if count < minimum: failures.append(f"rows {filename}:{table}={count}")
        except sqlite3.Error as exc: failures.append(f"database {filename}: {exc}")
    for failure in failures: print(f"[FAIL] {failure}")
    print(f"Python: {sys.version.split()[0]}; root: {ROOT}; failures: {len(failures)}")
    if not failures: print("[OK] portable local preflight passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
