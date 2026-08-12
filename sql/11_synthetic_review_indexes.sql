-- ============================================================
-- SYNTHETIC_REVIEW - INDEXES
-- ============================================================
-- Performance indexes for dashboard queries.
-- The SyntheticReview tab filters by snapshot date, source type, owner, risk.
-- ============================================================

-- Single-column indexes
CREATE INDEX IF NOT EXISTS idx_synthetic_review_snapshot
    ON "synthetic_review_lines"("SnapshotDate");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_source
    ON "synthetic_review_lines"("SourceType");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_owner
    ON "synthetic_review_lines"("Owner");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_risk
    ON "synthetic_review_lines"("Risk");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_region
    ON "synthetic_review_lines"("Region");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_category
    ON "synthetic_review_lines"("Category");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_recovery
    ON "synthetic_review_lines"("RecoveryStatus");

-- Composite indexes (dashboard always filters by snapshot date first)
CREATE INDEX IF NOT EXISTS idx_synthetic_review_snapshot_source
    ON "synthetic_review_lines"("SnapshotDate", "SourceType");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_snapshot_owner
    ON "synthetic_review_lines"("SnapshotDate", "Owner");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_uniqueref_snapshot
    ON "synthetic_review_lines"("UniqueRef", "SnapshotDate");

CREATE INDEX IF NOT EXISTS idx_synthetic_review_snapshot_risk
    ON "synthetic_review_lines"("SnapshotDate", "Risk");
