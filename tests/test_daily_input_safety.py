"""Regression tests for daily input safety and required-step fail-fast behavior."""

from pathlib import Path

from scripts.tools import preflight_pack


PACK_ROOT = Path(__file__).resolve().parents[1]


def test_preflight_reports_permission_denied_workbook(tmp_path: Path):
    workbook = tmp_path / "Ledger 03.08.xlsx"
    workbook.write_bytes(b"placeholder")
    run = preflight_pack.CheckRun()

    def deny_open(*_args, **_kwargs):
        raise PermissionError(13, "Permission denied", str(workbook))

    preflight_pack._check_file_readable(run, workbook, opener=deny_open)

    assert len(run.failures) == 1
    assert "Input workbook not readable" in run.failures[0]
    assert "CLOSE EXCEL BEFORE STARTING" in run.failures[0]


def test_preflight_does_not_block_readable_cloud_placeholder(tmp_path: Path, monkeypatch):
    workbook = tmp_path / "SyntheticReview.xlsx"
    workbook.write_bytes(b"placeholder")
    run = preflight_pack.CheckRun()
    monkeypatch.setattr(preflight_pack, "_is_cloud_placeholder", lambda _: True)

    preflight_pack._check_file_readable(run, workbook)

    assert not run.failures
    assert len(run.warnings) == 1
    assert "readable after cloud hydration" in run.warnings[0]


def test_preflight_includes_synthetic_review_workbooks_in_readability_guard():
    assert "data/SyntheticReview" in preflight_pack.READABLE_WORKBOOK_DIRS


def test_daily_stops_before_downstream_steps_after_ledger_loader_failure():
    daily = (PACK_ROOT / "automation" / "RUN_DAILY.bat").read_text(encoding="utf-8")
    ledger_call = 'call "%~dp0..\\lib\\run_python_step.bat" "%LOGFILE%" "Ledger/Key loader latest"'
    review_call = 'call "%~dp0..\\lib\\run_python_step.bat" "%LOGFILE%" "SyntheticReview loader"'

    ledger_block = daily[daily.index(ledger_call) : daily.index(review_call)]

    assert "goto fail_required" in ledger_block
    assert ":fail_required" in daily
    assert "Stopping before downstream steps and DB push." in daily
