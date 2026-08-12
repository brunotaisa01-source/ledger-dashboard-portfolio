-- ============================================================
-- MASTER DATA TABLES (future use)
-- ============================================================
-- Reference tables for data currently stored as CSV files.
-- When populated, enables instant lookups instead of re-parsing.
-- ============================================================

-- Vendor Master Matrix (currently: Synthetic_Vendor_Master_Matrix.csv, 19MB)
CREATE TABLE IF NOT EXISTS vendor_matrix (
    unique_ref      TEXT NOT NULL,
    category        TEXT,
    pm_name         TEXT,
    snapshot_date   TEXT,
    loaded_at       TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (unique_ref)
);
CREATE INDEX IF NOT EXISTS idx_vm_category ON vendor_matrix(category);

-- Owner Map (currently: Owner_map.csv)
CREATE TABLE IF NOT EXISTS owner_map (
    unique_ref  TEXT NOT NULL,
    owner       TEXT NOT NULL,
    source      TEXT,
    updated_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (unique_ref)
);

-- Previous Assignments (currently: previous_assignments.csv)
CREATE TABLE IF NOT EXISTS previous_assignments (
    unique_ref  TEXT NOT NULL,
    sheet       TEXT,
    owner       TEXT,
    week_iso    TEXT,
    updated_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (unique_ref, week_iso)
);
CREATE INDEX IF NOT EXISTS idx_pa_week ON previous_assignments(week_iso);

-- Assignment History (append-only audit log)
CREATE TABLE IF NOT EXISTS assignment_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_ref  TEXT NOT NULL,
    old_sheet   TEXT,
    new_sheet   TEXT,
    old_owner   TEXT,
    new_owner   TEXT,
    changed_at  TEXT DEFAULT (datetime('now')),
    reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_ah_ref ON assignment_history(unique_ref);
