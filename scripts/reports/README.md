# Reports

**Purpose:** Excel report builders that generate weekly/monthly reports from SQLite databases.

## Files

### Key Team Reports
Key team owner tabs and Summary rows come from `data/master/Owner_map.csv`
through `load_key_team_owners()`.

- `build_key_report.py`  Generate Key Team Excel report with aging analysis, KPIs, owner breakdown

### Ledger Team Reports
- `build_ledger_report.py`  Generate Ledger (ROL + Query) Excel report with team-specific worksheets

### Master Data Reports
- `build_masterdata_weekly.py`  Generate weekly master data consolidation (MasterData_WWYY.csv)
- `build_masterdata_monthly.py`  Generate monthly master data rollup

## Usage

```bash
# Build Key report
python -m scripts.reports.build_key_report

# Build Ledger report
python -m scripts.reports.build_ledger_report

# Build master data (weekly)
python -m scripts.reports.build_masterdata_weekly

# Build master data (monthly)
python -m scripts.reports.build_masterdata_monthly
```

## Dependencies

Imports from:
- `../utils/` (paths, masterdata_core, report_utils)

## Output Files

- `data/key/Key DD.MM.xlsx`  Key Team Excel report
- `data/ledger/Ledger DD.MM.xlsx`  Ledger Excel report
- `data/master/MasterData_WWYY.csv`  Weekly master data
