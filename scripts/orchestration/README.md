# Orchestration

**Purpose:** Pipeline orchestrators and analysis tools for the Local Fixture Store pack.

## Files

- `run_weekly.py` - Weekly pipeline: pre-flight tests, master data, reports,
  loaders, dashboard, and validation.
- `deploy.py` - Intentionally blocked in this pack. Use the BAT files in
  `automation\` instead.
- `analyze_dependencies.py` - Dependency analysis.
- `check_imports.py` - Import validation.

## Usage

```bash
python -m scripts.orchestration.run_weekly
python -m scripts.orchestration.analyze_dependencies
python -m scripts.orchestration.check_imports
```

Do not run deploy/publish commands from this Local Fixture Store pack. The shared output
is the synced `dashboard\` folder.
