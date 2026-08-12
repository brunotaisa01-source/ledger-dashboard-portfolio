"""
Central path configuration: 100% relative to project root.
Move the entire Ledger_Reporting folder anywhere and everything works.

Database strategy:
  - Synthetic_REPORTING_DB_DIR override when set by Operations Pack wrappers
  - LOCAL_DB_DIR defaults to ROOT/runtime/db.
  - Synthetic_REPORTING_DB_DIR is an explicit external override only.
  - No operator-specific profile path is inferred.
"""
from __future__ import annotations

import filecmp
import logging
import os
import shutil
import time
from pathlib import Path

_logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent.parent

# Data directories
KEY_DATA     = ROOT / "data" / "key"
LEDGER_DATA  = ROOT / "data" / "ledger"
MASTER_DATA  = ROOT / "data" / "master"
SITE_CODES   = MASTER_DATA / "site_codes"
SYNTHETIC_REVIEW_DATA   = ROOT / "data" / "SyntheticReview"
ESCALATION_DATA = ROOT / "data" / "Escalation"
STOREBOOK_ZR_DATA = ROOT / "data" / "Storebook ZR"
STOREBOOK_ZR_SOURCE_DATA = STOREBOOK_ZR_DATA / "Data"
ESCALATION_FILE = ESCALATION_DATA / "Escalations_Email_log.xlsx"
ESCALATION_SOURCE = (
    Path(os.environ["Synthetic_REPORTING_ESCALATION_SOURCE"])
    if os.environ.get("Synthetic_REPORTING_ESCALATION_SOURCE")
    else ESCALATION_FILE
)


def get_escalation_source() -> Path:
    """Return the pack-local or explicitly configured escalation workbook."""
    configured = os.environ.get("Synthetic_REPORTING_ESCALATION_SOURCE")
    return Path(configured) if configured else ESCALATION_FILE

# Archive directories
KEY_ARCHIVE    = KEY_DATA / "archive"
LEDGER_ARCHIVE = LEDGER_DATA / "archive"
SYNTHETIC_REVIEW_ARCHIVE  = SYNTHETIC_REVIEW_DATA / "archive"
MASTER_ARCHIVE = MASTER_DATA / "archive"
ESCALATION_ARCHIVE = ESCALATION_DATA / "archive"
STOREBOOK_ZR_ARCHIVE = STOREBOOK_ZR_DATA / "Archive"

# SQL (build machine only, never deployed)
SQL_DIR      = ROOT / "sql"

# Databases
# Local (non-synced), safe from fixture-store file locking.
# Operations Pack: pack_env.bat MUST set Synthetic_REPORTING_DB_DIR to a pack-isolated
# folder. If the env var is missing, fall back to a clearly-marked pack-local
# sentinel directory so we never overwrite the original repo's databases at
# an operator profile directory.
_DEFAULT_LOCAL_DB_DIR = ROOT / "runtime" / "db"
LOCAL_DB_DIR = Path(os.environ.get("Synthetic_REPORTING_DB_DIR", _DEFAULT_LOCAL_DB_DIR)).resolve()
if not os.environ.get("TESTING"):
    LOCAL_DB_DIR.mkdir(parents=True, exist_ok=True)

# Local Fixture Store copy (backup / portability).
# Operations Pack sets Synthetic_REPORTING_SYNC_DIR to align this with the lock dir
# (runtime/db) so the loader's auto-sync and pack_db_sync.bat write to a
# single shared Local Fixture Store folder instead of duplicating into ROOT/db.
SYNC_DB_DIR  = Path(os.environ.get("Synthetic_REPORTING_SYNC_DIR", ROOT / "runtime" / "db")).resolve()

# Active paths: all scripts use these and point to the local working copy.
DB_DIR       = LOCAL_DB_DIR
KEY_DB       = DB_DIR / "key_weekly.sqlite"
LEDGER_DB    = DB_DIR / "ledger_weekly.sqlite"
SYNTHETIC_REVIEW_DB     = DB_DIR / "synthetic_review_daily.sqlite"
ESCALATION_DB = DB_DIR / "escalation_daily.sqlite"
STOREBOOK_ZR_DB = DB_DIR / "storebook_zr_daily.sqlite"
BACKLOG_DIR  = SYNC_DB_DIR / "backlog"

