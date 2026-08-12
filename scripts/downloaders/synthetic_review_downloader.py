"""Offline-only adapter for importing an explicit synthetic review fixture.

The public pack contains no tenant URL, login flow, SSO branch, credentials,
or persistent browser profile. External acquisition is deliberately outside
this repair candidate.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ..utils.paths import SYNTHETIC_REVIEW_DATA


def import_fixture(source: Path, *, dry_run: bool = False) -> Path:
    source = source.resolve()
    if not source.is_file() or source.suffix.lower() != ".xlsx":
        raise ValueError("--fixture must reference a readable .xlsx file")
    destination = SYNTHETIC_REVIEW_DATA / f"synthetic-review-{source.name}"
    if not dry_run:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import an explicit synthetic review fixture")
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.fixture is None:
        print("External download disabled; provide --fixture for an explicit local import.")
        return 0
    try:
        destination = import_fixture(args.fixture, dry_run=args.dry_run)
    except (OSError, ValueError) as exc:
        print(f"[FAIL] {exc}")
        return 1
    print(f"[OK] synthetic fixture target: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
