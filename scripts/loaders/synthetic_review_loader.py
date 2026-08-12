# -*- coding: utf-8 -*-
"""
SyntheticReview Daily Loader
Reads Invoice Error and Duplicate Invoice Excel files from data/SyntheticReview/,
enriches with Category and Owner, and stores in synthetic_review_daily.sqlite.

Logging:
    Uses Python logging module. Configure logging at entry point:

    import logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s'
    )
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sqlite3
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from ..utils.paths import SYNTHETIC_REVIEW_DATA, SYNTHETIC_REVIEW_DB, MASTER_DATA, SQL_DIR, SYNTHETIC_REVIEW_ARCHIVE, archive_old_files
from ..utils.db_helpers import staged_database
from ..utils.synthetic_review_helpers import (
    build_unique_ref,
    assign_owner,
    determine_team,
    build_synthetic_review_owner_map,
    merge_duplicate_pair_owners,
    detect_synthetic_review_file_type,
    normalize_date,
)

logger = logging.getLogger(__name__)


def _synthetic_review_archive_disabled() -> bool:
    return os.getenv("Synthetic_REPORTING_DISABLE_SYNTHETIC_REVIEW_ARCHIVE", "1").strip().lower() not in {"0", "false", "no", "off"}


#  Column mappings (Excel header  SQLite column) 

ERRORS_MAP = {
    'Risk':                          'Risk',
    'Posted date':                   'PostedDate',
    'System':                        'System',
    'Division ref.':                 'DivisionRef',
    'Division':                      'Division',
    'Vendor no.':                    'VendorNo',
    'Vendor':                        'VendorName',
    'Region':                        'Region',
    'Invoice date':                  'InvoiceDate',
    'Deleted invoices':              'Deleted',
    'Closed date':                   'ClosedDate',
    'Invoice no.':                   'InvoiceNo',
    'Internal ref.':                 'InternalRef',
    'Invoice amount':                'InvoiceAmount',
    'Invoice Amount Base Currency':  'AmountBase',
    'Currency':                      'Currency',
    'Identified date':               'IdentifiedDate',
    'Age (days)':                    'AgeDays',
    'Error type':                    'ErrorType',
    'Invoice error classification':  'Classification',
    'Invoice error reason':          'Reason',
    'Recovery status':               'RecoveryStatus',
    'Assigned user':                 'AssignedUser',
    'Doc Type':                      'DocType',
    'Processor First Name':          'ProcessorFirstName',
    'Processor Last Name':           'ProcessorLastName',
    'All Comments':                  'Comments',
    'Has Attachment':                'HasAttachment',
}

DUPES_MAP = {
    'Duplicate pair ID':             'PairID',
    'Risk':                          'Risk',
    'System':                        'System',
    'Division ref.':                 'DivisionRef',
    'Division':                      'Division',
    'Posted date':                   'PostedDate',
    'Vendor':                        'VendorName',
    'Vendor no.':                    'VendorNo',
    'Region':                        'Region',
    'Invoice date':                  'InvoiceDate',
    'Deleted invoices':              'Deleted',
    'Closed date':                   'ClosedDate',
    'Internal ref.':                 'InternalRef',
    'Invoice no.':                   'InvoiceNo',
    'Invoice amount':                'InvoiceAmount',
    'Currency':                      'Currency',
    'Identified date':               'IdentifiedDate',
    'Age (days)':                    'AgeDays',
    'Duplicate pair classification': 'Classification',
    'Duplicate reason':              'Reason',
    'Recovery status':               'RecoveryStatus',
    'Assigned user':                 'AssignedUser',
    'Doc Type':                      'DocType',
    'Processor First Name':          'ProcessorFirstName',
    'Processor Last Name':           'ProcessorLastName',
    'Company Code':                  'CompanyCode',
    'All Comments':                  'Comments',
    'Value Flag':                    'ValueFlag',
    'Has Attachment':                'HasAttachment',
}

# All columns in the unified schema
ALL_COLUMNS = [
    'SnapshotDate', 'LoadDate', 'SourceType', 'SourceFile',
    'PairID', 'ValueFlag',
    'Risk', 'System', 'DivisionRef', 'Division', 'VendorNo', 'VendorName',
    'Region', 'InvoiceDate', 'PostedDate', 'Deleted', 'ClosedDate',
    'InvoiceNo', 'InternalRef', 'InvoiceAmount', 'AmountBase', 'Currency',
    'IdentifiedDate', 'AgeDays', 'ErrorType',
    'Classification', 'Reason', 'RecoveryStatus', 'AssignedUser',
    'DocType', 'CompanyCode', 'Comments', 'HasAttachment',
    'ProcessorFirstName', 'ProcessorLastName',
    'UniqueRef', 'Category', 'Owner', 'Team',
]


_DATE_RE = re.compile(r'(\d{4}-\d{2}-\d{2})')


def _extract_file_date(path: Path) -> Optional[str]:
    """Extract YYYY-MM-DD date from filename (e.g. 'SyntheticReview_Errors_2026-02-27.xlsx')."""
    m = _DATE_RE.search(path.stem)
    return m.group(1) if m else None


def _filter_files_by_date(files: List[Path], target_date: str) -> List[Path]:
    """Keep only files whose filename contains the target date.

    If NO files match the target date, returns ALL files (backward compat).
    This prevents silent data loss if naming conventions change.
    """
    matched = [f for f in files if _extract_file_date(f) == target_date]
    if matched:
        return matched

    # No files match the target date  check if files have dates at all
    dated = [f for f in files if _extract_file_date(f) is not None]
    if dated:
        # Files have dates but none match today  old files, warn
        dates_found = sorted(set(_extract_file_date(f) for f in dated))
        logger.warning(
            "No files match target date %s. Found dates: %s. Skipping old files.",
            target_date, dates_found
        )
        return []

    # Files have no dates in name (legacy naming)  load all (backward compat)
    return files


def read_invoice_errors(path: Path) -> pd.DataFrame:
    """Read Invoice Errors Excel and return normalized DataFrame."""
    df = pd.read_excel(str(path), dtype=str)

    # Rename columns using mapping
    rename = {}
    for excel_col, db_col in ERRORS_MAP.items():
        if excel_col in df.columns:
            rename[excel_col] = db_col
    df = df.rename(columns=rename)

    # Keep only mapped columns
    keep = [c for c in df.columns if c in ERRORS_MAP.values()]
    df = df[keep]

    df['SourceType'] = 'Invoice Error'
    df['SourceFile'] = path.name

    return df


def read_duplicate_invoices(path: Path) -> pd.DataFrame:
    """Read Duplicate Invoices Excel and return normalized DataFrame."""
    df = pd.read_excel(str(path), dtype=str)

    rename = {}
    for excel_col, db_col in DUPES_MAP.items():
        if excel_col in df.columns:
            rename[excel_col] = db_col
    df = df.rename(columns=rename)

    keep = [c for c in df.columns if c in DUPES_MAP.values()]
    df = df[keep]

    df['SourceType'] = 'Duplicate Invoice'
    df['SourceFile'] = path.name

    return df


def _normalize_dates_in_df(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize all date columns to YYYY-MM-DD."""
    date_cols = ['InvoiceDate', 'PostedDate', 'ClosedDate', 'IdentifiedDate']
    for col in date_cols:
        if col in df.columns:
            df[col] = df[col].apply(normalize_date)
    return df


