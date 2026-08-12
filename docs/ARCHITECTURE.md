# Architecture and validation map

This document gives a visual map of the public Ledger Dashboard pack. It is documentation only: the UI, ETL, transactional staging, SQL, SQLite handoffs, query subpack and tests are unchanged.

For the cross-repository view, see the [portfolio architecture map](https://github.com/brunotaisa01-source/escalation-app-portfolio/blob/main/docs/PORTFOLIO_MAP.md).

## Runtime flow

```mermaid
flowchart LR
  I["Synthetic weekly fixtures and workbooks\ndata/ + local inputs"] --> V["Fail-closed preflight\nscripts/tools/preflight_pack.py"]
  V --> T["Transactional staging and normalization\nscripts/ + lib/"]
  T --> C["Integrity and schema checks\nsql/ + tests/"]
  C --> DB["Five SQLite handoffs\ndb/ and runtime/"]
  DB --> Q["Queries, reports and generated data\nlib/ + dashboard/dashboard_data.js"]
  Q --> UI["Ledger browser UI\ndashboard/dashboard.html"]
  S["Synthetic Queries subpack\ndata/Synthetic Queries/"] --> UI
  A["Automation entrypoints\nautomation/"] --> V
  C --> H["Atomic promotion and local handoff"]
```

Validation is fail-closed: empty input, schema or SQL errors stop the pipeline before database promotion. The browser receives generated local data and does not call a tenant.

## Test and status flow

```mermaid
flowchart LR
  A["bootstrap_local.py --check"] --> M["Local validation evidence"]
  B["pytest tests"] --> M
  C["npm test + npm run typecheck"] --> M
  D["synthetic_e2e.py and browser smoke"] --> M
  M --> G["GREEN_LOCAL\nfixture-to-browser evidence"]
  X["External SharePoint/tenant execution, live refresh and remote readback\nnot exercised"] --> R["RED_EXTERNAL_GATE"]
```

`GREEN_LOCAL` describes the local commands and fixture scope recorded in the pack. `RED_EXTERNAL_GATE` remains for remote credentials, permissions, scheduling, live refresh, tenant mutation and remote readback. Local evidence must not be promoted to production evidence.

## Main entrypoints

- `python scripts\tools\bootstrap_local.py --check` validates local inputs.
- `python -m pytest -q tests` runs the Python suite.
- `npm run typecheck` and `npm test` check the typed/browser contracts.
- `python scripts\synthetic_e2e.py` runs the local data-to-browser path.
- `manifest.json` and `runtime/manifests/e2e_latest.json` record local evidence.
