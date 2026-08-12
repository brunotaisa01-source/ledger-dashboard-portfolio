# Dashboard Generation

**Purpose:** Generate the static Dashboard Ledger front end inside this
Local Fixture Store pack.

## Files

- `Rol_Query.py` - Dashboard orchestrator for local/static output.
- `dashboard_config.py` - Dashboard configuration and pack-safe output paths.
- `dashboard_data.py` - SQLite merge, trend cube, compression, and JS payloads.
- `dashboard_html.py` - HTML generation.
- `dashboard_server.py` - Optional local helper server management.

## Usage

```bash
python -m scripts.dashboard.Rol_Query --local-only
python -m scripts.dashboard.Rol_Query --force-html --local-only
```

Operators should normally use `automation\RUN_FULL.bat`,
`automation\RUN_DAILY.bat`, and `automation\RUN_OPEN_DASHBOARD.bat`.
