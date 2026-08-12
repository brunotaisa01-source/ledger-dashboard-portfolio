"""Small atomic write/copy helpers for generated dashboard assets."""

from __future__ import annotations

import filecmp
import os
import shutil
from pathlib import Path
from typing import Iterable


def _tmp_path(path: Path) -> Path:
    return path.with_name(f".{path.name}.{os.getpid()}.tmp")


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> bool:
    """Write text atomically and skip replacing the file when content is unchanged."""
    if path.exists() and path.read_text(encoding=encoding) == text:
        return False

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = _tmp_path(path)
    try:
        with open(tmp, "w", encoding=encoding) as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        return True
    finally:
        if tmp.exists():
            tmp.unlink()


def files_equal(src: Path, dst: Path) -> bool:
    if not dst.exists():
        return False
    if src.stat().st_size != dst.stat().st_size:
        return False
    return filecmp.cmp(src, dst, shallow=False)


def copy_if_changed(src: Path, dst: Path) -> bool:
    """Copy src to dst atomically only when bytes differ."""
    if files_equal(src, dst):
        return False

    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = _tmp_path(dst)
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
        return True
    finally:
        if tmp.exists():
            tmp.unlink()


def sync_generated_js_dir(src_dir: Path, dst_dir: Path, expected_names: Iterable[str] | None = None) -> tuple[int, int]:
    """Sync generated JS assets and prune stale week chunks only."""
    names = set(expected_names) if expected_names is not None else {p.name for p in src_dir.glob("*.js")}
    copied = 0
    pruned = 0
    dst_dir.mkdir(parents=True, exist_ok=True)

    for name in sorted(names):
        src = src_dir / name
        if src.exists() and copy_if_changed(src, dst_dir / name):
            copied += 1

    for stale in dst_dir.glob("week_*.js"):
        if stale.name not in names:
            stale.unlink()
            pruned += 1

    return copied, pruned
