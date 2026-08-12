-- ============================================================
-- LEDGER DASHBOARD - VIEWS
-- ============================================================
-- Pre-defined views for common access patterns.
-- Used by: Go helper, Python scripts, manual queries.
-- ============================================================

-- @ledger_views

--  Latest week (auto-detects most recent snapshot) 

DROP VIEW IF EXISTS "latest_week_ledger_all";
CREATE VIEW "latest_week_ledger_all" AS
    SELECT * FROM "ledger_lines"
    WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "ledger_lines");

DROP VIEW IF EXISTS "latest_week_rol";
CREATE VIEW "latest_week_rol" AS
    SELECT * FROM "latest_week_ledger_all"
    WHERE UPPER(COALESCE("Sheet", '')) = 'ROL';

--  Detail vs Header split 

DROP VIEW IF EXISTS "ledger_detail";
CREATE VIEW "ledger_detail" AS
    SELECT * FROM "ledger_lines"
    WHERE COALESCE("RowLevel", 'Detail') = 'Detail';

DROP VIEW IF EXISTS "ledger_headers";
CREATE VIEW "ledger_headers" AS
    SELECT * FROM "ledger_lines"
    WHERE COALESCE("RowLevel", 'Detail') = 'Header';

--  Latest week + Detail/Header 

DROP VIEW IF EXISTS "latest_week_ledger_detail";
CREATE VIEW "latest_week_ledger_detail" AS
    SELECT * FROM "ledger_detail"
    WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "ledger_detail");

DROP VIEW IF EXISTS "latest_week_ledger_headers";
CREATE VIEW "latest_week_ledger_headers" AS
    SELECT * FROM "ledger_headers"
    WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "ledger_headers");


-- @key_views

DROP VIEW IF EXISTS "key_detail";
CREATE VIEW "key_detail" AS
    SELECT * FROM "key_lines"
    WHERE COALESCE("RowLevel", 'Detail') = 'Detail';

DROP VIEW IF EXISTS "key_headers";
CREATE VIEW "key_headers" AS
    SELECT * FROM "key_lines"
    WHERE COALESCE("RowLevel", 'Detail') = 'Header';

DROP VIEW IF EXISTS "latest_week_key_detail";
CREATE VIEW "latest_week_key_detail" AS
    SELECT * FROM "key_detail"
    WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "key_detail");

DROP VIEW IF EXISTS "latest_week_key_headers";
CREATE VIEW "latest_week_key_headers" AS
    SELECT * FROM "key_headers"
    WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "key_headers");
