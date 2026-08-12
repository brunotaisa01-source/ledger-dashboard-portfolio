"""Regression tests for Ledger tail dates and generic day-first date formats."""

import pandas as pd

from scripts.utils import report_utils


def test_recover_date_from_tail_preserves_out_of_bounds_date_without_breaking_flow():
    assert report_utils.recover_date_from_tail("30/07/0026") == "30/07/0026"
    assert report_utils.recover_date_from_tail("0026-07-30") == "0026-07-30"


def test_out_of_bounds_date_does_not_poison_valid_day_first_dates():
    result = report_utils.parse_mixed_date_series(
        pd.Series(["30/07/0026", "31/07/2026", "2026-08-01"])
    )

    assert pd.isna(result.iloc[0])
    assert result.iloc[1] == pd.Timestamp("2026-07-31")
    assert result.iloc[2] == pd.Timestamp("2026-08-01")
