# -*- coding: utf-8 -*-
"""
Orchestrator  runs the full weekly/monthly pipeline in the correct order.

Usage:
    python -m scripts.orchestration.run_weekly weekly
    python -m scripts.orchestration.run_weekly monthly
    python -m scripts.orchestration.run_weekly --dry-run weekly
"""
import subprocess
import sys
import time
import argparse
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parents[1]


def run_preflight_tests(dry_run: bool) -> bool:
    """Run pytest as a pre-flight check. Returns True if all tests pass."""
    print()
    print("=" * 60)
    print("  PRE-FLIGHT: Running tests...")
    print("=" * 60)
    if dry_run:
        print("  (dry-run  skipped)")
        return True

    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "-q", "--tb=short"],
        cwd=PROJECT_ROOT,
    )
    if result.returncode != 0:
        print()
        print("!" * 60)
        print("  PRE-FLIGHT FAILED  Tests did not pass.")
        print("  Fix the failing tests before running the pipeline.")
        print("!" * 60)
        return False
    print("  All tests passed.")
    return True


#  Step definitions 
# Each step: (label, module_name, extra_args_or_None)
# None means the args are determined at runtime (e.g. ETL mode prompt)

MASTERDATA_WEEKLY = ("Build MasterData (weekly)", "scripts.reports.build_masterdata_weekly", [])
MASTERDATA_MONTHLY = ("Build MasterData (monthly)", "scripts.reports.build_masterdata_monthly", [])
BUILD_KEY = ("Build Key Report", "scripts.reports.build_key_report", [])
BUILD_LEDGER = ("Build Ledger Report", "scripts.reports.build_ledger_report", [])
ETL_STEP = ("Load SQLite (ETL)", "scripts.loaders.load_ledger_weekly_to_sqlite_clean_split", None)
DASHBOARD = ("Generate Dashboard", "scripts.dashboard.Rol_Query", ["--local-only"])
VALIDATE = ("Validate Data", "scripts.validation.validate_data", ["--weeks", "1"])

# Stage validation checkpoints (read-only  fail-fast)
VALIDATE_MASTERDATA  = ("Validate MasterData",  "scripts.validation.validate_data", ["--stage", "masterdata"])
VALIDATE_LEDGER_LOAD = ("Validate SQLite Load",  "scripts.validation.validate_data", ["--stage", "ledger-load"])
VALIDATE_KEY_BUILD   = ("Validate Key Build",    "scripts.validation.validate_data", ["--stage", "key-build"])
VALIDATE_DASHBOARD   = ("Validate Dashboard",    "scripts.validation.validate_data", ["--stage", "dashboard"])
VALIDATE_CROSS       = ("Validate Cross-Stage",  "scripts.validation.validate_data", ["--stage", "cross"])


def ask_etl_mode() -> list:
    """Prompt the user for ETL mode."""
    print()
    print("=" * 50)
    print("  ETL Mode Selection")
    print("=" * 50)
    print("  [1] --latest   (only newest week, fast)")
    print("  [2] --rebuild  (full rebuild)")
    print("  [3] --weeks N  (partial rebuild, last N weeks)")
    print("=" * 50)
    while True:
        choice = input("  Choose [1/2/3]: ").strip()
        if choice == "1":
            return ["--latest"]
        if choice == "2":
            return ["--rebuild"]
        if choice == "3":
            n = input("  How many weeks? ").strip()
            if n.isdigit() and int(n) > 0:
                return ["--weeks", n]
            print("  Invalid number, try again.")
        else:
            print("  Invalid choice, try again.")


def run_step(index: int, total: int, label: str, module: str, args: list,
             dry_run: bool) -> bool:
    """Run a single pipeline step. Returns True on success."""
    banner = f"[{index}/{total}] {label}"
    print()
    print("=" * 60)
    print(f"  {banner}")
    print(f"  Module: {module} {' '.join(args)}")
    print("=" * 60)

    if dry_run:
        print("  (dry-run  skipped)")
        return True

    t0 = time.time()
    result = subprocess.run(
        [sys.executable, "-m", module] + args,
        cwd=PROJECT_ROOT,
    )
    elapsed = time.time() - t0

    if result.returncode != 0:
        print(f"  FAILED (exit code {result.returncode}) after {elapsed:.1f}s")
        return False

    print(f"  OK ({elapsed:.1f}s)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Synthetic Services AP Ledger  Pipeline Orchestrator")
    parser.add_argument("mode", choices=["weekly", "monthly"],
                        help="weekly = MasterData weekly; monthly = MasterData monthly")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show steps without executing")
    parser.add_argument("--skip-validate", action="store_true",
                        help="Skip the final validation step (Excel vs SQLite)")
    parser.add_argument("--skip-stage-validation", action="store_true",
                        help="Skip stage validation checkpoints")
    parser.add_argument("--skip-tests", action="store_true",
                        help="Skip the pre-flight pytest check")
    args = parser.parse_args()

    # Pre-flight tests
    if not args.skip_tests:
        if not run_preflight_tests(args.dry_run):
            sys.exit(1)

    # Build step list
    if args.mode == "weekly":
        md_step = MASTERDATA_WEEKLY
    else:
        md_step = MASTERDATA_MONTHLY

    if args.skip_stage_validation:
        # Original pipeline (no stage checkpoints)
        steps = [md_step, BUILD_KEY, BUILD_LEDGER, ETL_STEP, DASHBOARD]
    else:
        # Pipeline with stage validation checkpoints (fail-fast)
        steps = [
            md_step,                    # 1. Build MasterData
            VALIDATE_MASTERDATA,        # checkpoint
            BUILD_KEY,                  # 2. Build Key Report
            BUILD_LEDGER,               # 3. Build Ledger Report
            ETL_STEP,                   # 4. Load SQLite
            VALIDATE_LEDGER_LOAD,       # checkpoint
            VALIDATE_KEY_BUILD,         # checkpoint
            DASHBOARD,                  # 5. Generate Dashboard
            VALIDATE_DASHBOARD,         # checkpoint
            VALIDATE_CROSS,             # checkpoint final
        ]
    if not args.skip_validate:
        steps.append(VALIDATE)

    total = len(steps)
    print()
    print("=" * 60)
    print(f"  Synthetic GROUP AP LEDGER  {args.mode.upper()} PIPELINE")
    print(f"  Steps: {total}  |  Dry-run: {args.dry_run}")
    print("=" * 60)

    results = []
    t_start = time.time()

    for i, (label, script, step_args) in enumerate(steps, 1):
        # ETL step: ask for mode interactively
        if step_args is None:
            if args.dry_run:
                step_args = ["(will ask: --latest / --rebuild / --weeks N)"]
            else:
                step_args = ask_etl_mode()

        ok = run_step(i, total, label, script, step_args, args.dry_run)
        results.append((label, ok))

        if not ok:
            print()
            print("!" * 60)
            print(f"  PIPELINE STOPPED  Step {i} failed: {label}")
            print(f"  Fix the issue and re-run.")
            print("!" * 60)
            sys.exit(1)

    t_total = time.time() - t_start

    # Summary
    print()
    print("=" * 60)
    print(f"  PIPELINE COMPLETE  {args.mode.upper()}")
    print(f"  Total time: {t_total:.1f}s ({t_total/60:.1f} min)")
    print("-" * 60)
    for label, ok in results:
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {label}")
    print("=" * 60)


if __name__ == "__main__":
    main()
