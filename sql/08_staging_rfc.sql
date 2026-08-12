-- ============================================================
-- STAGING TABLES FOR FUTURE ERP CONNECTOR INTEGRATION
-- ============================================================
-- When RFC is ready, data flows:
--   ERP (ERP1/ERP2/ERP3/ERP5/ERP4) -> staging_erp_raw -> processing -> ledger_lines/key_lines
-- One staging table for all 5 ERP systems.
-- ============================================================

CREATE TABLE IF NOT EXISTS staging_erp_raw (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    erp_system      TEXT NOT NULL,          -- ERP1, ERP2, ERP3, ERP5, ERP4
    company_code    TEXT,
    supplier        TEXT,
    name_1          TEXT,
    document_number TEXT,
    amount          REAL,
    currency        TEXT,
    document_date   TEXT,
    net_due_date    TEXT,
    document_type   TEXT,
    reference       TEXT,
    posting_date    TEXT,
    payment_block   TEXT,
    text_field      TEXT,
    user_name       TEXT,
    -- RFC metadata
    extracted_at    TEXT DEFAULT (datetime('now')),
    rfc_batch_id    TEXT,
    processed       INTEGER DEFAULT 0       -- 0=pending, 1=processed
);

CREATE INDEX IF NOT EXISTS idx_staging_system
    ON staging_erp_raw(erp_system);
CREATE INDEX IF NOT EXISTS idx_staging_processed
    ON staging_erp_raw(processed);
CREATE INDEX IF NOT EXISTS idx_staging_batch
    ON staging_erp_raw(rfc_batch_id);

-- View: pending rows per system
CREATE VIEW IF NOT EXISTS staging_pending AS
    SELECT erp_system, COUNT(*) AS pending_rows
    FROM staging_erp_raw
    WHERE processed = 0
    GROUP BY erp_system;