def _normalize_amounts(df: pd.DataFrame) -> pd.DataFrame:
    """Convert amount columns to float."""
    for col in ['InvoiceAmount', 'AmountBase']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    if 'AgeDays' in df.columns:
        df['AgeDays'] = pd.to_numeric(df['AgeDays'], errors='coerce')
        df['AgeDays'] = df['AgeDays'].apply(
            lambda v: int(v) if pd.notna(v) else None
        )
    return df


def _init_db(conn: sqlite3.Connection) -> None:
    """Create tables, indexes, and views if they don't exist."""
    schema_path = SQL_DIR / '10_synthetic_review_schema.sql'
    index_path = SQL_DIR / '11_synthetic_review_indexes.sql'
    views_path = SQL_DIR / '12_synthetic_review_views.sql'

    for sql_file in [schema_path, index_path, views_path]:
        if not sql_file.is_file() or sql_file.stat().st_size <= 0:
            raise RuntimeError(f"Required SQL file is missing or empty: {sql_file.name}")
        sql = sql_file.read_text(encoding='utf-8')
        if not sql.strip():
            raise RuntimeError(f"Required SQL file is empty: {sql_file.name}")
        conn.executescript(sql)

    # Migration: add Team column if missing (existing DB upgrade)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(synthetic_review_lines)").fetchall()]
    if 'Team' not in cols:
        conn.execute('ALTER TABLE "synthetic_review_lines" ADD COLUMN "Team" TEXT')
        conn.commit()


