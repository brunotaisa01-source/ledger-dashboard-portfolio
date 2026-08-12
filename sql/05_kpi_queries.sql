-- ============================================================
-- LEDGER DASHBOARD - KPI & ANALYTICS QUERIES
-- ============================================================
-- Ready-to-use queries for analysis and reporting.
-- Run these directly against ledger_weekly.sqlite.
-- ============================================================


-- 
-- KPI 1: OVERVIEW PER OWNER (latest week)
-- 
SELECT
    Owner,
    Sheet,
    COUNT(DISTINCT "Unique Ref")           AS suppliers,
    COUNT(*)                               AS docs,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value,
    ROUND(SUM("180> Days Overdue"), 2)     AS overdue_180_plus,
    ROUND(SUM("121-180 Days Overdue"), 2)  AS overdue_121_180,
    ROUND(SUM("91-120 Days Overdue"), 2)   AS overdue_91_120
FROM latest_week_ledger_detail
GROUP BY Owner, Sheet
ORDER BY total_value DESC;


-- 
-- KPI 2: AGING MIX (latest week, by sheet)
-- 
SELECT
    Sheet,
    ROUND(SUM("0-30 Days overdue"), 2)     AS "0-30",
    ROUND(SUM("31-60 Days overdue"), 2)    AS "31-60",
    ROUND(SUM("61-90 Days overdue"), 2)    AS "61-90",
    ROUND(SUM("91-120 Days Overdue"), 2)   AS "91-120",
    ROUND(SUM("121-180 Days Overdue"), 2)  AS "121-180",
    ROUND(SUM("180> Days Overdue"), 2)     AS "180+"
FROM latest_week_ledger_detail
GROUP BY Sheet;


-- 
-- KPI 3: WEEKLY TREND (suppliers + value over time)
-- 
SELECT
    WeekStartISO,
    Sheet,
    COUNT(DISTINCT "Unique Ref")           AS suppliers,
    COUNT(*)                               AS docs,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value
FROM ledger_lines
WHERE RowLevel = 'Detail'
GROUP BY WeekStartISO, Sheet
ORDER BY WeekStartISO;


-- 
-- KPI 4: TOP 10 SUPPLIERS BY VALUE (latest week)
-- 
SELECT
    "Unique Ref",
    "Name 1"                                AS supplier_name,
    Owner,
    Sheet,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value,
    COUNT(*)                               AS docs
FROM latest_week_ledger_headers
GROUP BY "Unique Ref"
ORDER BY ABS(total_value) DESC
LIMIT 10;


-- 
-- KPI 5: MOVEMENT (new vs cleared suppliers week-over-week)
-- 
-- New suppliers this week (not in last week)
SELECT cw."Unique Ref", cw."Name 1", cw.Owner, cw.Sheet
FROM latest_week_ledger_headers cw
LEFT JOIN (
    SELECT DISTINCT "Unique Ref"
    FROM ledger_lines
    WHERE WeekStartISO = (
        SELECT MAX(WeekStartISO) FROM ledger_lines
        WHERE WeekStartISO < (SELECT MAX(WeekStartISO) FROM ledger_lines)
    )
    AND RowLevel = 'Header'
) lw ON cw."Unique Ref" = lw."Unique Ref"
WHERE lw."Unique Ref" IS NULL;


-- 
-- KPI 6: OWNER PRODUCTIVITY (worked suppliers by action date)
-- 
SELECT
    Owner,
    COUNT(DISTINCT "Unique Ref")           AS suppliers_worked,
    COUNT(*)                               AS docs_worked
FROM latest_week_ledger_detail
WHERE "Action Date" IS NOT NULL
  AND "Action Date" != ''
GROUP BY Owner
ORDER BY suppliers_worked DESC;


-- 
-- KPI 7: VENDOR CATEGORY BREAKDOWN (latest week)
-- 
SELECT
    "Vendor category",
    Sheet,
    COUNT(DISTINCT "Unique Ref")           AS suppliers,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value
FROM latest_week_ledger_headers
GROUP BY "Vendor category", Sheet
ORDER BY ABS(total_value) DESC;


-- 
-- KPI 8: COUNTRY BREAKDOWN (latest week)
-- 
SELECT
    Country,
    Sheet,
    COUNT(DISTINCT "Unique Ref")           AS suppliers,
    COUNT(*)                               AS docs,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value
FROM latest_week_ledger_detail
GROUP BY Country, Sheet
ORDER BY ABS(total_value) DESC;


-- 
-- KPI 9: SUPPLIER HISTORY (track one supplier over time)
-- 
-- Replace 'SYN-SUP-001' with the supplier number you want
SELECT
    WeekStartISO,
    Owner,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value,
    COUNT(*)                               AS docs,
    ROUND(SUM("180> Days Overdue"), 2)     AS overdue_180
FROM ledger_lines
WHERE "Unique Ref" LIKE '%SYN-SUP-001%'
  AND RowLevel = 'Detail'
GROUP BY WeekStartISO
ORDER BY WeekStartISO;


-- 
-- WEEKLY SUMMARY TABLE (pre-aggregated for 2-4 year scale)
-- 
-- Creates a small table (~200 rows/year) for instant trend charts
-- instead of scanning millions of detail rows

DROP TABLE IF EXISTS weekly_summary;
CREATE TABLE weekly_summary AS
SELECT
    WeekStartISO,
    Owner,
    Sheet,
    COUNT(*)                               AS docs,
    COUNT(DISTINCT "Unique Ref")           AS suppliers,
    ROUND(SUM("Amount in doc. curr."), 2)  AS total_amount,
    ROUND(SUM("TOTAL VALUE"), 2)           AS total_value,
    ROUND(SUM("0-30 Days overdue"), 2)     AS aged_0_30,
    ROUND(SUM("31-60 Days overdue"), 2)    AS aged_31_60,
    ROUND(SUM("61-90 Days overdue"), 2)    AS aged_61_90,
    ROUND(SUM("91-120 Days Overdue"), 2)   AS aged_91_120,
    ROUND(SUM("121-180 Days Overdue"), 2)  AS aged_121_180,
    ROUND(SUM("180> Days Overdue"), 2)     AS aged_180_plus
FROM ledger_lines
WHERE RowLevel = 'Detail'
GROUP BY WeekStartISO, Owner, Sheet;

CREATE INDEX idx_weekly_summary_week ON weekly_summary(WeekStartISO);
