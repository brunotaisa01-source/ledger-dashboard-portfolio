"""Database connection helpers  WAL mode and performance PRAGMAs."""
from __future__ import annotations

import contextlib
import logging
import os
import shutil
import sqlite3
import time
import uuid
from collections.abc import Iterator, Sequence
from pathlib import Path

logger = logging.getLogger(__name__)


def _stage_path(target: Path) -> Path:
    return target.with_name(f".{target.name}.{os.getpid()}.{uuid.uuid4().hex}.stage")


def _cleanup_stage(path: Path) -> None:
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        for attempt in range(50):
            try:
                candidate.unlink(missing_ok=True)
                break
            except PermissionError:
                if attempt == 49:
                    raise
                time.sleep(0.1)


def _validate_stage(path: Path) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"staged database is missing or empty: {path.name}")
    with contextlib.closing(
        sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)
    ) as conn:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError(f"staged database failed integrity_check: {path.name}")


@contextlib.contextmanager
def staged_databases(targets: Sequence[Path]) -> Iterator[dict[Path, Path]]:
    """Yield isolated database copies and promote all only after a clean exit."""
    resolved = [Path(target).resolve() for target in targets]
    if len(set(resolved)) != len(resolved):
        raise ValueError("staged database targets must be unique")
    stages: dict[Path, Path] = {}
    try:
        for target in resolved:
            target.parent.mkdir(parents=True, exist_ok=True)
            stage = _stage_path(target)
            if target.exists():
                shutil.copy2(target, stage)
            stages[target] = stage
        yield stages
        for stage in stages.values():
            _validate_stage(stage)
        for target, stage in stages.items():
            os.replace(stage, target)
    finally:
        for stage in stages.values():
            _cleanup_stage(stage)


@contextlib.contextmanager
def staged_database(target: Path) -> Iterator[Path]:
    resolved = Path(target).resolve()
    with staged_databases((resolved,)) as stages:
        yield stages[resolved]


def configure_connection(conn: sqlite3.Connection) -> None:
    """Apply WAL mode and performance PRAGMAs after opening a connection.

    WAL mode is persistent  once set on a DB file, it stays across connections.
    Other PRAGMAs are per-connection and must be re-applied each time.
    """
    result = conn.execute("PRAGMA journal_mode=WAL").fetchone()
    if result and result[0] != "wal":
        logger.warning("WAL mode not set  got: %s", result[0])
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-64000")  # 64 MB
    conn.execute("PRAGMA mmap_size=268435456")  # 256 MB
    conn.execute("PRAGMA temp_store=MEMORY")
