# -*- coding: utf-8 -*-
"""
Statement Loader (Reconciliation History)
Reads *_reconciliation-history_*.xlsx from data/SyntheticReview/,
enriches with Country/Category/Owner/Team, and stores in synthetic_review_daily.sqlite
(tables: statement_lines, statement_summary).

Follows the same pattern as synthetic_review_loader.py.

Logging:
    Uses Python logging module. Configure logging at entry point.
"""
from __future__ import annotations

import argparse
import logging
import re
import sqlite3
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from ..utils.paths import SYNTHETIC_REVIEW_DATA, SYNTHETIC_REVIEW_DB, MASTER_DATA, SQL_DIR
from ..utils.synthetic_review_helpers import (
    build_unique_ref,
    assign_owner,
    determine_team,
    build_synthetic_review_owner_map,
    normalize_date,
)
from ..utils.masterdata_core import country_from_code, COMPANY_LOG_CODES
from ..utils.db_helpers import staged_database

logger = logging.getLogger(__name__)


#  Column mapping (Excel header  SQLite column) 
STATEMENT_MAP = {
    'Rec ID':                              'RecID',
    'Rec status':                          'RecStatus',
    'Rec vendor no.':                      'VendorNos',
    'Rec vendor':                          'VendorNames',
    'Rec vendor group':                    'VendorGroup',
    'Rec region':                          'Region',       # not used for Country  we derive from CC
    'Rec division ref.':                   'DivisionRefs',
    'Rec division':                        'Divisions',
    'Ledger date':                         'LedgerDate',
    'Created date':                        'CreatedDate',
    'Reconciled date':                     'ReconciledDate',
    'Earliest invoice date':               'EarliestInvoiceDate',
    'Ledger balance':                      'LedgerBalance',
    'Statement balance':                   'StatementBalance',
    'Line items':                          'LineItems',
    'Actions pending':                     'ActionsPending',
    'Statement':                           'StatementType',
    'Reconciled by':                       'ReconciledBy',
    'Assigned user':                       'AssignedUser',
    'Created by':                          'CreatedBy',
    'Recent changes':                      'RecentChanges',
    'Company Code':                        'CompanyCodes',
    'All Rec Comments':                    'AllRecComments',
    'Problem Invoices - Last modified':    'ProblemInvoices',
    'Copy Requested - Last modified':      'CopyRequested',
    'Data Entry - Last modified':          'DataEntry',
    'Rejected - Last modified':            'Rejected',
    'Distribution - Last modified':        'Distribution',
    'Awaiting Approval - Last modified':   'AwaitingApproval',
    'Request copy - Last modified':        'RequestCopy',
    'Investigate - Last modified':         'Investigate',
    'Unposted - Last modified':            'Unposted',
    'Future Month Invoices - Last modified': 'FutureMonthInvoices',
}

# Target company codes (upper-cased set for fast lookup)
TARGET_CC = {c.upper() for c in COMPANY_LOG_CODES}

# All columns in the statement_lines schema (insertion order)
ALL_COLUMNS = [
    'SnapshotDate', 'LoadDate', 'SourceFile',
    'RecID', 'RecStatus',
    'VendorNos', 'VendorNames', 'VendorGroup',
    'DivisionRefs', 'Divisions',
    'LedgerDate', 'CreatedDate', 'ReconciledDate', 'EarliestInvoiceDate',
    'LedgerBalance', 'StatementBalance', 'Difference',
    'LineItems', 'ActionsPending',
    'StatementType', 'ReconciledBy', 'AssignedUser', 'CreatedBy', 'RecentChanges',
    'CompanyCodes', 'AllRecComments',
    'ProblemInvoices', 'CopyRequested', 'DataEntry', 'Rejected',
    'Distribution', 'AwaitingApproval', 'RequestCopy', 'Investigate',
    'Unposted', 'FutureMonthInvoices',
    'Country', 'PrimaryVendorNo', 'PrimaryCompanyCode', 'UniqueRef',
    'Category', 'Owner', 'Team',
]


#  File detection 

