#!/usr/bin/env python3
"""
AP CONTROL DASHBOARD V19 - Server Module
Helper server management (Go binary): start, stop, reload, sync.
Split from Rol_Query.py for maintainability.
"""

import json
import time
import shutil
import subprocess
import urllib.request

from .dashboard_config import (
    HELPER_BIND, HELPER_PORT, OUTPUT_DIR,
    SQLITE_SOURCE, SQLITE_PATH,
)
from ..utils.log import get_logger

log = get_logger(__name__)


def _helper_is_running():
    """Check if helper is running and responding on /health."""
    try:
        url = f"http://127.0.0.1/"
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
            return data.get("ok", False)
    except Exception:
        return False


def _stop_helper():
    """Synthetic Owner 012ful shutdown: POST /shutdown first, then fallback to force kill."""
    # 1. Try graceful shutdown via /shutdown endpoint
    try:
        url = f"http://127.0.0.1/"
        req = urllib.request.Request(url, method='POST', data=b'')
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            if data.get("ok"):
                log.info("  [HELPER] Synthetic Owner 012ful shutdown requested")
                # Wait for process to exit (poll up to 5s)
                for _ in range(10):
                    time.sleep(0.5)
                    if not _helper_is_running():
                        log.info("  [HELPER] Stopped cleanly")
                        return
                log.warning("  [HELPER] Still running after 5s, forcing kill...")
    except Exception:
        pass  # helper not running or /shutdown not available

    # 2. Fallback: force kill
    try:
        subprocess.run(
            ["powershell", "-Command",
             "Get-Process -Name rol_helper -ErrorAction SilentlyContinue | Stop-Process -Force"],
            capture_output=True, timeout=10
        )
        time.sleep(1)
        log.info("  [HELPER] Force-stopped rol_helper.exe")
    except Exception:
        pass  # not running, that's fine


def _start_helper():
    """Start rol_helper.exe and wait for /health to respond (polling)."""
    helper_exe = OUTPUT_DIR / "helper" / "rol_helper.exe"
    helper_cfg = OUTPUT_DIR / "helper" / "rol_helper_config.json"
    if not helper_exe.exists():
        log.info("  [HELPER] rol_helper.exe not found, skipping start")
        return False
    try:
        subprocess.Popen(
            [str(helper_exe), "--config", str(helper_cfg)],
            creationflags=0x08000000,  # CREATE_NO_WINDOW
            close_fds=True
        )
    except Exception as e:
        log.error("  [HELPER] Could not start: %s", e)
        return False

    # Poll /health until ready (max 30s, 500ms intervals)
    health_url = f"http://127.0.0.1/"
    start = time.time()
    max_wait = 30
    while time.time() - start < max_wait:
        time.sleep(0.5)
        try:
            req = urllib.request.Request(health_url, method='GET')
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read())
                if data.get("ok"):
                    elapsed = time.time() - start
                    log.info("  [HELPER] Ready in %.1fs (PID=%s)", elapsed, data.get('pid', '?'))
                    return True
        except Exception:
            continue

    log.warning("  [HELPER] not ready after %ds, proceeding anyway", max_wait)
    return False


def _reload_helper(ds="ledger"):
    """Hot-reload: POST /reload?ds=X to make helper re-read the SQLite without restart."""
    try:
        url = f"http://127.0.0.1/"
        req = urllib.request.Request(url, method='POST', data=b'')
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            if data.get("ok"):
                log.info("  [HELPER] Hot-reload OK for %s", ds)
                return True
    except Exception as e:
        log.warning("  [HELPER] Hot-reload failed: %s", e)
    return False


def sync_sqlite():
    """Copy ledger_weekly.sqlite from generator output to local + pack output.
    Uses hot-reload if helper is running, otherwise does stop/start."""
    pack_dest = OUTPUT_DIR / "data" / "ledger_weekly.sqlite"

    if not SQLITE_SOURCE.exists():
        log.warning("[SKIP] SQLite source not found: %s", SQLITE_SOURCE)
        log.warning("       Run load_ledger_weekly_to_sqlite_clean_split.py first.")
        return False

    src_size = SQLITE_SOURCE.stat().st_size / (1024 * 1024)
    log.info("[SYNC] Source: %s (%.1f MB)", SQLITE_SOURCE.name, src_size)

    # 1. Copy to local folder (where Rol_Query.py reads from)
    log.info("  -> Copying to local: %s", SQLITE_PATH)
    shutil.copy2(SQLITE_SOURCE, SQLITE_PATH)

    # 2. Copy to pack output folder.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "data").mkdir(exist_ok=True)
    log.info("  -> Copying to pack output: %s", pack_dest)
    shutil.copy2(SQLITE_SOURCE, pack_dest)

    # 3. Hot-reload if helper is running (zero downtime)
    if _helper_is_running():
        log.info("  [HELPER] Helper is running, attempting hot-reload...")
        if _reload_helper("ledger"):
            log.info("[SYNC] Done! SQLite synced + helper hot-reloaded (zero downtime).")
            return True
        else:
            log.warning("  [HELPER] Hot-reload failed, falling back to stop/start...")

    # 4. Fallback: stop + start
    _stop_helper()
    _start_helper()

    log.info("[SYNC] Done! SQLite synced + helper restarted.")
    return True
