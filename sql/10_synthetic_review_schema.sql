-- ============================================================
-- SYNTHETIC_REVIEW - DATABASE SCHEMA (Daily Invoice Intelligence)
-- ============================================================
-- Stores daily snapshots of SyntheticReview export data:
--   synthetic_review_daily.sqlite -> synthetic_review_lines
-- Two source types: "Invoice Error" and "Duplicate Invoice"
-- Enriched with: UniqueRef, Category, Owner
-- Used by: synthetic_review_loader.py, Rol_Query.py
-- ============================================================

-- 
-- MAIN TABLE: synthetic_review_lines
-- One row per SyntheticReview item per daily snapshot
-- 
CREATE TABLE IF NOT EXISTS "synthetic_review_lines" (
    -- Snapshot metadata
    "SnapshotDate"      TEXT NOT NULL,     -- YYYY-MM-DD (date of export)
    "LoadDate"          TEXT NOT NULL,     -- YYYY-MM-DD HH:MM:SS (when loaded)

    -- Source classification
    "SourceType"        TEXT NOT NULL,     -- "Invoice Error" or "Duplicate Invoice"
    "SourceFile"        TEXT,              -- Original filename

    -- Duplicate-specific fields
    "PairID"            TEXT,              -- Duplicate pair ID (dupes only)
    "ValueFlag"         TEXT,              -- Y/N (dupes only)

    -- Common fields
    "Risk"              TEXT,              -- High / Medium / Low
    "System"            TEXT,              -- ERP system identifier
    "DivisionRef"       TEXT,              -- Company code (e.g. "SYN-CC-006", "SYN-CC-010")
    "Division"          TEXT,              -- Company name (e.g. "Synthetic Deutschland K-Holding")
    "VendorNo"          TEXT,              -- Vendor number
    "VendorName"        TEXT,              -- Vendor name
    "Region"            TEXT,              -- Synthetic Services Germany, Synthetic Services UK, etc.
    "InvoiceDate"       TEXT,              -- YYYY-MM-DD
    "PostedDate"        TEXT,              -- YYYY-MM-DD
    "Deleted"           TEXT,              -- "Not deleted" / "Deleted"
    "ClosedDate"        TEXT,              -- YYYY-MM-DD or empty
    "InvoiceNo"         TEXT,              -- Invoice number
    "InternalRef"       TEXT,              -- ERP internal reference
    "InvoiceAmount"     REAL,              -- Amount in document currency
    "AmountBase"        REAL,              -- Amount in base currency (errors only)
    "Currency"          TEXT,              -- EUR, GBP, etc.
    "IdentifiedDate"    TEXT,              -- YYYY-MM-DD
    "AgeDays"           INTEGER,           -- Age in days

    -- Error-specific fields
    "ErrorType"         TEXT,              -- Check Vendor, Check Sales tax, etc. (errors only)

    -- Shared classification
    "Classification"    TEXT,              -- Error classification or Duplicate pair classification
    "Reason"            TEXT,              -- Error reason or Duplicate reason
    "RecoveryStatus"    TEXT,              -- Pending, Not started, Recovered, etc.
    "AssignedUser"      TEXT,              -- User assigned in SyntheticReview
    "DocType"           TEXT,              -- ERP document type (RE, Z0, etc.)
    "CompanyCode"       TEXT,              -- From dupes (or derived from DivisionRef)
    "Comments"          TEXT,              -- All Comments field
    "HasAttachment"     TEXT,              -- Yes / No

    -- Processor info
    "ProcessorFirstName" TEXT,
    "ProcessorLastName"  TEXT,

    -- Enriched columns (added by loader)
    "UniqueRef"         TEXT,              -- DivisionRef + " " + VendorNo (e.g. "SYN-CC-006 100719")
    "Category"          TEXT,              -- From Vendor Master Matrix lookup
    "Owner"             TEXT,              -- From owner maps (2-tier: Key > ROL)
    "Team"              TEXT               -- Which tier assigned: Key / ROL (Query merged into ROL)
);

-- 
-- SUMMARY TABLE: synthetic_review_daily_summary
-- Pre-aggregated KPIs per snapshot date (for trend charts)
-- Populated by loader after INSERT
-- 
CREATE TABLE IF NOT EXISTS "synthetic_review_daily_summary" (
    "SnapshotDate"      TEXT NOT NULL PRIMARY KEY,
    "TotalItems"        INTEGER DEFAULT 0,
    "TotalErrors"       INTEGER DEFAULT 0,
    "TotalDuplicates"   INTEGER DEFAULT 0,
    "TotalAmount"       REAL DEFAULT 0,
    "HighRiskCount"     INTEGER DEFAULT 0,
    "HighRiskAmount"    REAL DEFAULT 0,
    "MediumRiskCount"   INTEGER DEFAULT 0,
    "LowRiskCount"      INTEGER DEFAULT 0,
    "UniqueVendors"     INTEGER DEFAULT 0,
    "PendingCount"      INTEGER DEFAULT 0,
    "ClosedCount"       INTEGER DEFAULT 0,
    "LoadDate"          TEXT
);
