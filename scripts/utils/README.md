# Utils

**Purpose:** Shared utility modules used across loaders, reports, dashboard, and orchestration.

## Files

### Core Infrastructure
- `paths.py`  Path configuration (ROOT-relative, portable paths for all folders)
- `log.py`  Centralized logging module (`get_logger()` factory)

### Notifications & Health
- `notify.py`  Email notifications via Outlook COM (PowerShell subprocess, non-blocking)
- `health_check.py`  Health status check, generates `dashboard/status.json` with badge

### Data Processing
- `masterdata_core.py`  Master data processing (load CSVs, Vendor Matrix, Owner maps)
- `synthetic_review_helpers.py`  SyntheticReview enrichment helpers (country resolution, owner mapping)
- `sql_loader.py`  SQLite helper functions (CREATE TABLE, INSERT, indexes)

### Report Utilities
- `report_utils.py`  Excel utilities (formatting, headers, formulas)

## Usage

All modules are imported by other scripts. Not meant to be run directly.

```python
# Example imports
from scripts.utils.paths import ROOT, DB_DIR
from scripts.utils.log import get_logger
from scripts.utils.masterdata_core import load_masterdata
```

## Dependencies

Minimal external imports (pandas, openpyxl, pathlib). No cross-dependencies within utils/.