def detect_statement_file(file_path: Path) -> bool:
    """Return True if this is a reconciliation-history file (by filename pattern)."""
    return 'reconciliation-history' in file_path.name.lower()


def extract_snapshot_date(file_path: Path) -> Optional[str]:
    """
    Extract YYYY-MM-DD from filename prefix.
    Expected: 2026-02-25_reconciliation-history_synthetic_tenant_synthetic_review.xlsx
    """
    m = re.match(r'^(\d{4}-\d{2}-\d{2})_', file_path.name)
    return m.group(1) if m else None


#  Reading 

def read_reconciliation_history(path: Path) -> pd.DataFrame:
    """Read reconciliation-history Excel and return normalized DataFrame."""
    df = pd.read_excel(str(path), dtype=str)

    # Rename columns using mapping
    rename = {}
    for excel_col, db_col in STATEMENT_MAP.items():
        if excel_col in df.columns:
            rename[excel_col] = db_col
    df = df.rename(columns=rename)

    # Keep only mapped columns that exist
    keep = [c for c in df.columns if c in STATEMENT_MAP.values()]
    df = df[keep]

    df['SourceFile'] = path.name
    return df


#  Enrichment helpers 

def _extract_target_cc(raw_cc: str, division_refs: str = '') -> List[str]:
    """
    Extract target company codes from Company Code column.
    Fallback: use DivisionRefs if Company Code is empty.
    Returns: list of unique target CCs (upper-cased, sorted).
    """
    # Primary: Company Code column
    source = str(raw_cc).strip() if raw_cc and not pd.isna(raw_cc) else ''
    # Fallback: DivisionRefs
    if not source:
        source = str(division_refs).strip() if division_refs and not pd.isna(division_refs) else ''
    if not source:
        return []
    codes = [c.strip().upper() for c in source.split(';') if c.strip()]
    return sorted(set(c for c in codes if c in TARGET_CC))


def _filter_target_cc_str(target_ccs: List[str]) -> str:
    """Join target CCs as '; '-separated string."""
    return '; '.join(target_ccs)


def _split_vendor_nos(vendor_nos: str) -> List[str]:
    """Split multi-vendor string and clean each vendor number (strip leading zeros)."""
    if not vendor_nos or pd.isna(vendor_nos):
        return []
    result = []
    for v in str(vendor_nos).split(';'):
        v = v.strip()
        if v.endswith('.0'):
            v = v[:-2]
        v = v.lstrip('0') or '0'
        if v and v not in result:
            result.append(v)
    return result


def _best_match(
    vendor_nos: List[str],
    target_ccs: List[str],
    md_lookup: Dict[str, dict],
    cat_map: Dict[str, str],
    key_map: Dict[str, str],
    rol_map: Dict[str, str],
) -> dict:
    """
    Iterate ALL vendor_nos x ALL target_ccs to find the best enrichment match.
    Priority: first combination where Team is defined wins.
    Returns: {UniqueRef, PrimaryVendorNo, PrimaryCompanyCode, Category, Owner, Team}
    Note: Query team eliminated  unified ROL map covers all categories.
    """
    best = {
        'UniqueRef': '', 'PrimaryVendorNo': '', 'PrimaryCompanyCode': '',
        'Category': '', 'Owner': 'Unassigned', 'Team': '',
    }
    first_ref_set = False

    for cc in target_ccs:
        for vn in vendor_nos:
            ref = build_unique_ref(cc, vn)
            if not ref:
                continue

            # Set first valid ref as default (in case no Team match found)
            if not first_ref_set:
                best['UniqueRef'] = ref
                best['PrimaryVendorNo'] = vn
                best['PrimaryCompanyCode'] = cc
                first_ref_set = True

            # Try MasterData first
            if ref in md_lookup:
                md = md_lookup[ref]
                team = md.get('Team', '')
                best.update({
                    'UniqueRef': ref,
                    'PrimaryVendorNo': vn,
                    'PrimaryCompanyCode': cc,
                    'Category': md.get('Category', ''),
                    'Owner': md.get('Owner', '') or 'Unassigned',
                    'Team': team,
                })
                if team:
                    return best  # Found match with Team  stop

            # Try Vendor Matrix + 2-tier (Key + unified ROL)
            cat = cat_map.get(ref, '')
            if cat:
                owner = assign_owner(ref, cat, key_map, rol_map)
                team = determine_team(ref, cat, key_map, rol_map)
                if team:
                    best.update({
                        'UniqueRef': ref,
                        'PrimaryVendorNo': vn,
                        'PrimaryCompanyCode': cc,
                        'Category': cat,
                        'Owner': owner,
                        'Team': team,
                    })
                    return best  # Found match with Team  stop
                # Keep category even without team (better than nothing)
                if not best['Category']:
                    best.update({
                        'UniqueRef': ref,
                        'PrimaryVendorNo': vn,
                        'PrimaryCompanyCode': cc,
                        'Category': cat,
                        'Owner': owner,
                    })

    return best


