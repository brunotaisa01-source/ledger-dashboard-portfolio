-- ============================================================
-- LEDGER DASHBOARD - QUERIES USED BY THE DASHBOARD
-- ============================================================
-- Every SQL query the dashboard executes, documented.
-- Source: Rol_Query.py (Python) + main.go (Go helper)
-- ============================================================


-- 
-- 1. METADATA QUERIES (populate filters/dropdowns)
-- 

-- Available weeks (for week selector dropdown)
SELECT DISTINCT "WeekStartISO"
FROM ledger_lines
WHERE "WeekStartISO" IS NOT NULL
ORDER BY "WeekStartISO" DESC;

-- Countries (for filter)
SELECT DISTINCT "Country"
FROM ledger_lines
WHERE "Country" IS NOT NULL
ORDER BY "Country";

-- Company codes (for filter)
SELECT DISTINCT "Company Code"
FROM ledger_lines
WHERE "Company Code" IS NOT NULL
ORDER BY "Company Code";

-- Owners (for filter)
SELECT DISTINCT "Owner"
FROM ledger_lines
WHERE "Owner" IS NOT NULL
ORDER BY "Owner";

-- Vendor categories (for filter)
SELECT DISTINCT "Vendor category"
FROM ledger_lines
WHERE "Vendor category" IS NOT NULL
ORDER BY "Vendor category";

-- Payment blocks (for filter)
SELECT DISTINCT "Payment Block"
FROM ledger_lines
WHERE "Payment Block" IS NOT NULL
ORDER BY "Payment Block";


-- 
-- 2. WEEK DATA QUERY (main dashboard load)
-- 
-- Loads all rows for a given week. The JS frontend then
-- filters, groups, and computes KPIs client-side.

SELECT
    "Sheet"                  AS Sheet,
    "Owner"                  AS Owner,
    "Supplier"               AS Supplier,
    "Name 1"                 AS SupplierName,
    "Country"                AS Country,
    "Company Code"           AS CompanyCode,
    "Amount in doc. curr."   AS TotalAmount,
    "Document currency"      AS Currency,
    "0-30 Days overdue"      AS Aged_0_30,
    "31-60 Days overdue"     AS Aged_31_60,
    "61-90 Days overdue"     AS Aged_61_90,
    "91-120 Days Overdue"    AS Aged_91_120,
    "121-180 Days Overdue"   AS Aged_121_180,
    "180> Days Overdue"      AS Aged_180_plus,
    "Action Date"            AS ActionDate,
    "AP Specialist comment"  AS Comment,
    "Query type"             AS QueryType,
    "Status"                 AS Status,
    "RowLevel"               AS RowLevel,
    "TOTAL VALUE"            AS TotalValue,
    "TOTAL VOL"              AS TotalVol,
    "System"                 AS System,
    "Document Type"          AS DocumentType,
    "Document Number"        AS DocumentNumber,
    "Vendor category"        AS VendorCategory,
    "Payment Block"          AS PaymentBlock
FROM ledger_lines
WHERE "WeekStartISO" = ?;
-- Parameter: week date (e.g. '2026-02-23')


-- 
-- 3. CSV EXPORT QUERIES (Go helper /export.csv)
-- 

-- Export date range
SELECT
    "Sheet", "Owner", "Supplier", "Name 1", "Country", "Company Code",
    "TOTAL VALUE", "TOTAL VOL", "Amount in doc. curr.", "Document currency",
    "0-30 Days overdue", "31-60 Days overdue", "61-90 Days overdue",
    "91-120 Days Overdue", "121-180 Days Overdue", "180> Days Overdue",
    "Action Date", "AP Specialist comment", "Query type", "System",
    "Status", "Document Type", "Document Number",
    "WeekStartISO"
FROM ledger_lines
WHERE "WeekStartISO" BETWEEN ? AND ?
ORDER BY "WeekStartISO";
-- Parameters: from_date, to_date (e.g. '2026-01-05', '2026-02-23')


-- 
-- 4. OVERDUE COMPARISON (two-week diff)
-- 

-- Current week
SELECT * FROM ledger_lines WHERE "WeekStartISO" = ?;
-- Parameter: current_week (e.g. '2026-02-23')

-- Last week (for comparison)
SELECT * FROM ledger_lines WHERE "WeekStartISO" = ?;
-- Parameter: previous_week (e.g. '2026-02-16')


-- 
-- 5. DATA LOADING (used by loader script)
-- 

-- Check if table exists
SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledger_lines';

-- Delete existing snapshot before re-insert (idempotent load)
DELETE FROM "ledger_lines" WHERE "SnapshotDateISO" = ?;
-- Parameter: snapshot_date (e.g. '2026-02-23')

-- Concrete parameterized smoke insert. The Python loader constructs its
-- allow-listed bulk column list in code and is covered separately.
INSERT INTO "ledger_lines"
    ("Supplier", "Name 1", "SnapshotDateISO", "RowLevel", "SourcePath")
VALUES
    (:supplier, :supplier_name, :snapshot_date, 'Detail', :source_path);

-- Optimize after bulk insert
ANALYZE;
