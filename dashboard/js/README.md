# Dashboard JavaScript

**Purpose:** Modular JavaScript for dashboard interactivity. 16 modules loaded in order by dashboard_html.py.

## JS Modules (Load Order)

### Core Utilities (01-05)
1. `01_helpers.js`  Utility functions (dbg, fmtNum, deltaHtml, sparklineSVG, getWeekData, trend cube)
2. `02_filters.js`  Global filter state and logic (week, team, supplier, bucket, category, etc.)
3. `03_kpi.js`  KPI computation (overdue rate, aging by owner, OTP%, query type breakdown)
4. `04_charts.js`  Chart.js configuration and rendering (aging, trend, movement, productivity)
5. `05_pagination.js`  Table pagination, sorting, search, CSV export

### Page Modules (06-12)
6. `06_overview.js`  Overview tab (KPIs, supplier table, movement, trend)
7. `07_key.js`  Key Team tab (full aging spectrum, 6 buckets, critical suppliers)
8. `08_rol.js`  ROL Dashboard tab (0-90 aging, critical suppliers)
9. `09_query.js`  Query Dashboard tab (>90 recovery team, critical suppliers)
10. `10_movement.js`  Movement tracking (new/cleared/modified suppliers)
11. `11_productivity.js`  Owner performance, work logs, burn-down
12. `12_overdue.js`  Dual-week comparison, aging exposure by owner

### Data Sources (13-14)
13. `13_synthetic_review.js`  SyntheticReview tab (invoice errors, duplicates, date range filters)
14. `14_statement.js`  Statement tab (reconciliation history, KPIs, status/country/owner charts)

### UI & Init (15-16)
15. `15_ui.js`  UI helpers (sidebar toggle, theme toggle, reset filters, health badge)
16. `16_init.js`  Initialization (load data, wire events, render initial state)

## Standards

- All async functions have try/catch
- Input handlers debounced (300ms)
- console.log guarded with `if (DEBUG)`
- Chart keys prefixed with page name (avoid collisions)

## Usage

JS modules loaded automatically by `dashboard_html.py` via `_load_js()` helper. Manual inspection:

```bash
cat dashboard/js/01_helpers.js
```
