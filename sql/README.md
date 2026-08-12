# SQL

**Purpose:** SQL schemas, indexes, and views for SyntheticReview and Statement databases.

## SyntheticReview Schema

- `10_synthetic_review_schema.sql`  SyntheticReview tables (synthetic_review_lines, synthetic_review_daily_summary)
- `11_synthetic_review_indexes.sql`  Performance indexes for SyntheticReview queries
- `12_synthetic_review_views.sql`  Views (latest snapshot, high risk invoices, owner summary)

## Statement Schema

- `20_statement_schema.sql`  Statement tables (statement_lines, statement_summary)
- `21_statement_indexes.sql`  Performance indexes for Statement queries

## Usage

Schemas are applied automatically by loader scripts (`synthetic_review_loader.py`, `statement_loader.py`). Manual execution:

```bash
sqlite3 db/synthetic_review_daily.sqlite < sql/10_synthetic_review_schema.sql
sqlite3 db/synthetic_review_daily.sqlite < sql/11_synthetic_review_indexes.sql
```