def _update_summary(conn: sqlite3.Connection, snapshot_date: str) -> None:
    """Compute and upsert daily summary for a given snapshot date."""
    row = conn.execute("""
        SELECT
            COUNT(*),
            SUM(CASE WHEN SourceType='Invoice Error' THEN 1 ELSE 0 END),
            SUM(CASE WHEN SourceType='Duplicate Invoice' THEN 1 ELSE 0 END),
            COALESCE(SUM(InvoiceAmount), 0),
            SUM(CASE WHEN Risk='High' THEN 1 ELSE 0 END),
            COALESCE(SUM(CASE WHEN Risk='High' THEN InvoiceAmount ELSE 0 END), 0),
            SUM(CASE WHEN Risk='Medium' THEN 1 ELSE 0 END),
            SUM(CASE WHEN Risk='Low' THEN 1 ELSE 0 END),
            COUNT(DISTINCT UniqueRef),
            SUM(CASE WHEN RecoveryStatus IN ('Pending', 'Not started') THEN 1 ELSE 0 END),
            SUM(CASE WHEN ClosedDate != '' AND ClosedDate IS NOT NULL THEN 1 ELSE 0 END)
        FROM synthetic_review_lines
        WHERE SnapshotDate = ?
    """, (snapshot_date,)).fetchone()

    conn.execute("""
        INSERT OR REPLACE INTO synthetic_review_daily_summary
        (SnapshotDate, TotalItems, TotalErrors, TotalDuplicates, TotalAmount,
         HighRiskCount, HighRiskAmount, MediumRiskCount, LowRiskCount,
         UniqueVendors, PendingCount, ClosedCount, LoadDate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        snapshot_date, row[0], row[1], row[2], row[3],
        row[4], row[5], row[6], row[7], row[8], row[9], row[10],
        datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    ))


def load_and_store_synthetic_review(
    synthetic_review_dir: Optional[Path] = None,
    db_path: Optional[Path] = None,
    master_dir: Optional[Path] = None,
    snapshot_date: Optional[str] = None,
) -> Dict[str, int]:
    """
    Read SyntheticReview Excel files, enrich, and store in SQLite.
    Returns: {'errors_loaded': N, 'duplicates_loaded': N}
    """
    synthetic_review_dir = synthetic_review_dir or SYNTHETIC_REVIEW_DATA
    db_path = db_path or SYNTHETIC_REVIEW_DB
    master_dir = master_dir or MASTER_DATA
    snapshot_date = snapshot_date or date.today().isoformat()
    load_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Scan for Excel files
    xlsx_files = [
        f for f in synthetic_review_dir.glob('*.xlsx')
        if not f.name.startswith('~$')
        and 'reconciliation-history' not in f.name.lower()
    ]

    if not xlsx_files:
        raise RuntimeError(f"No xlsx files found in {synthetic_review_dir}")

    # Filter by target date to prevent loading old files as today's data
    xlsx_files = _filter_files_by_date(xlsx_files, snapshot_date)
    if not xlsx_files:
        raise RuntimeError(f"No files matching date {snapshot_date}")

    # Classify files
    error_files = []
    dupe_files = []
    for f in xlsx_files:
        ftype = detect_synthetic_review_file_type(f)
        if ftype == 'errors':
            error_files.append(f)
            logger.info("Detected Invoice Errors: %s", f.name)
        elif ftype == 'duplicates':
            dupe_files.append(f)
            logger.info("Detected Duplicates: %s", f.name)
        else:
            logger.warning("Unknown file type (skipped): %s", f.name)

    # Read and parse
    frames = []
    errors_count = 0
    dupes_count = 0

    for f in error_files:
        df = read_invoice_errors(f)
        errors_count += len(df)
        frames.append(df)

    for f in dupe_files:
        df = read_duplicate_invoices(f)
        dupes_count += len(df)
        frames.append(df)

    if not frames:
        raise RuntimeError("No valid SyntheticReview data found")

    # Unify into single DataFrame
    combined = pd.concat(frames, ignore_index=True)

    # Normalize dates and amounts
    combined = _normalize_dates_in_df(combined)
    combined = _normalize_amounts(combined)

    # Add metadata
    combined['SnapshotDate'] = snapshot_date
    combined['LoadDate'] = load_date

    # Ensure Region column exists before enrichment
    if 'Region' not in combined.columns:
        combined['Region'] = ''

    # Build UniqueRef
    combined['UniqueRef'] = combined.apply(
        lambda row: build_unique_ref(row.get('DivisionRef', ''), row.get('VendorNo', '')),
        axis=1,
    )

    # Enrichment: Category + Owner (MasterData first, Vendor Matrix fallback)
    vendor_matrix = master_dir / 'Synthetic_Vendor_Master_Matrix.csv'
    owner_map_file = master_dir / 'Owner_map.csv'

    if vendor_matrix.exists() and owner_map_file.exists():
        try:
            md_lookup, cat_map, key_map, rol_map, vm_country_map = build_synthetic_review_owner_map(
                vendor_matrix, owner_map_file, master_dir,
            )

            if not md_lookup and not cat_map:
                raise RuntimeError("No Category lookup available from MasterData or Vendor Matrix")

            def _enrich_row(row):
                ref = row.get('UniqueRef', '')
                # Primary: MasterData lookup
                if ref and ref in md_lookup:
                    md = md_lookup[ref]
                    country = md.get('Country', '')
                    return pd.Series({
                        'Category': md['Category'],
                        'Owner': md['Owner'],
                        'Team': md['Team'],
                        'Country': country,
                    })
                # Fallback: Vendor Matrix + 2-tier logic (Key + unified ROL)
                cat = cat_map.get(ref, '') if ref else ''
                owner = assign_owner(ref, cat, key_map, rol_map)
                team = determine_team(ref, cat, key_map, rol_map)
                country = vm_country_map.get(ref, '') if ref else ''
                return pd.Series({'Category': cat, 'Owner': owner, 'Team': team, 'Country': country})

            enriched = combined.apply(_enrich_row, axis=1)
            combined['Category'] = enriched['Category'].fillna('')
            combined['Owner'] = enriched['Owner'].fillna('Unassigned')
            combined['Team'] = enriched['Team'].fillna('')

            # Fill Region from resolved Country when Region is empty/unknown
            # Title-case to match SyntheticReview format (e.g. "GERMANY" -> "Germany")
            resolved_country = enriched['Country'].fillna('').str.strip().str.title()
            empty_region = combined['Region'].fillna('').str.strip().eq('')
            combined.loc[empty_region & resolved_country.ne(''), 'Region'] = resolved_country

            # Merge owners for duplicate pairs with different owners
            merge_duplicate_pair_owners(combined)

            md_count = combined['UniqueRef'].isin(md_lookup).sum() if md_lookup else 0
            fb_count = len(combined) - md_count
            country_filled = (empty_region & resolved_country.ne('')).sum()
            logger.info(
                "Enrichment: %d categorized, %d assigned (%d from MasterData, %d fallback), %d countries resolved",
                combined['Category'].ne('').sum(),
                combined['Owner'].ne('Unassigned').sum(),
                md_count, fb_count, country_filled
            )
        except Exception as e:
            raise RuntimeError("SyntheticReview enrichment failed; existing snapshot was preserved") from e
    else:
        logger.warning("Master data files not found, skipping enrichment")
        combined['Category'] = ''
        combined['Owner'] = 'Unassigned'
        combined['Team'] = ''

    # Ensure all columns exist
    for col in ALL_COLUMNS:
        if col not in combined.columns:
            combined[col] = ''

    combined = combined[ALL_COLUMNS]

    # Store in SQLite
    target_db_path = Path(db_path)
    with staged_database(target_db_path) as staged_db_path:
        with closing(sqlite3.connect(str(staged_db_path))) as conn:
            _init_db(conn)

            # Idempotent: delete existing data for this snapshot date
            conn.execute(
                "DELETE FROM synthetic_review_lines WHERE SnapshotDate = ?",
                (snapshot_date,),
            )

            # Insert
            combined.to_sql('synthetic_review_lines', conn, if_exists='append', index=False)

            # Update summary
            _update_summary(conn, snapshot_date)

            # Recreate views (they reference latest data)
            views_path = SQL_DIR / '12_synthetic_review_views.sql'
            conn.executescript(views_path.read_text(encoding='utf-8'))

            # Optimize and validate before staged promotion.
            conn.execute("ANALYZE")
            conn.commit()
            conn.execute("VACUUM")
            stored = int(
                conn.execute(
                    "SELECT COUNT(*) FROM synthetic_review_lines WHERE SnapshotDate = ?",
                    (snapshot_date,),
                ).fetchone()[0]
            )
            if stored != len(combined) or stored <= 0:
                raise RuntimeError(
                    f"SyntheticReview staging row contract failed: expected {len(combined)}, stored {stored}"
                )

    logger.info("Stored in %s: %d errors + %d duplicates", db_path.name, errors_count, dupes_count)

    if _synthetic_review_archive_disabled():
        logger.info("SyntheticReview archive disabled for this pack; keeping source files in data/SyntheticReview")
    else:
        # Archive old SyntheticReview files (keep only today's snapshot date)
        # keep_pattern uses YYYY-MM-DD format matching SyntheticReview filenames
        archived = archive_old_files(synthetic_review_dir, SYNTHETIC_REVIEW_ARCHIVE, keep_pattern=snapshot_date)
        if archived:
            logger.info("Archived %d old file(s)", len(archived))

    return {'errors_loaded': errors_count, 'duplicates_loaded': dupes_count}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=SYNTHETIC_REVIEW_DATA)
    parser.add_argument("--db", type=Path, default=SYNTHETIC_REVIEW_DB)
    parser.add_argument("--master-dir", type=Path, default=MASTER_DATA)
    parser.add_argument("--snapshot-date")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    try:
        result = load_and_store_synthetic_review(
            synthetic_review_dir=args.input_dir,
            db_path=args.db,
            master_dir=args.master_dir,
            snapshot_date=args.snapshot_date,
        )
    except Exception as exc:
        logger.error("SyntheticReview load failed: %s", exc)
        return 1
    loaded = result['errors_loaded'] + result['duplicates_loaded']
    logger.info("Loaded: %d errors, %d duplicates", result['errors_loaded'], result['duplicates_loaded'])
    return 0 if loaded > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
