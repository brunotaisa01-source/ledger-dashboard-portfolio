-- ============================================================
-- STATEMENT - DATABASE SCHEMA (Weekly Vendor Reconciliation)
-- ============================================================
-- Stores weekly snapshots of SyntheticReview reconciliation history:
--   synthetic_review_daily.sqlite -> statement_lines
-- One row per vendor reconciliation record
-- Enriched with: Country, UniqueRef, Category, Owner, Team
-- Used by: statement_loader.py, Rol_Query.py
-- ============================================================

-- 
-- MAIN TABLE: statement_lines
-- One row per reconciliation record per weekly snapshot
-- 
CREATE TABLE IF NOT EXISTS "statement_lines" (
    -- Snapshot metadata
    "SnapshotDate"        TEXT NOT NULL,      -- YYYY-MM-DD (date extracted from filename)
    "LoadDate"            TEXT NOT NULL,      -- YYYY-MM-DD HH:MM:SS (when loaded)
    "SourceFile"          TEXT,               -- Original filename

    -- Reconciliation identity
    "RecID"               INTEGER,            -- Rec ID (unique per reconciliation)
    "RecStatus"           TEXT,               -- Unreconciled / Reconciled

    -- Vendor info (may contain multiple values separated by "; ")
    "VendorNos"           TEXT,               -- Original multi-vendor string (e.g. "0000038714; 0000046222")
    "VendorNames"         TEXT,               -- Original multi-vendor names
    "VendorGroup"         TEXT,               -- UK / GERMANY / FRANCE / BENELUX

    -- Division info (may contain multiple values separated by "; ")
    "DivisionRefs"        TEXT,               -- All division refs (e.g. "BE21; BE24; BE28")
    "Divisions"           TEXT,               -- Division names

    -- Dates
    "LedgerDate"          TEXT,               -- YYYY-MM-DD (ledger period)
    "CreatedDate"         TEXT,               -- YYYY-MM-DD (reconciliation created)
    "ReconciledDate"      TEXT,               -- YYYY-MM-DD (when reconciled, nullable)
    "EarliestInvoiceDate" TEXT,               -- YYYY-MM-DD (oldest invoice in rec)

    -- Financial
    "LedgerBalance"       REAL,               -- Balance from AP ledger
    "StatementBalance"    REAL,               -- Balance from vendor statement
    "Difference"          REAL,               -- CALCULATED: LedgerBalance - StatementBalance

    -- Volume
    "LineItems"           INTEGER,            -- Number of line items in reconciliation
    "ActionsPending"      INTEGER,            -- Number of pending actions

    -- Statement info
    "StatementType"       TEXT,               -- Spreadsheet / PDF
    "ReconciledBy"        TEXT,               -- Who reconciled (nullable)
    "AssignedUser"        TEXT,               -- User assigned to this rec
    "CreatedBy"           TEXT,               -- Who created the rec
    "RecentChanges"       INTEGER,            -- Number of recent changes

    -- Company codes (filtered to target list, separated by "; ")
    "CompanyCodes"        TEXT,               -- From Company Code column, filtered

    -- Comments
    "AllRecComments"      TEXT,               -- All reconciliation comments

    -- Action tracking columns (last modified dates)
    "ProblemInvoices"     TEXT,               -- Problem Invoices - Last modified
    "CopyRequested"       TEXT,               -- Copy Requested - Last modified
    "DataEntry"           TEXT,               -- Data Entry - Last modified
    "Rejected"            TEXT,               -- Rejected - Last modified
    "Distribution"        TEXT,               -- Distribution - Last modified
    "AwaitingApproval"    TEXT,               -- Awaiting Approval - Last modified
    "RequestCopy"         TEXT,               -- Request copy - Last modified
    "Investigate"         TEXT,               -- Investigate - Last modified
    "Unposted"            TEXT,               -- Unposted - Last modified
    "FutureMonthInvoices" TEXT,               -- Future Month Invoices - Last modified

    -- Enriched columns (added by statement_loader.py)
    "Country"             TEXT,               -- Derived from company code prefix (Uk, Germany, etc.)
    "PrimaryVendorNo"     TEXT,               -- First vendor number (leading zeros stripped)
    "PrimaryCompanyCode"  TEXT,               -- First target company code found
    "UniqueRef"           TEXT,               -- PrimaryCompanyCode + " " + PrimaryVendorNo
    "Category"            TEXT,               -- From MasterData / Vendor Matrix lookup
    "Owner"               TEXT,               -- From 3-tier lookup (fallback: AssignedUser)
    "Team"                TEXT                -- Key / ROL / "" (Query merged into ROL via migration 99)
);

-- 
-- SUMMARY TABLE: statement_summary
-- Pre-aggregated KPIs per snapshot date
-- Populated by loader after INSERT
-- 
CREATE TABLE IF NOT EXISTS "statement_summary" (
    "SnapshotDate"          TEXT NOT NULL PRIMARY KEY,
    "TotalRecs"             INTEGER DEFAULT 0,
    "Unreconciled"          INTEGER DEFAULT 0,
    "Reconciled"            INTEGER DEFAULT 0,
    "TotalLedgerBalance"    REAL DEFAULT 0,
    "TotalStatementBalance" REAL DEFAULT 0,
    "TotalDifference"       REAL DEFAULT 0,
    "TotalLineItems"        INTEGER DEFAULT 0,
    "TotalActionsPending"   INTEGER DEFAULT 0,
    "UniqueVendors"         INTEGER DEFAULT 0,
    "LoadDate"              TEXT
);
