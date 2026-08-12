-- ============================================================
-- STATEMENT - INDEXES
-- ============================================================
-- Performance indexes for dashboard queries.
-- The Statement tab filters by snapshot date, status, country,
-- team, assigned user, and company codes.
-- ============================================================

-- Single-column indexes
CREATE INDEX IF NOT EXISTS idx_stmt_snapshot
    ON "statement_lines"("SnapshotDate");

CREATE INDEX IF NOT EXISTS idx_stmt_status
    ON "statement_lines"("RecStatus");

CREATE INDEX IF NOT EXISTS idx_stmt_country
    ON "statement_lines"("Country");

CREATE INDEX IF NOT EXISTS idx_stmt_team
    ON "statement_lines"("Team");

CREATE INDEX IF NOT EXISTS idx_stmt_assigned
    ON "statement_lines"("AssignedUser");

CREATE INDEX IF NOT EXISTS idx_stmt_category
    ON "statement_lines"("Category");

-- Composite indexes (dashboard filters by snapshot date first)
CREATE INDEX IF NOT EXISTS idx_stmt_snapshot_status
    ON "statement_lines"("SnapshotDate", "RecStatus");

CREATE INDEX IF NOT EXISTS idx_stmt_snapshot_country
    ON "statement_lines"("SnapshotDate", "Country");

CREATE INDEX IF NOT EXISTS idx_stmt_snapshot_team
    ON "statement_lines"("SnapshotDate", "Team");

CREATE INDEX IF NOT EXISTS idx_stmt_snapshot_assigned
    ON "statement_lines"("SnapshotDate", "AssignedUser");
