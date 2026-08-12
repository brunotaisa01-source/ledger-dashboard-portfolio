# Project: Ledger Dashboard

Status: local synthetic gates are validated locally; external SharePoint and tenant execution remain RED. This pack is not production-connected and is not release authorization.

## Purpose

This pack preserves the Ledger UI, Python backend, ETL and loaders, SQL schemas, SQLite handoffs, typed browser layer and tests. Repair changes are limited to synthetic identity and data, generic labels, relative or configurable paths, transactional staging, fail-closed validation and derivatives required by those substitutions.

## Public validation contract

Everything required for local validation is shipped in this pack. `scripts/synthetic_contract.json` defines required paths and browser-facing data, `scripts/tools/preflight_pack.py` validates local inputs, and `runtime/manifests/e2e_latest.json` records the latest synthetic pipeline result. No private source tree, historical photograph or external evidence directory is required.

| Component | Representation in this pack | Local validation |
| --- | --- | --- |
| UI | Ledger HTML, CSS, JavaScript and TypeScript declarations | Browser smoke and typecheck validate the shipped frontend |
| Backend | `lib` and `scripts` loaders, reports and validation | Python tests exercise adapters and fail-closed command behavior |
| ETL | weekly loaders, staging and dashboard generation | Synthetic end-to-end run proves nonempty fixture transformation |
| Schema | `sql` plus five SQLite handoffs | Bootstrap and tests check integrity and transactional promotion |
| Contracts | dependency manifests, type declarations and synthetic contracts | Preflight checks required files and nonempty fixture shapes |
| Tests | Python tests, Node tests, typecheck and browser smoke | Commands below execute from the pack root |

## Architecture and flow

- Frontend: `dashboard/dashboard.html`, local styles and scripts, `dashboard/dashboard_data.js` and TypeScript declarations.
- Backend: `lib` and `scripts` retain source loading, reports, query preparation, validation and packaging.
- ETL: weekly fixtures and workbooks are validated, staged transactionally, normalized and promoted only after integrity checks.
- Schema and handoff: SQL and five SQLite databases preserve query and report contracts.
- Query subpack: `data/Synthetic Queries` contains a local synthetic browser fixture with no live binding.
- Tests: Python and Node contracts cover local data, command and browser behavior.

The local data path is fixture read -> input and schema validation -> temporary database -> integrity checks -> atomic promotion -> generated Ledger data -> browser filters. Empty input, schema or SQL fails nonzero. Bootstrap validates nonempty date, owner and category contracts; a zero-check summary cannot report success.

## Setup and commands

Install dependencies only outside this pack. Python 3.11 and Node.js are used locally:

```powershell
python -m pip install -r requirements.txt
python scripts\tools\bootstrap_local.py --check
python -m pytest -q tests
npm run typecheck
npm test
python scripts\synthetic_e2e.py
```

Loader staging is transactional, so failed validation leaves the prior database unchanged. For a manual browser run, serve the pack over loopback and open `dashboard/dashboard.html`.

## Synthetic fixtures and preservation boundary

Workbooks, source files, generated assets and databases use generic owners, systems, company codes, categories and identifiers. UI and backend boundaries, ETL order, schemas, types, cardinality and test intent remain intact.

Remote credentials, tenant permissions, live refresh, production scheduling and remote readback remain explicit external REDs.

