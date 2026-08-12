-- ============================================================
-- SYNTHETIC_REVIEW - VIEWS
-- ============================================================
-- Pre-defined views for common access patterns.
-- Used by: Rol_Query.py, manual queries.
-- ============================================================

-- Latest snapshot (most recent day)
DROP VIEW IF EXISTS "synthetic_review_latest";
CREATE VIEW "synthetic_review_latest" AS
    SELECT * FROM "synthetic_review_lines"
    WHERE "SnapshotDate" = (SELECT MAX("SnapshotDate") FROM "synthetic_review_lines");

-- Latest errors only
DROP VIEW IF EXISTS "synthetic_review_latest_errors";
CREATE VIEW "synthetic_review_latest_errors" AS
    SELECT * FROM "synthetic_review_latest"
    WHERE "SourceType" = 'Invoice Error';

-- Latest duplicates only
DROP VIEW IF EXISTS "synthetic_review_latest_duplicates";
CREATE VIEW "synthetic_review_latest_duplicates" AS
    SELECT * FROM "synthetic_review_latest"
    WHERE "SourceType" = 'Duplicate Invoice';

-- High risk items (latest)
DROP VIEW IF EXISTS "synthetic_review_high_risk";
CREATE VIEW "synthetic_review_high_risk" AS
    SELECT * FROM "synthetic_review_latest"
    WHERE "Risk" = 'High';

-- Summary by owner (latest snapshot)
DROP VIEW IF EXISTS "synthetic_review_owner_summary";
CREATE VIEW "synthetic_review_owner_summary" AS
    SELECT
        "Owner",
        COUNT(*)                                        AS "Items",
        SUM(CASE WHEN "SourceType" = 'Invoice Error'
            THEN 1 ELSE 0 END)                          AS "Errors",
        SUM(CASE WHEN "SourceType" = 'Duplicate Invoice'
            THEN 1 ELSE 0 END)                          AS "Duplicates",
        SUM(CASE WHEN "Risk" = 'High'
            THEN 1 ELSE 0 END)                          AS "HighRisk",
        ROUND(SUM(COALESCE("InvoiceAmount", 0)), 2)    AS "TotalAmount",
        COUNT(DISTINCT "UniqueRef")                     AS "UniqueVendors"
    FROM "synthetic_review_latest"
    GROUP BY "Owner"
    ORDER BY "Items" DESC;

-- Summary by region (latest snapshot)
DROP VIEW IF EXISTS "synthetic_review_region_summary";
CREATE VIEW "synthetic_review_region_summary" AS
    SELECT
        "Region",
        COUNT(*)                                        AS "Items",
        SUM(CASE WHEN "Risk" = 'High'
            THEN 1 ELSE 0 END)                          AS "HighRisk",
        ROUND(SUM(COALESCE("InvoiceAmount", 0)), 2)    AS "TotalAmount",
        COUNT(DISTINCT "UniqueRef")                     AS "UniqueVendors"
    FROM "synthetic_review_latest"
    GROUP BY "Region"
    ORDER BY "Items" DESC;

-- Daily trend (KPIs per day)
DROP VIEW IF EXISTS "synthetic_review_daily_trend";
CREATE VIEW "synthetic_review_daily_trend" AS
    SELECT
        "SnapshotDate",
        COUNT(*)                                        AS "TotalItems",
        SUM(CASE WHEN "SourceType" = 'Invoice Error'
            THEN 1 ELSE 0 END)                          AS "Errors",
        SUM(CASE WHEN "SourceType" = 'Duplicate Invoice'
            THEN 1 ELSE 0 END)                          AS "Duplicates",
        SUM(CASE WHEN "Risk" = 'High'
            THEN 1 ELSE 0 END)                          AS "HighRisk",
        ROUND(SUM(COALESCE("InvoiceAmount", 0)), 2)    AS "TotalAmount",
        COUNT(DISTINCT "UniqueRef")                     AS "UniqueVendors"
    FROM "synthetic_review_lines"
    GROUP BY "SnapshotDate"
    ORDER BY "SnapshotDate" DESC;

-- Unassigned vendors (need category mapping)
DROP VIEW IF EXISTS "synthetic_review_unassigned";
CREATE VIEW "synthetic_review_unassigned" AS
    SELECT DISTINCT "UniqueRef", "VendorNo", "VendorName", "DivisionRef", "Region"
    FROM "synthetic_review_latest"
    WHERE "Owner" = 'Unassigned' OR "Owner" IS NULL OR "Owner" = '';
