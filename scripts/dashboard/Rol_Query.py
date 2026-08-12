#!/usr/bin/env python3
"""
AP CONTROL DASHBOARD V19 - Main Entry Point (Orchestrator)

Modules:
  - dashboard_config.py : Constants, paths, themes, config
  - dashboard_data.py   : Data loading, trend cube, SyntheticReview, data JS generation
  - dashboard_html.py   : HTML generation (embedded, JSON mode, helper mode)
  - dashboard_server.py : Helper server management (Go binary)

Usage:
  python -m scripts.dashboard.Rol_Query --local-only
  python -m scripts.dashboard.Rol_Query --force-html --local-only
"""

import argparse
import sys
import traceback

from ..utils.paths import DASHBOARD_DIR
from ..utils.log import get_logger
from ..utils.file_sync import atomic_write_text, copy_if_changed, sync_generated_js_dir

from .dashboard_config import (
    HELPER_MODE, JSON_MODE,
    JSON_LOCAL_DIR, JSON_SDRIVE_DIR,
    OUTPUT_DIR, OUTPUT_CUBE_LEDGER, OUTPUT_DASHBOARD,
    SQLITE_PATH, HELPER_BIND, HELPER_PORT,
    get_output_html_path,
)

from .dashboard_data import (
    load_data_from_sqlite,
    load_key_from_sqlite,
    merge_key_and_ledger,
    load_synthetic_review_from_sqlite,
    load_statement_from_sqlite,
    load_escalation_from_sqlite,
    load_storebook_zr_from_sqlite,
    generate_data_js,
)

from .dashboard_html import (
    generate_html_dashboard,
    generate_html_template_json_mode,
    generate_html_dashboard_helper_mode,
)

from .dashboard_server import sync_sqlite

