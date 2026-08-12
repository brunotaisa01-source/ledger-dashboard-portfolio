"""Atomic run lock for the Dashboard Ledger Operations Pack.

The lock file lives on the Local Fixture Store-shared `runtime/db/.running.lock` path so
every laptop that opens the pack can see whether someone else is currently
running the pipeline. The DB working copy is kept on local disk, but the lock
is the synchronisation point across teammates.

Subcommands:
    acquire   Create the lock or fail if held by someone else.
    release   Remove the lock if held by us (or always with --force).
    check     Print the lock JSON (exit 0 if held, 1 if free).

Exit codes:
    0   ok (lock created / released / held)
    1   lock held by another user (acquire) or no lock (check)
    2   stale lock was purged before acquire (still acquires)
    3   Local Fixture Store conflict copy detected near the lock dir
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path

STALE_HOURS = 2.0
CONFLICT_PATTERNS = ("-conflicted-copy", "-Conflicted-Copy", "(conflicted)")


def _lock_path() -> Path:
    raw = os.environ.get("Synthetic_REPORTING_LOCK_FILE")
    if not raw:
        sys.stderr.write("[run_lock] Synthetic_REPORTING_LOCK_FILE not set\n")
        sys.exit(2)
    return Path(raw)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(text: str) -> datetime | None:
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _is_stale(payload: dict) -> bool:
    started = _parse_iso(payload.get("started_at", ""))
    if started is None:
        return True
    age_h = (datetime.now(timezone.utc) - started).total_seconds() / 3600.0
    return age_h > STALE_HOURS


def _scan_conflicts(lock: Path) -> list[Path]:
    parent = lock.parent
    if not parent.exists():
        return []
    hits: list[Path] = []
    for entry in parent.iterdir():
        name = entry.name
        if any(pat in name for pat in CONFLICT_PATTERNS):
            hits.append(entry)
    return hits


def _identity() -> dict:
    return {
        "user": getpass.getuser(),
        "computer": socket.gethostname(),
        "pid": os.getpid(),
        "pack_path": os.environ.get("PROJECT", ""),
    }


def cmd_acquire(args: argparse.Namespace) -> int:
    lock = _lock_path()
    lock.parent.mkdir(parents=True, exist_ok=True)

    conflicts = _scan_conflicts(lock)
    if conflicts and not args.ignore_conflicts:
        sys.stderr.write("[run_lock] Local Fixture Store conflict copies detected near lock dir:\n")
        for c in conflicts:
            sys.stderr.write(f"  - {c}\n")
        sys.stderr.write("Resolve them before running the pipeline.\n")
        return 3

    stale_purged = False
    if lock.exists():
        try:
            payload = json.loads(lock.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        if _is_stale(payload):
            sys.stderr.write(
                f"[run_lock] Stale lock purged (was held by {payload.get('user','?')}"
                f"@{payload.get('computer','?')} since {payload.get('started_at','?')}).\n"
            )
            try:
                lock.unlink()
                stale_purged = True
            except OSError as exc:
                sys.stderr.write(f"[run_lock] Failed to purge stale lock: {exc}\n")
                return 1
        else:
            sys.stderr.write(
                f"[run_lock] Lock held by {payload.get('user','?')}"
                f"@{payload.get('computer','?')} since {payload.get('started_at','?')}.\n"
            )
            sys.stderr.write("Wait for it to finish or ask them to release it.\n")
            return 1

    payload = _identity()
    payload["started_at"] = _now_iso()
    payload["mode"] = args.mode
    lock.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    sys.stdout.write(f"[run_lock] acquired by {payload['user']}@{payload['computer']}\n")
    return 2 if stale_purged else 0


def cmd_release(args: argparse.Namespace) -> int:
    lock = _lock_path()
    if not lock.exists():
        sys.stdout.write("[run_lock] no lock to release\n")
        return 0
    try:
        payload = json.loads(lock.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}
    me = _identity()
    holder_match = (
        payload.get("user") == me["user"]
        and payload.get("computer") == me["computer"]
    )
    if not holder_match and not args.force:
        sys.stderr.write(
            f"[run_lock] refusing to release lock held by {payload.get('user','?')}"
            f"@{payload.get('computer','?')}. Use --force to override.\n"
        )
        return 1
    try:
        lock.unlink()
    except OSError as exc:
        sys.stderr.write(f"[run_lock] failed to remove lock: {exc}\n")
        return 1
    sys.stdout.write("[run_lock] released\n")
    return 0


def cmd_check(_: argparse.Namespace) -> int:
    lock = _lock_path()
    if not lock.exists():
        sys.stdout.write("free\n")
        return 1
    try:
        payload = json.loads(lock.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}
    sys.stdout.write(json.dumps(payload, indent=2) + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="run_lock")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_acq = sub.add_parser("acquire")
    p_acq.add_argument("--mode", default="pipeline", help="Tag the lock with the run mode (full/daily/test)")
    p_acq.add_argument("--ignore-conflicts", action="store_true", help="Acquire even if conflict copies are present")
    p_acq.set_defaults(func=cmd_acquire)

    p_rel = sub.add_parser("release")
    p_rel.add_argument("--force", action="store_true", help="Release even if held by someone else")
    p_rel.set_defaults(func=cmd_release)

    p_chk = sub.add_parser("check")
    p_chk.set_defaults(func=cmd_check)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
