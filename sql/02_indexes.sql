-- ============================================================
-- LEDGER DASHBOARD - INDEXES
-- ============================================================
-- Performance indexes for fast dashboard queries.
-- The dashboard filters by week, sheet, owner, rowlevel.
-- ============================================================

-- @ledger_indexes

--  Single-column indexes (existing) 
CREATE INDEX IF NOT EXISTS idx_ledger_lines_weekstartiso
    ON "ledger_lines"("WeekStartISO");

CREATE INDEX IF NOT EXISTS idx_ledger_lines_snapshotiso
    ON "ledger_lines"("SnapshotDateISO");

CREATE INDEX IF NOT EXISTS idx_ledger_lines_sheet
    ON "ledger_lines"("Sheet");

CREATE INDEX IF NOT EXISTS idx_ledger_lines_rowlevel
    ON "ledger_lines"("RowLevel");

CREATE INDEX IF NOT EXISTS idx_ledger_lines_docclass
    ON "ledger_lines"("DocClass");

--  Composite indexes (for 2-4 year scale) 
-- Dashboard always filters by week + sheet (every page load)
CREATE INDEX IF NOT EXISTS idx_ledger_week_sheet
    ON "ledger_lines"("WeekStartISO", "Sheet");

-- Supplier drill-down across time
CREATE INDEX IF NOT EXISTS idx_ledger_supplier_week
    ON "ledger_lines"("Unique Ref", "WeekStartISO");

-- Owner performance across time
CREATE INDEX IF NOT EXISTS idx_ledger_owner_week
    ON "ledger_lines"("Owner", "WeekStartISO");

-- Country + week for geographic filtering
CREATE INDEX IF NOT EXISTS idx_ledger_country_week
    ON "ledger_lines"("Country", "WeekStartISO");


-- @key_indexes

--  Single-column indexes 
CREATE INDEX IF NOT EXISTS idx_key_lines_weekstartiso
    ON "key_lines"("WeekStartISO");

CREATE INDEX IF NOT EXISTS idx_key_lines_snapshotiso
    ON "key_lines"("SnapshotDateISO");

CREATE INDEX IF NOT EXISTS idx_key_lines_sheet
    ON "key_lines"("Sheet");

CREATE INDEX IF NOT EXISTS idx_key_lines_rowlevel
    ON "key_lines"("RowLevel");

CREATE INDEX IF NOT EXISTS idx_key_lines_docclass
    ON "key_lines"("DocClass");

--  Composite indexes (for Power BI performance) 
CREATE INDEX IF NOT EXISTS idx_key_owner_week
    ON "key_lines"("Owner", "WeekStartISO");

CREATE INDEX IF NOT EXISTS idx_key_supplier_week
    ON "key_lines"("Unique Ref", "WeekStartISO");
