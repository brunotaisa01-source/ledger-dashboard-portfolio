-- ============================================================
-- MIGRATION: Merge QUERY into ROL (all historical data)
-- ============================================================
-- Run AFTER backing up databases.
-- Safe to re-run (idempotent  no QUERY rows will remain).
--
-- Applies to: ledger_weekly.sqlite, synthetic_review_daily.sqlite
-- ============================================================

-- 1. Ledger lines  Sheet column
UPDATE ledger_lines SET "Sheet" = 'ROL' WHERE UPPER("Sheet") = 'QUERY';

-- 1b. Ledger lines  Owner column (Query Uncategorised  ROL Uncategorised)
UPDATE ledger_lines SET "Owner" = 'ROL Uncategorised'
    WHERE "Owner" = 'Query Uncategorised';

-- 2. Previous assignments (if table exists)
UPDATE previous_assignments SET sheet = 'ROL'
    WHERE UPPER(sheet) = 'QUERY';

-- 3. Assignment history (if table exists)
UPDATE assignment_history SET new_sheet = 'ROL'
    WHERE UPPER(new_sheet) = 'QUERY';
UPDATE assignment_history SET old_sheet = 'ROL'
    WHERE UPPER(old_sheet) = 'QUERY';

-- 4. SyntheticReview lines  Team column
UPDATE synthetic_review_lines SET "Team" = 'ROL'
    WHERE UPPER("Team") = 'QUERY';

-- 5. Statement lines  Team column
UPDATE statement_lines SET "Team" = 'ROL'
    WHERE UPPER("Team") = 'QUERY';