def _country_from_cc(cc: str) -> str:
    """Derive country from a company code prefix."""
    if not cc:
        return ''
    return country_from_code(pd.Series([cc])).iloc[0]


#  Normalize 

def _normalize_dates_in_df(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize all date columns to YYYY-MM-DD."""
    date_cols = [
        'LedgerDate', 'CreatedDate', 'ReconciledDate', 'EarliestInvoiceDate',
    ]
    for col in date_cols:
        if col in df.columns:
            df[col] = df[col].apply(normalize_date)
    return df


def _normalize_amounts(df: pd.DataFrame) -> pd.DataFrame:
    """Convert financial/integer columns to proper types."""
    for col in ['LedgerBalance', 'StatementBalance']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    for col in ['LineItems', 'ActionsPending', 'RecentChanges', 'RecID']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
            df[col] = df[col].apply(lambda v: int(v) if pd.notna(v) else None)

    return df


#  DB helpers 

def _init_db(conn: sqlite3.Connection) -> None:
    """Create tables and indexes if they don't exist."""
    schema_path = SQL_DIR / '20_statement_schema.sql'
    index_path = SQL_DIR / '21_statement_indexes.sql'

    for sql_file in [schema_path, index_path]:
        if not sql_file.is_file() or sql_file.stat().st_size <= 0:
            raise RuntimeError(f"Required SQL file is missing or empty: {sql_file.name}")
        sql = sql_file.read_text(encoding='utf-8')
        if not sql.strip():
            raise RuntimeError(f"Required SQL file is empty: {sql_file.name}")
        conn.executescript(sql)


def _update_summary(conn: sqlite3.Connection, snapshot_date: str) -> None:
    """Compute and upsert summary KPIs for a given snapshot date."""
    row = conn.execute("""
        SELECT
            COUNT(*),
            SUM(CASE WHEN RecStatus = 'Unreconciled' THEN 1 ELSE 0 END),
            SUM(CASE WHEN RecStatus = 'Reconciled'   THEN 1 ELSE 0 END),
            COALESCE(SUM(LedgerBalance), 0),
            COALESCE(SUM(StatementBalance), 0),
            COALESCE(SUM(Difference), 0),
            COALESCE(SUM(LineItems), 0),
            COALESCE(SUM(ActionsPending), 0),
            COUNT(DISTINCT PrimaryVendorNo)
        FROM statement_lines
        WHERE SnapshotDate = ?
    """, (snapshot_date,)).fetchone()

    conn.execute("""
        INSERT OR REPLACE INTO statement_summary
        (SnapshotDate, TotalRecs, Unreconciled, Reconciled,
         TotalLedgerBalance, TotalStatementBalance, TotalDifference,
         TotalLineItems, TotalActionsPending, UniqueVendors, LoadDate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        snapshot_date, row[0], row[1], row[2],
        row[3], row[4], row[5], row[6], row[7], row[8],
        datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    ))


#  Main loader 

def load_and_store_statements(
    synthetic_review_dir: Optional[Path] = None,
    db_path: Optional[Path] = None,
    master_dir: Optional[Path] = None,
    snapshot_date: Optional[str] = None,
) -> Dict[str, int]:
    """
    Read reconciliation-history Excel files, enrich, and store in SQLite.
    Returns: {'statements_loaded': N, 'snapshots': [list of dates]}
    """
    synthetic_review_dir = synthetic_review_dir or SYNTHETIC_REVIEW_DATA
    db_path = db_path or SYNTHETIC_REVIEW_DB
    master_dir = master_dir or MASTER_DATA
    load_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Scan for reconciliation-history files
    xlsx_files = [
        f for f in synthetic_review_dir.glob('*.xlsx')
        if not f.name.startswith('~$') and detect_statement_file(f)
    ]

    if not xlsx_files:
        raise RuntimeError(f"No reconciliation-history files found in {synthetic_review_dir}")

    # Build enrichment maps once
    vendor_matrix = master_dir / 'Synthetic_Vendor_Master_Matrix.csv'
    owner_map_file = master_dir / 'Owner_map.csv'
    enrichment_ready = vendor_matrix.exists() and owner_map_file.exists()
    md_lookup = {}
    cat_map = {}
    key_map = {}
    rol_map = {}
    vm_country_map = {}

    if enrichment_ready:
        try:
            md_lookup, cat_map, key_map, rol_map, vm_country_map = build_synthetic_review_owner_map(
                vendor_matrix, owner_map_file, master_dir,
            )
            if not md_lookup and not cat_map:
                raise RuntimeError("No Category lookup available from MasterData or Vendor Matrix")
        except Exception as e:
            raise RuntimeError("Statement enrichment failed; existing snapshot was preserved") from e

    # Process each file
    all_frames: List[pd.DataFrame] = []
    snapshot_dates: List[str] = []
    total_rows = 0

    for f in sorted(xlsx_files):
        logger.info("Reading: %s", f.name)

        # Extract snapshot date from filename or use provided/today
        file_snapshot = extract_snapshot_date(f)
        snap = snapshot_date or file_snapshot or date.today().isoformat()

        df = read_reconciliation_history(f)
        if df.empty:
            logger.warning("Empty file (skipped): %s", f.name)
            continue

        # Normalize
        df = _normalize_dates_in_df(df)
        df = _normalize_amounts(df)

        # Metadata
        df['SnapshotDate'] = snap
        df['LoadDate'] = load_date

        # Extract target company codes (with DivisionRefs fallback)
        df['_target_ccs'] = df.apply(
            lambda row: _extract_target_cc(
                row.get('CompanyCodes', ''),
                row.get('DivisionRefs', ''),
            ),
            axis=1,
        )

        # Filter rows: keep only rows with at least 1 target CC
        before_count = len(df)
        df = df[df['_target_ccs'].apply(len) > 0].copy()
        filtered_out = before_count - len(df)
        if filtered_out:
            logger.info("Dropped %d rows with no target company codes", filtered_out)

        if df.empty:
            logger.warning("No rows with target company codes (skipped): %s", f.name)
            continue

        # Store filtered CC string
        df['CompanyCodes'] = df['_target_ccs'].apply(_filter_target_cc_str)

        # Multi-vendor x multi-CC matching for enrichment
        if enrichment_ready:
            try:
                def _enrich_row(row):
                    vendors = _split_vendor_nos(row.get('VendorNos', ''))
                    ccs = row.get('_target_ccs', [])
                    match = _best_match(vendors, ccs, md_lookup, cat_map, key_map, rol_map)
                    # Fallback owner: use AssignedUser if still Unassigned
                    if match['Owner'] == 'Unassigned':
                        assigned = str(row.get('AssignedUser', '') or '').strip()
                        if assigned:
                            match['Owner'] = assigned
                    return pd.Series(match)

                enriched = df.apply(_enrich_row, axis=1)
                df['UniqueRef'] = enriched['UniqueRef']
                df['PrimaryVendorNo'] = enriched['PrimaryVendorNo']
                df['PrimaryCompanyCode'] = enriched['PrimaryCompanyCode']
                df['Category'] = enriched['Category'].fillna('')
                df['Owner'] = enriched['Owner'].fillna('Unassigned')
                df['Team'] = enriched['Team'].fillna('')

                with_team = df['Team'].ne('').sum()
                logger.info(
                    "Enrichment: %d categorized, %d assigned, %d with Team",
                    enriched['Category'].ne('').sum(),
                    df['Owner'].ne('Unassigned').sum(),
                    with_team
                )
            except Exception as e:
                raise RuntimeError("Statement row enrichment failed; existing snapshot was preserved") from e
        else:
            # No enrichment: use first vendor/CC
            df['PrimaryCompanyCode'] = df['_target_ccs'].apply(lambda x: x[0] if x else '')
            df['PrimaryVendorNo'] = df['VendorNos'].apply(
                lambda v: _split_vendor_nos(v)[0] if _split_vendor_nos(v) else ''
            )
            df['UniqueRef'] = df.apply(
                lambda row: build_unique_ref(row['PrimaryCompanyCode'], row['PrimaryVendorNo']),
                axis=1,
            )
            df['Category'] = ''
            df['Owner'] = df['AssignedUser'].fillna('Unassigned')
            df['Team'] = ''

        # Derive country from primary company code
        df['Country'] = df['PrimaryCompanyCode'].apply(_country_from_cc)

        # Calculate Difference
        df['Difference'] = df.apply(
            lambda row: (row.get('LedgerBalance') or 0) - (row.get('StatementBalance') or 0)
            if pd.notna(row.get('LedgerBalance')) or pd.notna(row.get('StatementBalance'))
            else None,
            axis=1,
        )

        # Drop internal helper column
        df = df.drop(columns=['_target_ccs'])

        # Ensure all columns exist
        for col in ALL_COLUMNS:
            if col not in df.columns:
                df[col] = '' if col not in ('LedgerBalance', 'StatementBalance', 'Difference',
                                             'LineItems', 'ActionsPending', 'RecentChanges', 'RecID') else None

        df = df[ALL_COLUMNS]
        all_frames.append(df)
        total_rows += len(df)
        if snap not in snapshot_dates:
            snapshot_dates.append(snap)

    if not all_frames:
        raise RuntimeError("No valid statement data found")

    combined = pd.concat(all_frames, ignore_index=True)

    # Store in SQLite
    target_db_path = Path(db_path)
    with staged_database(target_db_path) as staged_db_path:
        with closing(sqlite3.connect(str(staged_db_path))) as conn:
            _init_db(conn)

            # Idempotent: delete existing data for each snapshot date
            for snap in snapshot_dates:
                conn.execute(
                    "DELETE FROM statement_lines WHERE SnapshotDate = ?",
                    (snap,),
                )

            # Insert
            combined.to_sql('statement_lines', conn, if_exists='append', index=False)

            # Update summary for each snapshot
            for snap in snapshot_dates:
                _update_summary(conn, snap)

            # Optimize and validate before staged promotion.
            conn.execute("ANALYZE")
            conn.commit()
            stored = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM statement_lines WHERE SnapshotDate IN ({','.join('?' for _ in snapshot_dates)})",
                    tuple(snapshot_dates),
                ).fetchone()[0]
            )
            if stored != len(combined) or stored <= 0:
                raise RuntimeError(
                    f"Statement staging row contract failed: expected {len(combined)}, stored {stored}"
                )

    logger.info(
        "Stored in %s: %d statement records (%d snapshot(s))",
        db_path.name, total_rows, len(snapshot_dates)
    )
    return {'statements_loaded': total_rows, 'snapshots': snapshot_dates}


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
        result = load_and_store_statements(
            synthetic_review_dir=args.input_dir,
            db_path=args.db,
            master_dir=args.master_dir,
            snapshot_date=args.snapshot_date,
        )
    except Exception as exc:
        logger.error("Statement load failed: %s", exc)
        return 1
    logger.info("Loaded: %d records, snapshots: %s", result['statements_loaded'], result['snapshots'])
    return 0 if result['statements_loaded'] > 0 and result['snapshots'] else 1


if __name__ == "__main__":
    raise SystemExit(main())
