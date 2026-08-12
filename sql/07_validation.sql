-- Concrete, standalone validation queries for the two delivered tables.
-- Identifiers are fixed here; only values are parameterized.

-- @total_docs_per_owner_ledger_lines
SELECT "Owner", COUNT(*) AS doc_count
FROM "ledger_lines"
WHERE "SnapshotDateISO" = :snap
  AND "RowLevel" = 'Detail'
  AND COALESCE("Amount in doc. curr.", 0) != 0
GROUP BY "Owner";

-- @total_docs_per_owner_key_lines
SELECT "Owner", COUNT(*) AS doc_count
FROM "key_lines"
WHERE "SnapshotDateISO" = :snap
  AND "RowLevel" = 'Detail'
  AND COALESCE("Amount in doc. curr.", 0) != 0
GROUP BY "Owner";

-- @total_suppliers_per_owner_ledger_lines
SELECT "Owner", COUNT(DISTINCT "Unique Ref") AS supplier_count
FROM "ledger_lines"
WHERE "SnapshotDateISO" = :snap
  AND "RowLevel" = 'Detail'
  AND COALESCE("Amount in doc. curr.", 0) != 0
  AND TRIM(COALESCE("Unique Ref", '')) != ''
GROUP BY "Owner";

-- @total_suppliers_per_owner_key_lines
SELECT "Owner", COUNT(DISTINCT "Unique Ref") AS supplier_count
FROM "key_lines"
WHERE "SnapshotDateISO" = :snap
  AND "RowLevel" = 'Detail'
  AND COALESCE("Amount in doc. curr.", 0) != 0
  AND TRIM(COALESCE("Unique Ref", '')) != ''
GROUP BY "Owner";

-- @ledger_aged_180_docs
SELECT "Owner", COUNT(*) AS doc_count
FROM "ledger_lines"
WHERE "SnapshotDateISO" = :snap
  AND "RowLevel" = 'Detail'
  AND COALESCE("Amount in doc. curr.", 0) != 0
  AND COALESCE("180> Days Overdue", 0) != 0
GROUP BY "Owner";

-- @key_aged_180_docs
SELECT "Owner", COUNT(*) AS doc_count
FROM "key_lines"
WHERE "SnapshotDateISO" = :snap
  AND "RowLevel" = 'Detail'
  AND COALESCE("Amount in doc. curr.", 0) != 0
  AND COALESCE("180> Days Overdue", 0) != 0
GROUP BY "Owner";

-- @weekly_summary_refresh
DROP TABLE IF EXISTS weekly_summary;
CREATE TABLE weekly_summary AS
SELECT
    "WeekStartISO", "Owner", "Sheet",
    COUNT(*) AS docs,
    COUNT(DISTINCT "Unique Ref") AS suppliers,
    ROUND(SUM("Amount in doc. curr."), 2) AS total_amount,
    ROUND(SUM("TOTAL VALUE"), 2) AS total_value,
    ROUND(SUM("0-30 Days overdue"), 2) AS aged_0_30,
    ROUND(SUM("31-60 Days overdue"), 2) AS aged_31_60,
    ROUND(SUM("61-90 Days overdue"), 2) AS aged_61_90,
    ROUND(SUM("91-120 Days Overdue"), 2) AS aged_91_120,
    ROUND(SUM("121-180 Days Overdue"), 2) AS aged_121_180,
    ROUND(SUM("180> Days Overdue"), 2) AS aged_180_plus
FROM "ledger_lines"
WHERE "RowLevel" = 'Detail'
GROUP BY "WeekStartISO", "Owner", "Sheet";
CREATE INDEX IF NOT EXISTS idx_weekly_summary_week
ON weekly_summary("WeekStartISO");
