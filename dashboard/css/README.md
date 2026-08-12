# Dashboard CSS

**Purpose:** Modular CSS stylesheets for dashboard UI. Loaded by dashboard_html.py in order.

## CSS Modules (Load Order)

1. `01_base.css`  CSS variables, base styles, typography, layout primitives
2. `02_sidebar.css`  Navigation sidebar, tabs, filters, search
3. `03_components.css`  KPI cards, tables, buttons, inputs, badges
4. `04_responsive.css`  Media queries, mobile breakpoints
5. `05_loading.css`  Loading spinner, skeleton screens
6. `06_dark-theme.css`  Dark mode overrides ([data-theme="dark"])

## Standards

- No `!important` (use specificity via parent selectors)
- No duplicate selectors (scope with parent context)
- Dark theme via `[data-theme="dark"]` attribute selector
- Colors via CSS custom properties (variables), not hardcoded hex

## Usage

CSS modules loaded automatically by `dashboard_html.py` via `_load_css()` helper. Manual inspection:

```bash
cat dashboard/css/01_base.css
```
