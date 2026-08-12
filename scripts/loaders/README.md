# Loaders

**Purpose:** ETL scripts that load data from Excel/CSV/SyntheticReview into SQLite databases.

## Files

### Ledger + Key Loader
Key workbook tabs are accepted from the owners in `data/master/Owner_map.csv`
via `load_key_team_owners()`, so new Key owners do not require loader code
changes.

- `load_ledger_weekly_to_sqlite_clean_split.py`  ETL pipeline: Excel snapshots (Key DD.MM + Ledger DD.MM)  SQLite (ledger_weekly.sqlite + key_weekly.sqlite)

### SyntheticReview Loader
- `synthetic_review_loader.py`  SyntheticReview data loader: scans `data/SyntheticReview/`, detects file types, enriches with owner/country, stores in synthetic_review_daily.sqlite

### Statement Loader
- `statement_loader.py`  Reconciliation history loader: parses statement CSV, enriches with MasterData  Vendor Matrix  3-tier fallback, stores in synthetic_review_daily.sqlite

## Usage

```bash
# Load Ledger + Key snapshots
python -m scripts.loaders.load_ledger_weekly_to_sqlite_clean_split

# Load SyntheticReview data (after download)
python -m scripts.loaders.synthetic_review_loader

# Load Statement reconciliation history
python -m scripts.loaders.statement_loader
```

## Dependencies

Imports from:
- `../utils/` (paths, dashboard_config, sql_loader, synthetic_review_helpers, masterdata_core)

## Output Databases

- `db/ledger_weekly.sqlite`  Ledger lines (ROL + Query teams)
- `db/key_weekly.sqlite`  Key lines (Key team, 07-30 unified aging)
- `db/synthetic_review_daily.sqlite`  SyntheticReview lines + statement lines + summaries
