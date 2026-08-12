# Scripts

**Purpose:** Python source code for the Local Fixture Store Dashboard Ledger pack.

## Organization

- `loaders\` - Load Excel/CSV/SyntheticReview data into SQLite.
- `reports\` - Build Key, Ledger, and master data reports.
- `dashboard\` - Generate the static dashboard in `dashboard\`.
- `downloaders\` - Download external source files such as SyntheticReview.
- `utils\` - Shared path, logging, notification, and helper modules.
- `validation\` - Data quality checks.
- `orchestration\` - Pipeline orchestration and analysis tools.
- `tools\` - Pack preflight and operational helpers.

## Operator Commands

Run the BAT files in `automation\` from the Local Fixture Store-synced folder:

```bat
automation\RUN_FULL.bat
automation\RUN_DAILY.bat
automation\RUN_OPEN_DASHBOARD.bat
```

`scripts\orchestration\deploy.py` is intentionally blocked in this pack.

## Module Syntax

Run Python scripts as modules from the pack root:

```bash
python -m scripts.dashboard.Rol_Query --local-only
python -m scripts.validation.validate_data
```
