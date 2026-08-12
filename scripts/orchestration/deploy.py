#!/usr/bin/env python3
"""Blocked deploy entrypoint for the Local Fixture Store operations pack.

This pack is intentionally Local Fixture Store/Local Fixture Store-sync only. Operators refresh the
local static dashboard with automation/RUN_FULL.bat or automation/RUN_DAILY.bat.
Production publishing to external drives is not part of this pack.
"""

from __future__ import annotations

import sys


def main() -> int:
    print("[FAIL] Deploy is disabled in Dashboard_Ledger_Local Fixture Store_Pack.")
    print("[INFO] Use automation\\RUN_PREFLIGHT.bat before a run.")
    print("[INFO] Use automation\\RUN_FULL.bat for weekly refresh.")
    print("[INFO] Use automation\\RUN_DAILY.bat for daily refresh.")
    print("[INFO] Use automation\\RUN_OPEN_DASHBOARD.bat to view the result.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