log = get_logger(__name__)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate AP Control Dashboard files.")
    parser.add_argument(
        "--force-html",
        action="store_true",
        help="Regenerate dashboard.html even when the local template already exists.",
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Generate dashboard files inside this Local Fixture Store-synced pack.",
    )
    parser.add_argument(
        "--reuse-trend-cube",
        action="store_true",
        help=(
            "Reuse existing dashboard/data/trend_cube.js instead of rebuilding "
            "the annual trend cube. Intended for daily refreshes only."
        ),
    )
    parser.add_argument(
        "--incremental-trend-cube",
        action="store_true",
        help=(
            "Update the existing trend cube for the latest/new week instead of "
            "rebuilding all historical weeks. Intended for weekly/full normal runs."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None):
    args = parse_args(argv)
    if args.reuse_trend_cube and args.incremental_trend_cube:
        raise ValueError("Use only one trend cube mode: reuse or incremental")
    log.info("=" * 70)
    log.info("AP CONTROL DASHBOARD V19 - COMPLETE FIX (DOC CATEGORY + WORKED)")
    log.info("=" * 70)
    try:
        # Auto-sync SQLite from generator output
        if HELPER_MODE:
            sync_sqlite()

        core_week_count = 3 if (args.reuse_trend_cube or args.incremental_trend_cube) else None
        if core_week_count:
            log.info("[INCREMENTAL] Loading %d recent raw weeks; historical weeks come from dashboard chunks", core_week_count)
        data = load_data_from_sqlite(core_week_count=core_week_count)

        # Load Key team data from separate SQLite
        try:
            key_data = load_key_from_sqlite(core_week_count=core_week_count)
            if key_data:
                data = merge_key_and_ledger(data, key_data)
                log.info("[OK] Key team merged: %d weeks", len(key_data['weeks_data']))
            else:
                log.warning("[KEY] No data available  dashboard shows ROL + Query only")
        except Exception as e:
            log.warning("[KEY] Load failed: %s  continuing with ROL + Query only", e)

        # Load SyntheticReview from its own SQLite
        try:
            synthetic_review_data = load_synthetic_review_from_sqlite()
            if synthetic_review_data:
                data['synthetic_review'] = synthetic_review_data
                log.info("[OK] SyntheticReview: %d rows, %d dates", len(synthetic_review_data['rows']), len(synthetic_review_data['dates']))
            else:
                log.warning("SyntheticReview: No data in SQLite (run synthetic_review_loader.py first)")
                data['synthetic_review'] = None
        except Exception as e:
            log.warning("SyntheticReview load failed: %s", e)
            data['synthetic_review'] = None

        # Load Escalation from SQLite
        try:
            escalation_data = load_escalation_from_sqlite()
            data['escalation'] = escalation_data
            log.info("[OK] Escalation: %d rows, %d dates", len(escalation_data['rows']), len(escalation_data['dates']))
        except Exception as e:
            log.warning("Escalation load failed: %s", e)
            data['escalation'] = None

        # Load Statement (Reconciliation History) from SQLite
        try:
            statement_data = load_statement_from_sqlite()
            if statement_data:
                data['statement'] = statement_data
                log.info("[OK] Statement: %d rows, %d dates", len(statement_data['rows']), len(statement_data['dates']))
            else:
                log.warning("Statement: No data (run statement_loader.py first)")
                data['statement'] = None
        except Exception as e:
            log.warning("Statement load failed: %s", e)
            data['statement'] = None

        # Load Storebook / Z & R from its own SQLite feed
        try:
            storebook_zr_data = load_storebook_zr_from_sqlite()
            data['storebook_zr'] = storebook_zr_data
            log.info(
                "[OK] Storebook/Z&R: %d rows, %d dates",
                len(storebook_zr_data.get('rows', [])),
                len(storebook_zr_data.get('dates', [])),
            )
        except Exception as e:
            log.warning("Storebook/Z&R load failed: %s", e)
            data['storebook_zr'] = None

        if JSON_MODE:
            log.info("[..] JSON MODE: Generating dashboard_data.js + HTML template...")

            # Always generate data JS (updated daily)
            js_content = generate_data_js(data, reuse_trend_cube=args.reuse_trend_cube, incremental_trend_cube=args.incremental_trend_cube)

            # Write to local directory
            local_data = JSON_LOCAL_DIR / "dashboard_data.js"
            local_html = JSON_LOCAL_DIR / "dashboard.html"
            atomic_write_text(local_data, js_content)

            # Generate HTML template only if it doesn't exist (or --force-html)
            if not local_html.exists() or args.force_html:
                log.info("  [..] Generating HTML template...")
                html_content = generate_html_template_json_mode(data)
                atomic_write_text(local_html, html_content)
                log.info("  [OK] HTML template: %s (%.1f KB)", local_html, local_html.stat().st_size / 1024)
            else:
                log.info("  [OK] HTML template already exists: %s", local_html)

            log.info("  [OK] Data JS: %s (%.1f KB)", local_data, local_data.stat().st_size / 1024)

            if args.local_only:
                log.info("  [PACK] Dashboard output is Local Fixture Store-synced folder only (--local-only)")
            else:
                # Copy all to the configured pack output folder if different.
                try:
                    JSON_SDRIVE_DIR.mkdir(parents=True, exist_ok=True)
                    changed = 0
                    skipped = 0
                    if copy_if_changed(local_data, JSON_SDRIVE_DIR / "dashboard_data.js"):
                        changed += 1
                    else:
                        skipped += 1
                    if local_html.exists():
                        if copy_if_changed(local_html, JSON_SDRIVE_DIR / "dashboard.html"):
                            changed += 1
                        else:
                            skipped += 1
                    log.info("  [OK] Pack dashboard sync: %d changed, %d unchanged (%s)", changed, skipped, JSON_SDRIVE_DIR)

                    # Copy chunk files (trend_cube.js + week_*.js) to the pack output folder.
                    chunks_src = DASHBOARD_DIR / "data"
                    if chunks_src.is_dir():
                        chunks_dst = JSON_SDRIVE_DIR / "data"
                        chunk_names = {f.name for f in chunks_src.glob("*.js")}
                        copied, pruned = sync_generated_js_dir(chunks_src, chunks_dst, chunk_names)
                        log.info("  [OK] Pack chunk sync: %d changed, %d stale pruned (%s)", copied, pruned, chunks_dst)
                except Exception as e:
                    log.warning("  Could not copy to pack output folder: %s", e)
                    log.warning("         Files available locally: %s", JSON_LOCAL_DIR)

                # Sync SQLite to the pack dashboard data folder.
                try:
                    s_data_dir = OUTPUT_DIR / "data"
                    s_data_dir.mkdir(parents=True, exist_ok=True)
                    output_sqlite = s_data_dir / "ledger_weekly.sqlite"
                    if SQLITE_PATH.exists():
                        copy_if_changed(SQLITE_PATH, output_sqlite)
                        sz = output_sqlite.stat().st_size / (1024 * 1024)
                        log.info("  [OK] SQLite -> %s (%.1f MB)", output_sqlite, sz)
                except Exception as e:
                    log.warning("  Could not copy SQLite to pack output folder: %s", e)

                # Helper mode is not part of the operator pack; keep this best-effort only.
                try:
                    s_helper_dir = OUTPUT_DIR / "helper"
                    s_helper_dir.mkdir(parents=True, exist_ok=True)
                    local_helper_dir = DASHBOARD_DIR / "build" / "helper"
                    for fname in ("rol_helper.exe", "rol_helper_config.json"):
                        src = local_helper_dir / fname
                        if src.exists():
                            copy_if_changed(src, s_helper_dir / fname)
                    log.info("  [OK] Helper -> %s", s_helper_dir)
                except Exception as e:
                    log.warning("  Could not copy helper to pack output folder: %s", e)

            log.info("[SUCCESS] JSON MODE dashboard updated!")
            log.info("  Local:   %s", JSON_LOCAL_DIR)
            log.info("  Pack:    %s", JSON_SDRIVE_DIR)
            log.info("  Files:")
            log.info("    dashboard.html + dashboard_data.js  (2-file, for synced folders)")

        elif HELPER_MODE:
            log.info("[..] HELPER MODE: Generating lightweight dashboard + cube JSON...")

            # Ensure output directories exist
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            (OUTPUT_DIR / "data").mkdir(exist_ok=True)
            (OUTPUT_DIR / "helper").mkdir(exist_ok=True)
            (OUTPUT_DIR / "logs").mkdir(exist_ok=True)

            html_content = generate_html_dashboard_helper_mode(data)
            atomic_write_text(OUTPUT_DASHBOARD, html_content)

            log.info("[SUCCESS] Helper-mode dashboard generated!")
            log.info("Dashboard: %s", OUTPUT_DASHBOARD)
            log.info("Size: %.1f KB", OUTPUT_DASHBOARD.stat().st_size / 1024)
            log.info("Cube: %s", OUTPUT_CUBE_LEDGER)
            log.info(" Architecture:")
            log.info("   Helper: http://127.0.0.1/", HELPER_BIND, HELPER_PORT)
            log.info("   Dashboard fetches data from helper on demand")
            log.info("   Cube served via /cube?ds=ledger endpoint")
            log.info("   CSV export via /export.csv?ds=ledger (streaming)")
            log.info(" Next steps:")
            log.info("   1. Build rol_helper.exe (go build in helper/ folder)")
            log.info("   2. Helper mode is not used by this Local Fixture Store operator pack")
            log.info("   3. Use JSON mode dashboard.html from the synced folder")
        else:
            log.info("[..] Generating V19 COMPLETE FIX HTML dashboard (embedded mode)...")
            OUTPUT_HTML = get_output_html_path()
            html_content = generate_html_dashboard(data)
            atomic_write_text(OUTPUT_HTML, html_content)
            log.info("[SUCCESS] V19 Dashboard generated!")
            log.info("Dashboard: %s", OUTPUT_HTML)
            log.info("Size: %.1f KB", OUTPUT_HTML.stat().st_size / 1024)

        log.info("=" * 70)
    except Exception as e:
        log.error("[ERROR] %s", e)
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    exit(main())