# Dashboard
DASHBOARD_DIR = ROOT / "dashboard"
_DASHBOARD_LOCAL_DIR = Path(os.environ.get("DASHBOARD_LOCAL_DIR", DASHBOARD_DIR))
LIBS_DIR      = DASHBOARD_DIR / "libs"
CSS_DIR       = DASHBOARD_DIR / "css"
JS_DIR        = DASHBOARD_DIR / "js"
TS_DIR        = DASHBOARD_DIR / "ts"       # TypeScript source (compiled to JS_DIR)
CHUNKS_DIR    = _DASHBOARD_LOCAL_DIR / "data"    # week chunks + trend cube (lazy-loaded)

# Logs
LOGS_DIR = ROOT / "logs"


# Archive helpers
def archive_old_files(data_dir: Path, archive_dir: Path, keep_pattern: str | None = None, glob_pattern: str = '*.xlsx') -> list[str]:
    # Never overwrite: if the destination already exists, the incoming file
    # is renamed with a .conflict-<epoch> suffix so both survive.
    # Regression guard for the Session 42 incident where Key 13.04.xlsx was
    # silently clobbered by shutil.move().
    archive_dir.mkdir(parents=True, exist_ok=True)
    archived = []
    for f in data_dir.glob(glob_pattern):
        if f.name.startswith('~$'):
            continue
        if keep_pattern and keep_pattern in f.name:
            continue
        dest = archive_dir / f.name
        if dest.exists():
            dest = archive_dir / f"{dest.stem}.conflict-{int(time.time())}{dest.suffix}"
            _logger.warning("Archive conflict: %s -> %s", f.name, dest.name)
        shutil.move(str(f), str(dest))
        archived.append(dest.name)
    return archived


def collect_all_files(data_dir: Path, archive_dir: Path, pattern: str = '*.xlsx') -> list[Path]:
    """Collect files from BOTH data_dir and archive_dir (for rebuild mode).
    Returns list of Path objects sorted by name."""
    files = list(data_dir.glob(pattern))
    if archive_dir.exists():
        files.extend(archive_dir.glob(pattern))
    return sorted([f for f in files if not f.name.startswith('~$')], key=lambda f: f.name)


def cleanup_archive(archive_dir: Path, max_days: int = 90) -> list[str]:
    """Delete files older than max_days from archive_dir.
    Returns list of deleted file names."""
    import datetime as _dt
    if not archive_dir.exists():
        return []
    cutoff = _dt.datetime.now().timestamp() - (max_days * 86400)
    deleted = []
    for f in archive_dir.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()
            deleted.append(f.name)
    return deleted


# DB sync helpers
def _bootstrap_local_db() -> None:
    """On first run, copy DBs from Local Fixture Store to local if they don't exist yet."""
    for name in (
        "key_weekly.sqlite",
        "ledger_weekly.sqlite",
        "synthetic_review_daily.sqlite",
        "escalation_daily.sqlite",
        "storebook_zr_daily.sqlite",
        "productivity_audit.sqlite",
    ):
        local = LOCAL_DB_DIR / name
        sync = SYNC_DB_DIR / name
        if not local.exists() and sync.exists():
            shutil.copy2(sync, local)

def sync_db_to_fixture_store() -> list[str]:
    """Copy local DBs to the shared pack mirror folder."""
    SYNC_DB_DIR.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in (
        "key_weekly.sqlite",
        "ledger_weekly.sqlite",
        "synthetic_review_daily.sqlite",
        "escalation_daily.sqlite",
        "storebook_zr_daily.sqlite",
        "productivity_audit.sqlite",
    ):
        local = LOCAL_DB_DIR / name
        if local.exists():
            dest = SYNC_DB_DIR / name
            if dest.exists() and filecmp.cmp(local, dest, shallow=False):
                continue
            tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
            try:
                shutil.copy2(local, tmp)
                os.replace(tmp, dest)
            finally:
                if tmp.exists():
                    tmp.unlink()
            copied.append(name)
    return copied

# Auto-bootstrap on import (skipped during testing to avoid filesystem side effects)
if not os.environ.get("TESTING"):
    _bootstrap_local_db()
