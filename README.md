# Ledger Dashboard

This is a complete local portfolio pack for a generic ledger and exception dashboard. Frontend, ETL, queries, automation, TypeScript contracts, data-query subpack and tests are preserved; operational exports are replaced with deterministic fixtures.

For the portfolio overview, contribution scope and AI-assisted engineering context, see [PORTFOLIO_CONTEXT.md](PORTFOLIO_CONTEXT.md).

For the visual architecture and validation gates, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What this project delivers

This is a ledger and exception-management data product built around safe promotion of validated data. It combines a browser UI, Python loaders and reports, SQL schemas, transactional staging, five SQLite handoffs, typed browser contracts and a synthetic query subpack.

- Ledger filters, queries, reports, generated browser data and operator-facing exception views.
- Fail-closed preflight and transactional staging that preserve the previous database when validation fails.
- Weekly loaders, normalization, SQL integrity checks, atomic promotion and explicit non-empty/date/owner/category contracts.
- Python, Node, typecheck, synthetic E2E, browser and command-behavior validation paths.

## Problem it solves

It addresses two related problems: exception visibility and unsafe data refreshes. The product makes ledger issues easier to investigate while preventing empty, malformed or partially validated inputs from replacing a known-good handoff, giving downstream reporting a clearer integrity boundary.

## Quick start

Exact validated dependency set: Python 3.11.9; `pandas==2.2.3`, `numpy==2.4.6`, `openpyxl==3.1.5`, `pyarrow==25.0.0`, `playwright==1.58.0`, `python-dotenv==1.2.1`, `pytest==9.0.2`, and `pytest-cov==7.0.0`. Optional syntax tool: Node.js 24.18.0. Install only from the manifest:

```powershell
python -m pip install -r requirements.txt
python scripts\synthetic_e2e.py
python -m unittest tests\test_synthetic_contract.py
python -m http.server 8762
```

Open `dashboard/dashboard.html`. The latest evidence is written to `manifest.json` and `runtime/manifests/e2e_latest.json`. See [PROJECT.md](PROJECT.md) for the full repository description and operating contract.
