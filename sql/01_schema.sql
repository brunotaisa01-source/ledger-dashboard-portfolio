-- ============================================================
-- AP CONTROL - DATABASE SCHEMA (LEDGER + KEY)
-- ============================================================
-- Defines the structure of both databases:
--   ledger_weekly.sqlite  ledger_lines (ROL/Query dashboard)
--   key_weekly.sqlite     key_lines (Power BI)
-- Used by: load_ledger_weekly_to_sqlite_clean_split.py
-- ============================================================

-- 
-- MAIN TABLE: ledger_lines
-- One row per document line per weekly snapshot
-- 
CREATE TABLE IF NOT EXISTS "ledger_lines" (
    -- Business Data
    "Country"                TEXT,       -- GERMANY, UK, FRANCE, BENELUX
    "Vendor category"        TEXT,       -- Shop, Transport, Utilities, etc.
    "Company Code"           TEXT,       -- SYN-CC-005, SYN-CC-010, SYN-CC-013, etc.
    "Supplier"               TEXT,       -- Supplier number (ERP)
    "Name 1"                 TEXT,       -- Supplier name
    "Document Date"          TEXT,       -- DD-MM-YYYY
    "Document Number"        REAL,       -- ERP document number
    "Reference"              TEXT,       -- Invoice reference
    "Amount in doc. curr."   REAL,       -- Amount in document currency
    "Document Type"          TEXT,       -- KR, KG, KZ, SA, etc.
    "Net due date"           TEXT,       -- DD-MM-YYYY
    "Document currency"      TEXT,       -- EUR, GBP, USD
    "Posting Date"           TEXT,       -- DD-MM-YYYY
    "Payment Block"          TEXT,       -- A, B, R, etc.

    -- Aging Buckets (values in document currency)
    "0-30 Days overdue"      REAL,
    "31-60 Days overdue"     REAL,
    "61-90 Days overdue"     REAL,
    "91-120 Days Overdue"    REAL,
    "121-180 Days Overdue"   REAL,
    "180> Days Overdue"      REAL,

    -- Totals
    "TOTAL VALUE"            REAL,       -- Sum of all aging buckets
    "TOTAL VOL"              REAL,       -- Count of documents
    "Total Value Over 90"    REAL,       -- Sum of 91+ buckets

    -- Workflow
    "Query type"             TEXT,       -- DD Payment, Null Invoice, etc.
    "Status"                 TEXT,       -- PENDING INVESTIGATION, CLEARED, etc.
    "AP Specialist comment"  TEXT,       -- Free text comment
    "Next Step"              TEXT,
    "Action Date"            TEXT,       -- DD-MM-YYYY (when specialist worked on it)
    "TL Comment"             TEXT,       -- Team Leader comment
    "Review Date"            TEXT,

    -- Classification
    "Open Payment"           TEXT,
    "Sheet"                  TEXT,       -- ROL (Query merged into ROL via migration 99)
    "Owner"                  TEXT,       -- AP Specialist name
    "Previous Owner"         TEXT,
    "Text"                   TEXT,
    "Unique Ref"             TEXT,       -- Company Code + Supplier (grouping key)
    "System"                 TEXT,       -- ERP1, ERP2, ERP3, ERP4, ERP5
    "User name"              TEXT,

    -- Master Data
    "Master Data DD/PR"      TEXT,
    "Actual Payment Method"  TEXT,
    "Payment Issues"         TEXT,       -- From ERP payment run logs
    "Email Address ERP"      TEXT,
    "Email Address update"   TEXT,

    -- Metadata (added by loader)
    "SourceFile"             TEXT,       -- Excel filename
    "SourcePath"             TEXT,       -- Full path to source file
    "SourceTab"              TEXT,       -- Excel tab name (= Owner)
    "SnapshotDate"           TEXT,       -- DD-MM-YYYY
    "WeekStart"              TEXT,       -- DD-MM-YYYY (Monday)
    "LoadDate"               TEXT,       -- Timestamp when loaded
    "SnapshotDateISO"        TEXT,       -- YYYY-MM-DD
    "WeekStartISO"           TEXT,       -- YYYY-MM-DD (Monday) - PRIMARY QUERY KEY
    "ISOYear"                INTEGER,    -- e.g. 2026
    "ISOWeek"                INTEGER,    -- e.g. 8

    -- Derived (computed by loader)
    "RowLevel"               TEXT,       -- 'Detail' or 'Header'
    "DocClass"               TEXT        -- 'Invoice', 'Payment', 'CreditNote', 'Header', 'Other'
);


-- 
-- KEY TABLE: key_lines (in key_weekly.sqlite)
-- Same structure as ledger_lines but for KEY sheet data.
-- Power BI reads from key_detail view.
-- 
CREATE TABLE IF NOT EXISTS "key_lines" (
    "Country"                TEXT,
    "Vendor category"        TEXT,
    "Company Code"           TEXT,
    "Supplier"               TEXT,
    "Name 1"                 TEXT,
    "Document Date"          TEXT,
    "Document Number"        REAL,
    "Reference"              TEXT,
    "Amount in doc. curr."   REAL,
    "Document Type"          TEXT,
    "Net due date"           TEXT,
    "Document currency"      TEXT,
    "Posting Date"           TEXT,
    "Payment Block"          TEXT,

    -- Aging Buckets (KEY uses 07-30 instead of 0-30)
    "07-30 Days overdue"     REAL,
    "0-30 Days overdue"      REAL,
    "07-30 Days overdue (Unified)"  REAL,   -- Merged: COALESCE(07-30, 0-30)
    "31-60 Days overdue"     REAL,
    "61-90 Days overdue"     REAL,
    "91-120 Days Overdue"    REAL,
    "121-180 Days Overdue"   REAL,
    "180> Days Overdue"      REAL,

    "TOTAL VALUE"            REAL,
    "TOTAL VOL"              REAL,
    "Total Value Over 90"    REAL,

    "Query type"             TEXT,
    "Status"                 TEXT,
    "AP Specialist comment"  TEXT,
    "Next Step"              TEXT,
    "Action Date"            TEXT,
    "TL Comment"             TEXT,
    "Review Date"            TEXT,

    "Open Payment"           TEXT,
    "Sheet"                  TEXT,       -- Always 'KEY'
    "Owner"                  TEXT,       -- Synthetic Owner 010, Synthetic Owner 011, Synthetic Owner 012, Synthetic Owner 013, Synthetic Owner 014, Synthetic Owner 015
    "Previous Owner"         TEXT,
    "Text"                   TEXT,
    "Unique Ref"             TEXT,
    "System"                 TEXT,
    "User name"              TEXT,

    "Master Data DD/PR"      TEXT,
    "Actual Payment Method"  TEXT,
    "Payment Issues"         TEXT,
    "Email Address ERP"      TEXT,
    "Email Address update"   TEXT,

    "SourceFile"             TEXT,
    "SourcePath"             TEXT,
    "SourceTab"              TEXT,
    "SnapshotDate"           TEXT,
    "WeekStart"              TEXT,
    "LoadDate"               TEXT,
    "SnapshotDateISO"        TEXT,
    "WeekStartISO"           TEXT,
    "ISOYear"                INTEGER,
    "ISOWeek"                INTEGER,

    "RowLevel"               TEXT,
    "DocClass"               TEXT
);
