#!/usr/bin/env python3
"""health_check.py  Data freshness verification for the AP Dashboard.

Checks the age of key files (dashboard_data.js, SQLite databases) and
produces a status.json that the dashboard can read to show a health badge.

Usage:
    py scripts/health_check.py           # Run checks, write status.json
    py scripts/health_check.py --quiet   # Suppress stdout (for automation)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from .paths import DASHBOARD_DIR, LEDGER_DB, SYNTHETIC_REVIEW_DB

#  Check definitions 
CHECKS = {
    "dashboard_data": {
        "file": DASHBOARD_DIR / "dashboard_data.js",
        "label": "Dashboard Data (JS)",
        "max_age_hours": 26,   # pipeline runs ~08:30, 24h + 2h margin
    },
    "ledger_db": {
        "file": LEDGER_DB,
        "label": "Ledger Database",
        "max_age_hours": 26,
    },
    "synthetic_review_db": {
        "file": SYNTHETIC_REVIEW_DB,
        "label": "SyntheticReview Database",
        "max_age_hours": 50,   # can miss 1 day (SSO failures)
    },
}

STATUS_FILE = DASHBOARD_DIR / "status.json"


def check_file_age(file_path: Path, max_age_hours: float) -> dict:
    """Check if a file exists and is younger than max_age_hours.

    Returns dict with: ok, age_hours, last_modified, exists, message.
    """
    if not file_path.exists():
        return {
            "ok": False,
            "exists": False,
            "age_hours": None,
            "last_modified": None,
            "message": "File not found",
        }

    mtime = file_path.stat().st_mtime
    age_seconds = time.time() - mtime
    age_hours = round(age_seconds / 3600, 1)
    last_modified = datetime.fromtimestamp(mtime).strftime("%Y-%m-%dT%H:%M")
    ok = age_hours <= max_age_hours

    return {
        "ok": ok,
        "exists": True,
        "age_hours": age_hours,
        "last_modified": last_modified,
        "message": "OK" if ok else f"Stale ({age_hours}h > {max_age_hours}h threshold)",
    }


def _compute_data_sizes() -> dict:
    """Compute size of all data files (core JS + chunks + trend cube)."""
    sizes = {"core_mb": 0, "chunks_mb": 0, "trend_cube_mb": 0, "total_mb": 0, "chunk_count": 0}

    core = DASHBOARD_DIR / "dashboard_data.js"
    if core.exists():
        sizes["core_mb"] = round(core.stat().st_size / (1024 * 1024), 2)

    chunks_dir = DASHBOARD_DIR / "data"
    if chunks_dir.is_dir():
        week_files = list(chunks_dir.glob("week_*.js"))
        sizes["chunk_count"] = len(week_files)
        sizes["chunks_mb"] = round(sum(f.stat().st_size for f in week_files) / (1024 * 1024), 2)
        trend = chunks_dir / "trend_cube.js"
        if trend.exists():
            sizes["trend_cube_mb"] = round(trend.stat().st_size / (1024 * 1024), 2)

    sizes["total_mb"] = round(sizes["core_mb"] + sizes["chunks_mb"] + sizes["trend_cube_mb"], 2)
    return sizes


def run_checks(quiet: bool = False) -> dict:
    """Run all health checks and return status dict."""
    results = {}
    all_ok = True

    for key, config in CHECKS.items():
        result = check_file_age(config["file"], config["max_age_hours"])
        results[key] = result

        if not result["ok"]:
            all_ok = False

        if not quiet:
            status = "OK" if result["ok"] else "STALE"
            label = config["label"]
            if result["exists"]:
                print(f"  [{status}] {label}: {result['age_hours']}h old (max {config['max_age_hours']}h)")
            else:
                print(f"  [MISSING] {label}: file not found")

    overall = "ok" if all_ok else "stale"

    # Data size metrics (core + chunks + trend cube)
    data_sizes = _compute_data_sizes()

    status_data = {
        "checked_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "overall": overall,
        "checks": results,
        "data_sizes": data_sizes,
    }

    if not quiet:
        total_mb = data_sizes.get("total_mb", 0)
        core_mb = data_sizes.get("core_mb", 0)
        chunks_mb = data_sizes.get("chunks_mb", 0)
        print(f"  [SIZE] Total data: {total_mb:.1f} MB (core {core_mb:.1f} + chunks {chunks_mb:.1f})")
        if total_mb > 15:
            print(f"  *** WARN: Total data exceeds 15 MB ({total_mb:.1f} MB) ***")
        print(f"\n  Overall: {overall.upper()}")

    return status_data


def write_status(status_data: dict) -> Path:
    """Write status.json to dashboard directory."""
    STATUS_FILE.write_text(
        json.dumps(status_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return STATUS_FILE


def main():
    parser = argparse.ArgumentParser(description="Synthetic Reporting  Health Check")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="Suppress stdout output")
    args = parser.parse_args()

    if not args.quiet:
        print("=" * 50)
        print("HEALTH CHECK")
        print("=" * 50)

    status = run_checks(quiet=args.quiet)
    out = write_status(status)

    if not args.quiet:
        print(f"\n  Written: {out}")

    # Exit 0 always  health check should never block pipeline
    sys.exit(0)


if __name__ == "__main__":
    main()
