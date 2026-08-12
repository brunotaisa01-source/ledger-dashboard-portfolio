#!/usr/bin/env python3
"""
AP CONTROL DASHBOARD V19 - Data Module
Data loading from SQLite, trend cube computation, SyntheticReview loading, data JS generation.
Split from Rol_Query.py for maintainability.
"""

import re
import sqlite3
import json
import zlib
import base64
import hashlib
import csv
from dataclasses import dataclass
from contextlib import closing
from datetime import date, datetime, timedelta
from typing import Any, Dict, List

from ..utils.paths import DB_DIR, SYNTHETIC_REVIEW_DB, ESCALATION_DB, STOREBOOK_ZR_DB, CHUNKS_DIR, MASTER_DATA
from .dashboard_config import (
    SQLITE_PATH, KEY_SQLITE_PATH, DASHBOARD_YEAR, CURRENCY_MAP, SYNTHETIC_REVIEW_SHORT_KEYS,
    STATEMENT_SHORT_KEYS, _normalize_vc, OUTPUT_CUBE_LEDGER,
)
from ..utils.log import get_logger
from ..utils.db_helpers import configure_connection
from ..utils.file_sync import atomic_write_text

log = get_logger(__name__)

# Module-level cache populated by generate_data_js() after weeks_data is assembled.
PRODUCTIVITY_TREND: list = []
PRODUCTIVITY_SCORECARD: list[dict[str, Any]] = []
RESOLVED_CARRYOVER_AUDIT: dict[str, Any] = {}
RESOLVED_CARRYOVER_DB = DB_DIR / "productivity_audit.sqlite"
PRODUCTIVITY_CACHE_VERSION = "2026-06-23-v1"
PRODUCTIVITY_CACHE_DIR = DB_DIR / "productivity_cache"

ESCALATION_SHORT_KEYS = {
    'UniqueKey': 'uk',
    'VendorNo': 'vn',
    'VendorName': 'vname',
    'Entity': 'ent',
    'EntityCode': 'ec',
    'Mailbox': 'mb',
    'Category': 'cat',
    'ActionType': 'act',
    'Status': 'st',
    'IsOpen': 'io',
    'Priority': 'pri',
    'APOwner': 'apo',
    'ReceivedDate': 'rd',
    'EscalationDate': 'ed',
    'DateResolved': 'dr',
    'DaysToResolveSource': 'dtrs',
    'DaysToResolveCalc': 'dtrc',
    'DaysOpen': 'do',
    'Value': 'val',
    'ValueRaw': 'vr',
    'Flags': 'fl',
}



@dataclass
class ResolvedDoc:
    """Document-level record used for resolved carryover matching."""

    key: tuple[str, ...]
    confidence: str
    source: set[str]
    team: set[str]
    owner: str
    company_code: str
    supplier: str
    supplier_name: str
    country: str
    document_number: str
    reference: str
    document_type: str
    amount: float
    amount_key: str
    match_reason: str
    currency: str
    status: str
    action_date: str
    query_type: str
    comment: str
    next_step: str
    vendor_category: str
    line_count: int = 0

# 
# COLUMN IDENTIFIER VALIDATION
# 

_COL_PATTERN = re.compile(r'^[A-Za-z0-9_ ()\-/>.]+$')


def _safe_col_id(name: str) -> str:
    """Validate a column identifier before SQL f-string interpolation.

    Allows alphanumeric characters, spaces, underscores, hyphens, parentheses,
    forward slashes, dots, and ``>``  the full set used by real DB column
    names in this codebase (e.g. ``180> Days Overdue``).

    Critically blocks SQL injection characters: ``"``, ``'``, ``;``, backtick,
    ``=``, newlines, and null bytes.

    Args:
        name: The column name string to validate.

    Returns:
        The original name unchanged if it passes validation.

    Raises:
        ValueError: If the name contains suspicious characters.
    """
    if not _COL_PATTERN.match(name):
        raise ValueError(f"Suspicious column name: {name!r}")
    return name


# 
# DATABASE UTILITIES
# 

def detect_column_mapping(conn, table: str = "ledger_lines") -> Dict[str, str]:
    """Auto-detect column names from database schema.

    Works for both ``ledger_lines`` and ``key_lines``  the column name
    mapping is identical across both tables.
    """
    _ALLOWED_TABLES = {"ledger_lines", "key_lines"}
    if table not in _ALLOWED_TABLES:
        raise ValueError(f"Invalid table: {table!r} (allowed: {_ALLOWED_TABLES})")
    # SELECT * intentional  need .description to get ALL column names for mapping
    cursor = conn.execute(f'SELECT * FROM "{table}" LIMIT 1')
    actual_columns = [desc[0] for desc in cursor.description]

    mapping = {}

    name_mapping = {
        'Sheet': ['Sheet', 'Team', 'sheet'],
        'Owner': ['Owner', 'owner'],
        'Supplier': ['Supplier', 'SupplierNumber', 'Vendor', 'supplier'],
        'SupplierName': ['Name 1', 'SupplierName', 'Supplier Name', 'name'],
        'Country': ['Country', 'country'],
        'CompanyCode': ['Company Code', 'CompanyCode', 'company_code'],
        'TotalAmount': ['Amount in doc. curr.', 'TotalAmount', 'Amount'],
        'Currency': ['Document currency', 'Currency', 'Curr'],
        'Aged_0_30': ['0-30 Days overdue', 'Aged_0_30'],
        'Aged_31_60': ['31-60 Days overdue', 'Aged_31_60'],
        'Aged_61_90': ['61-90 Days overdue', 'Aged_61_90'],
        'Aged_91_120': ['91-120 Days Overdue', 'Aged_91_120'],
        'Aged_121_180': ['121-180 Days Overdue', 'Aged_121_180'],
        'Aged_180_plus': ['180> Days Overdue', 'Aged_180_plus'],
        'ActionDate': ['Action Date', 'ActionDate'],
        'NextStep': ['Next Step', 'NextStep'],
        'Comment': ['AP Specialist comment', 'Comment'],
        'QueryType': ['Query type', 'QueryType'],
        'Status': ['Status', 'status'],
        'WeekStartISO': ['WeekStartISO', 'Week'],
        'RowLevel': ['RowLevel', 'rowlevel'],
        'TotalValue': ['TOTAL VALUE', 'Total Value', 'TOTAL_VALUE', 'TotalValue'],
        'TotalVol': ['TOTAL VOL', 'Total Vol', 'TOTAL_VOL', 'TotalVol'],
        'VendorCategory': ['Vendor category', 'VendorCategory', 'vendor_category'],
        'PaymentBlock': ['Payment Block', 'PaymentBlock', 'payment_block'],
    }

    for target_name, possible_names in name_mapping.items():
        found = False
        for poss in possible_names:
            if poss in actual_columns:
                mapping[target_name] = poss
                found = True
                break
        if not found:
            mapping[target_name] = f"'{target_name}_NOT_FOUND'"

    tag = "KEY" if table == "key_lines" else "DB"
    critical_columns = ['TotalValue', 'TotalVol', 'TotalAmount', 'Aged_0_30', 'Aged_31_60',
                        'Aged_61_90', 'Aged_91_120', 'Aged_121_180', 'Aged_180_plus',
                        'RowLevel', 'Sheet', 'Supplier', 'Owner', 'Country']
    missing = [c for c in critical_columns if mapping.get(c, '').startswith("'")]
    if missing:
        log.warning("[%s] Critical columns not found in %s: %s", tag, table, missing)
        log.warning("[%s]    Available columns: %s", tag, actual_columns)

    return mapping


_EXCEL_SERIAL_DATE_RE = re.compile(r'^\d+(?:\.\d+)?$')
_EXCEL_DATE_EPOCH = datetime(1899, 12, 30)


def _parse_dashboard_date(value: Any) -> datetime | None:
    """Parse dashboard date values, including Excel serial dates from SQLite."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())

    raw = str(value).strip()
    if not raw:
        return None

    for fmt_str in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(raw, fmt_str)
        except ValueError:
            continue

    if _EXCEL_SERIAL_DATE_RE.match(raw):
        try:
            serial = float(raw)
        except ValueError:
            return None
        if 1 <= serial <= 60000:
            return _EXCEL_DATE_EPOCH + timedelta(days=serial)

    return None


def _net_due(row: dict) -> tuple[str, bool]:
    """Net due date, fallback to Document Date + 30 days. Returns (nd_str, is_estimated)."""
    nd = str(row.get('NetDueDate') or '').strip()
    if nd:
        parsed_net_due = _parse_dashboard_date(row.get('NetDueDate'))
        if parsed_net_due:
            return parsed_net_due.strftime('%d-%m-%Y'), False
        log.warning("_net_due: unparseable NetDueDate '%s' for row %s", nd, row.get('UniqueRef', '?'))
        # fall through to DocumentDate fallback
    dd = str(row.get('DocumentDate') or '').strip()
    if dd:
        parsed_document_date = _parse_dashboard_date(row.get('DocumentDate'))
        if parsed_document_date:
            return (parsed_document_date + timedelta(days=30)).strftime('%d-%m-%Y'), True
        log.warning("_net_due: unparseable date '%s' for row %s", dd, row.get('UniqueRef', '?'))
    return '', False


def safe_float(value) -> float:
    try:
        return float(value) if value is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def get_currency(country: str) -> str:
    if not country:
        return 'EUR'
    cu = str(country).upper().strip()
    for key, currency in CURRENCY_MAP.items():
        if key in cu or cu in key:
            return currency
    return 'EUR'


def escape_html(s: str) -> str:
    if not s:
        return ''
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


_QUERY_TYPE_ALIASES = {
    'dd payment': 'DD Payment',
    'misc': 'Other Misc',
    'misc payment': 'Misc Payments',
    'misc payments': 'Misc Payments',
    'missing payment': 'Missing payment',
    'wrong posting': 'Posting Error',
    'erp error': 'Posting Error',
    'kind regards,': 'Other Misc',
    'synthetic sender note': 'Other Misc',
    'SYN-CC-001 // erp3': 'Other Misc',
}


_STATUS_ALIASES = {
    'awaiting adjustment': 'Awaiting Adjustment',
    'awaiting adjustment, account in credit': 'Awaiting Adjustment',
    'germany vendor awaiting adjustment, account in credit': 'Awaiting Adjustment',
    'awaiting allocation': 'Awaiting Allocation',
    'awaiting dd': 'Awaiting DD',
    'awaiting manual posting': 'Awaiting Manual Posting',
    'awaiting payment': 'Awaiting Payment Run',
    'awaiting payment - bau': 'Awaiting Payment - BAU',
    'awaiting payment run': 'Awaiting Payment Run',
    'awaiting pr': 'Awaiting PR',
    'awaiting approval': 'Documation - Awaiting Approval',
    'waiting approval': 'Documation - Awaiting Approval',
    'awaitng clearing': 'Cleared',
    'bau': 'BAU',
    'cleared': 'Cleared',
    'cleared w/o': 'Cleared W/O',
    'copy requested': 'Copy Requested',
    'copy requested sent to ip': 'Copy Requested Sent To IP',
    'disputed': 'Disputed',
    'documation - awaiting approval': 'Documation - Awaiting Approval',
    'documation - awaiting posting': 'Documation - Awaiting Posting',
    'documents requested': 'Documents Requested',
    'due for payment': 'Awaiting Payment Run',
    'in documation - awaiting approval': 'Documation - Awaiting Approval',
    'in documation - pending processing': 'Documation - Pending Processing',
    'in progress': 'In Progress',
    'internal error': 'Internal Error',
    'invoices ready for payments run': 'Awaiting Payment Run',
    'missing invoices': 'Missing Invoices',
    'missing invoice/credit note': 'Missing Invoice/Credit Note',
    'n/a': '',
    'not due': 'Not Due',
    'not due yet': 'Not Due',
    'open': 'Open',
    'pending': 'Pending',
    'pending investigation': 'Pending Investigation',
    'resolved': 'Resolved',
    'with manual postings': 'Awaiting Manual Posting',
}


def _normalize_query_type(value: str) -> str:
    """Return a dashboard-safe Query Type label."""
    cleaned = re.sub(r'\s+', ' ', str(value or '').replace('\xa0', ' ')).strip()
    if not cleaned:
        return ''

    folded = cleaned.casefold()
    if folded in _QUERY_TYPE_ALIASES:
        return _QUERY_TYPE_ALIASES[folded]
    if 'relevant invoice' in folded and ('refund' in folded or 'payment' in folded):
        return 'Missing Documents'
    return cleaned


def _normalize_sheet_team(value: object) -> str:
    """Return active dashboard team label; legacy Query is part of ROL."""
    raw = str(value or '').strip()
    folded = raw.upper()
    if folded == 'QUERY':
        return 'ROL'
    if folded == 'KEY':
        return 'KEY'
    if folded == 'ROL':
        return 'ROL'
    return raw


def _normalize_status(value: str) -> str:
    """Return a dashboard-safe Status label."""
    cleaned = re.sub(r'\s+', ' ', str(value or '').replace('\xa0', ' ')).strip()
    if not cleaned:
        return ''

    folded = cleaned.casefold()
    if folded in _STATUS_ALIASES:
        return _STATUS_ALIASES[folded]
    if folded.startswith('awaiting pr //'):
        return 'Awaiting PR'
    if folded.startswith('missing invoice/credit note'):
        return 'Missing Invoice/Credit Note'
    if 'missing invoice/credit note' in folded or 'provide an invoice' in folded:
        return 'Missing Invoice/Credit Note'
    if 'requested statement from the supplier' in folded or 'statement requested' in folded:
        return 'Documents Requested'
    if 'requested copies' in folded or 'request more information' in folded:
        return 'Documents Requested'
    if 'posted' in folded or 'manual posting' in folded:
        return 'Awaiting Manual Posting'
    if 'duplicated payment' in folded or 'dd taken' in folded:
        return 'Awaiting DD'
    if 'handled by team' in folded or 'emaile francec' in folded:
        return 'In Progress'
    if 'unable to get any doucment' in folded or 'unable to get any document' in folded:
        return 'Documents Requested'
    return cleaned


def _current_week_filter_values(weeks_data: Dict[str, Any]) -> dict[str, list[str]]:
    """Extract owner/query filters from the latest loaded dashboard week."""
    if not weeks_data:
        return {'owners': [], 'query_types': [], 'statuses': []}

    latest_week = max(weeks_data)
    latest_rows = weeks_data.get(latest_week, {}).get('raw', [])
    owner_exclude = {'Rol Uncategorised', 'Key Uncategorised'}
    owners = sorted({
        str(row.get('o') or '').strip()
        for row in latest_rows
        if str(row.get('o') or '').strip()
    } - owner_exclude)
    query_types = sorted({
        str(row.get('qt') or '').strip()
        for row in latest_rows
        if str(row.get('qt') or '').strip()
    })
    statuses = sorted({
        str(row.get('st') or '').strip()
        for row in latest_rows
        if str(row.get('st') or '').strip()
    })
    return {'owners': owners, 'query_types': query_types, 'statuses': statuses}


# 
# DATA LOADING
# 

def load_data_from_sqlite(core_week_count: int | None = None) -> Dict[str, Any]:
    if not SQLITE_PATH.exists():
        raise FileNotFoundError(f"SQLite database not found: {SQLITE_PATH}")

    log.info("[DB] Opening database: %s", SQLITE_PATH)
    with closing(sqlite3.connect(str(SQLITE_PATH))) as conn:
        configure_connection(conn)
        conn.row_factory = sqlite3.Row

        # Detect columns
        column_mapping = detect_column_mapping(conn)
        log.info("[OK] Detected column mapping")

        # Get weeks
        week_col = column_mapping['WeekStartISO']
        if week_col.startswith("'"):
            raise ValueError("WeekStartISO column not found")

        _safe_week_col = _safe_col_id(week_col)
        sql_weeks = f'SELECT DISTINCT "{_safe_week_col}" FROM ledger_lines WHERE "{_safe_week_col}" IS NOT NULL ORDER BY "{_safe_week_col}" DESC'
        all_weeks = [row[0] for row in conn.execute(sql_weeks).fetchall()]

        if not all_weeks:
            raise ValueError("No data found!")

        # Apply year filter if DASHBOARD_YEAR is set
        if DASHBOARD_YEAR is not None:
            year_str = str(DASHBOARD_YEAR)
            prev_year_str = str(DASHBOARD_YEAR - 1)

            year_weeks = [w for w in all_weeks if w.startswith(year_str)]

            prev_year_weeks = sorted([w for w in all_weeks if w.startswith(prev_year_str)])
            last_prev_week = prev_year_weeks[-1] if prev_year_weeks else None

            if last_prev_week and len(year_weeks) <= 2:
                weeks = sorted(year_weeks + [last_prev_week])
            else:
                weeks = sorted(year_weeks)

            total_in_db = len(all_weeks)
            log.info("[FILTER] DASHBOARD_YEAR=%s: %d of %d weeks selected%s",
                     DASHBOARD_YEAR, len(weeks), total_in_db,
                     f" (includes {last_prev_week} for comparison)" if last_prev_week and len(year_weeks) <= 2 else "")
        else:
            weeks = all_weeks

        weeks_to_load = weeks
        if core_week_count is not None and core_week_count > 0:
            weeks_to_load = sorted(weeks, reverse=True)[:core_week_count]
            log.info("[OK] Loading %d of %d weeks (incremental core)", len(weeks_to_load), len(weeks))
        else:
            log.info("[OK] Loading %d weeks", len(weeks))

        # Get filter options
        def _distinct_values(col_name):
            col = column_mapping.get(col_name, col_name)
            if col.startswith("'"):
                return []
            safe_col = _safe_col_id(col)
            return sorted(row[0] for row in conn.execute(
                f'SELECT DISTINCT "{safe_col}" FROM ledger_lines WHERE "{safe_col}" IS NOT NULL ORDER BY "{safe_col}"'
            ).fetchall() if row[0])

        _VALID_COUNTRIES = {'UK', 'FRANCE', 'GERMANY', 'BENELUX', 'ITALY'}
        countries = [c for c in _distinct_values('Country') if c and c.upper() in _VALID_COUNTRIES]
        company_codes = _distinct_values('CompanyCode')
        _raw_vc = _distinct_values('VendorCategory')
        vendor_categories = sorted(set(_normalize_vc(v) for v in _raw_vc))
        payment_blocks = [pb for pb in _distinct_values('PaymentBlock') if pb.strip()]

        # Build dynamic SQL for week data
        cols = {k: _safe_col_id(v) for k, v in column_mapping.items() if not v.startswith("'")}
        # Restore sentinel values for missing columns (they are guarded above and never reach SQL)
        for k, v in column_mapping.items():
            if k not in cols:
                cols[k] = v
        sql_week_data = f'''
        SELECT
            "{cols['Sheet']}" as Sheet,
            "{cols['Owner']}" as Owner,
            "{cols['Supplier']}" as Supplier,
            "{cols['SupplierName']}" as SupplierName,
            "{cols['Country']}" as Country,
            "{cols['CompanyCode']}" as CompanyCode,
            "{cols['TotalAmount']}" as TotalAmount,
            "{cols['Currency']}" as Currency,
            "{cols['Aged_0_30']}" as Aged_0_30,
            "{cols['Aged_31_60']}" as Aged_31_60,
            "{cols['Aged_61_90']}" as Aged_61_90,
            "{cols['Aged_91_120']}" as Aged_91_120,
            "{cols['Aged_121_180']}" as Aged_121_180,
            "{cols['Aged_180_plus']}" as Aged_180_plus,
            "{cols['ActionDate']}" as ActionDate,
            "{cols['NextStep']}" as NextStep,
            "{cols['Comment']}" as Comment,
            "{cols['QueryType']}" as QueryType,
            "{cols['Status']}" as Status,
            "{cols['RowLevel']}" as RowLevel,
            "{cols['TotalValue']}" as TotalValue,
            "{cols['TotalVol']}" as TotalVol,
            "System" as System,
            "Document Type" as DocumentType,
            "Document Number" as DocumentNumber,
            "Reference" as Reference,
            "{cols['VendorCategory']}" as VendorCategory,
            "{cols['PaymentBlock']}" as PaymentBlock,
            "Net due date" as NetDueDate,
            "Document Date" as DocumentDate
        FROM ledger_lines WHERE "{cols['WeekStartISO']}" = ?
        '''

        weeks_data = {}
        for week in weeks_to_load:
            log.info("  [..] Processing %s...", week)
            rows = [dict(row) for row in conn.execute(sql_week_data, (week,)).fetchall()]

            raw_rows = []
            for row in rows:
                row_data = {
                    'sh': _normalize_sheet_team(row.get('Sheet')),
                    'o': str(row.get('Owner') or '').strip().title(),
                    's': str(row.get('Supplier') or '').strip().removesuffix('.0'),
                    'sn': escape_html(str(row.get('SupplierName') or '')[:50]),
                    'co': str(row.get('Country') or '').strip(),
                    'cc': str(row.get('CompanyCode') or '').strip(),
                    'rl': str(row.get('RowLevel') or '').strip(),
                    'tv': safe_float(row.get('TotalValue', 0)),
                    'vv': safe_float(row.get('TotalVol', 0)),
                    'a': safe_float(row.get('TotalAmount', 0)),
                    'cur': str(row.get('Currency') or '').strip() or get_currency(row.get('Country', '')),
                    'a030': safe_float(row.get('Aged_0_30', 0)),
                    'a3160': safe_float(row.get('Aged_31_60', 0)),
                    'a6190': safe_float(row.get('Aged_61_90', 0)),
                    'a91120': safe_float(row.get('Aged_91_120', 0)),
                    'a121180': safe_float(row.get('Aged_121_180', 0)),
                    'a180': safe_float(row.get('Aged_180_plus', 0)),
                    'ad': str(row.get('ActionDate') or '').strip(),
                    'ns': str(row.get('NextStep') or '').strip(),
                    'cm': str(row.get('Comment') or '').strip(),
                    'qt': _normalize_query_type(str(row.get('QueryType') or '')),
                    'sys': str(row.get('System') or '').strip().upper(),
                    'st': _normalize_status(str(row.get('Status') or '')),
                    'dt': str(row.get('DocumentType') or '').upper().strip().replace('ZO', 'Z0'),
                    'dn': str(row.get('DocumentNumber') or '').strip().removesuffix('.0'),
                    'rn': str(row.get('Reference') or '').strip().removesuffix('.0'),
                    'vc': _normalize_vc(str(row.get('VendorCategory') or '')),
                    'pb': str(row.get('PaymentBlock') or '').strip().replace('\xa0', ''),
                }
                nd_val, nd_est = _net_due(row)
                if nd_val:
                    row_data['nd'] = nd_val
                if nd_est:
                    row_data['nde'] = 1
                raw_rows.append(row_data)

            weeks_data[week] = {'raw': raw_rows}

    log.info("[OK] Data loaded!")
    current_filters = _current_week_filter_values(weeks_data)
    owners = current_filters['owners']
    query_types = current_filters['query_types']
    statuses = current_filters['statuses']
    log.info("[OK] Countries: %d | Companies: %d | Owners: %d | Vendor Categories: %d | Payment Blocks: %d",
             len(countries), len(company_codes), len(owners), len(vendor_categories), len(payment_blocks))

    return {
        'weeks_data': weeks_data,
        'countries': countries,
        'company_codes': company_codes,
        'statuses': statuses,
        'query_types': query_types,
        'owners': owners,
        'vendor_categories': vendor_categories,
        'payment_blocks': payment_blocks,
        'all_weeks': weeks,
        'loaded_weeks': weeks_to_load,
    }


# 
# KEY TEAM DATA LOADING
# 

def detect_column_mapping_key(conn) -> Dict[str, str]:
    """Convenience wrapper  calls ``detect_column_mapping(conn, 'key_lines')``."""
    return detect_column_mapping(conn, table="key_lines")


def load_key_from_sqlite(core_week_count: int | None = None) -> Dict[str, Any]:
    """Load Key team data from key_weekly.sqlite.
    Returns dict with 'weeks_data' or None if DB missing/empty.
    """
    if not KEY_SQLITE_PATH.exists():
        log.warning("[KEY] Database not found: %s", KEY_SQLITE_PATH)
        return None

    log.info("[KEY] Opening database: %s", KEY_SQLITE_PATH)
    with closing(sqlite3.connect(str(KEY_SQLITE_PATH))) as conn:
        configure_connection(conn)
        conn.row_factory = sqlite3.Row

        column_mapping = detect_column_mapping_key(conn)
        log.info("[KEY] Detected column mapping")

        week_col = column_mapping['WeekStartISO']
        if week_col.startswith("'"):
            log.warning("[KEY] WeekStartISO column not found in key_lines")
            return None

        _safe_week_col = _safe_col_id(week_col)
        sql_weeks = f'SELECT DISTINCT "{_safe_week_col}" FROM key_lines WHERE "{_safe_week_col}" IS NOT NULL ORDER BY "{_safe_week_col}" DESC'
        all_weeks = [row[0] for row in conn.execute(sql_weeks).fetchall()]

        if not all_weeks:
            log.warning("[KEY] No data found in key_weekly.sqlite")
            return None

        # Apply same year filter as ledger
        if DASHBOARD_YEAR is not None:
            year_str = str(DASHBOARD_YEAR)
            prev_year_str = str(DASHBOARD_YEAR - 1)
            year_weeks = [w for w in all_weeks if w.startswith(year_str)]
            prev_year_weeks = sorted([w for w in all_weeks if w.startswith(prev_year_str)])
            last_prev_week = prev_year_weeks[-1] if prev_year_weeks else None
            if last_prev_week and len(year_weeks) <= 2:
                weeks = sorted(year_weeks + [last_prev_week])
            else:
                weeks = sorted(year_weeks)
            log.info("[KEY] DASHBOARD_YEAR=%s: %d of %d weeks selected", DASHBOARD_YEAR, len(weeks), len(all_weeks))
        else:
            weeks = all_weeks

        weeks_to_load = weeks
        if core_week_count is not None and core_week_count > 0:
            weeks_to_load = sorted(weeks, reverse=True)[:core_week_count]
            log.info("[KEY] Loading %d of %d weeks (incremental core)", len(weeks_to_load), len(weeks))
        else:
            log.info("[KEY] Loading %d weeks", len(weeks))

        cols = {k: _safe_col_id(v) for k, v in column_mapping.items() if not v.startswith("'")}
        # Restore sentinel values for missing columns (never reach SQL  guarded above)
        for k, v in column_mapping.items():
            if k not in cols:
                cols[k] = v
        sql_week_data = f'''
        SELECT
            "{cols['Sheet']}" as Sheet,
            "{cols['Owner']}" as Owner,
            "{cols['Supplier']}" as Supplier,
            "{cols['SupplierName']}" as SupplierName,
            "{cols['Country']}" as Country,
            "{cols['CompanyCode']}" as CompanyCode,
            "{cols['TotalAmount']}" as TotalAmount,
            "{cols['Currency']}" as Currency,
            COALESCE(NULLIF(CAST("0-30 Days overdue" AS REAL), 0), NULLIF(CAST("07-30 Days overdue (Unified)" AS REAL), 0), NULLIF(CAST("07-30 Days overdue" AS REAL), 0), 0) as Aged_0_30,
            "{cols['Aged_31_60']}" as Aged_31_60,
            "{cols['Aged_61_90']}" as Aged_61_90,
            "{cols['Aged_91_120']}" as Aged_91_120,
            "{cols['Aged_121_180']}" as Aged_121_180,
            "{cols['Aged_180_plus']}" as Aged_180_plus,
            "{cols['ActionDate']}" as ActionDate,
            "{cols['NextStep']}" as NextStep,
            "{cols['Comment']}" as Comment,
            "{cols['QueryType']}" as QueryType,
            "{cols['Status']}" as Status,
            "{cols['RowLevel']}" as RowLevel,
            "{cols['TotalValue']}" as TotalValue,
            "{cols['TotalVol']}" as TotalVol,
            "System" as System,
            "Document Type" as DocumentType,
            "Document Number" as DocumentNumber,
            "Reference" as Reference,
            "{cols['VendorCategory']}" as VendorCategory,
            "{cols['PaymentBlock']}" as PaymentBlock,
            "Net due date" as NetDueDate,
            "Document Date" as DocumentDate
        FROM key_lines WHERE "{cols['WeekStartISO']}" = ?
        '''

        weeks_data = {}
        for week in weeks_to_load:
            log.info("  [KEY] Processing %s...", week)
            rows = [dict(row) for row in conn.execute(sql_week_data, (week,)).fetchall()]

            raw_rows = []
            for row in rows:
                row_data = {
                    'sh': 'KEY',
                    'o': str(row.get('Owner') or '').strip().title(),
                    's': str(row.get('Supplier') or '').strip().removesuffix('.0'),
                    'sn': escape_html(str(row.get('SupplierName') or '')[:50]),
                    'co': str(row.get('Country') or '').strip(),
                    'cc': str(row.get('CompanyCode') or '').strip(),
                    'rl': str(row.get('RowLevel') or '').strip(),
                    'tv': safe_float(row.get('TotalValue', 0)),
                    'vv': safe_float(row.get('TotalVol', 0)),
                    'a': safe_float(row.get('TotalAmount', 0)),
                    'cur': str(row.get('Currency') or '').strip() or get_currency(row.get('Country', '')),
                    'a030': safe_float(row.get('Aged_0_30', 0)),
                    'a3160': safe_float(row.get('Aged_31_60', 0)),
                    'a6190': safe_float(row.get('Aged_61_90', 0)),
                    'a91120': safe_float(row.get('Aged_91_120', 0)),
                    'a121180': safe_float(row.get('Aged_121_180', 0)),
                    'a180': safe_float(row.get('Aged_180_plus', 0)),
                    'ad': str(row.get('ActionDate') or '').strip(),
                    'ns': str(row.get('NextStep') or '').strip(),
                    'cm': str(row.get('Comment') or '').strip(),
                    'qt': _normalize_query_type(str(row.get('QueryType') or '')),
                    'sys': str(row.get('System') or '').strip().upper(),
                    'st': _normalize_status(str(row.get('Status') or '')),
                    'dt': str(row.get('DocumentType') or '').upper().strip().replace('ZO', 'Z0'),
                    'dn': str(row.get('DocumentNumber') or '').strip().removesuffix('.0'),
                    'rn': str(row.get('Reference') or '').strip().removesuffix('.0'),
                    'vc': _normalize_vc(str(row.get('VendorCategory') or '')),
                    'pb': str(row.get('PaymentBlock') or '').strip().replace('\xa0', ''),
                }
                nd_val, nd_est = _net_due(row)
                if nd_val:
                    row_data['nd'] = nd_val
                if nd_est:
                    row_data['nde'] = 1
                raw_rows.append(row_data)

            weeks_data[week] = {'raw': raw_rows}

    log.info("[KEY] Data loaded: %d weeks", len(weeks_data))

    return {'weeks_data': weeks_data, 'all_weeks': weeks, 'loaded_weeks': weeks_to_load}


def merge_key_and_ledger(ledger_data: Dict[str, Any], key_data: Dict[str, Any]) -> Dict[str, Any]:
    """Merge Key team data into Ledger data structure.
    Combines weeks_data (per-week row concat) and unifies filter lists.
    If key_data is None, returns ledger_data unchanged.
    """
    if not key_data:
        return ledger_data

    log.info("[MERGE] Merging Key data into Ledger data...")

    merged = {k: v for k, v in ledger_data.items() if k != 'weeks_data'}
    ledger_weeks = ledger_data['weeks_data']
    key_weeks = key_data['weeks_data']
    ledger_all_weeks = ledger_data.get('all_weeks', list(ledger_weeks.keys()))
    key_all_weeks = key_data.get('all_weeks', list(key_weeks.keys()))
    ledger_loaded_weeks = ledger_data.get('loaded_weeks', list(ledger_weeks.keys()))
    key_loaded_weeks = key_data.get('loaded_weeks', list(key_weeks.keys()))

    # Merge per-week raw rows
    all_week_keys = set(ledger_weeks.keys()) | set(key_weeks.keys())
    merged_weeks = {}
    for week in all_week_keys:
        ledger_raw = ledger_weeks.get(week, {}).get('raw', [])
        key_raw = key_weeks.get(week, {}).get('raw', [])
        merged_weeks[week] = {'raw': ledger_raw + key_raw}
    merged['weeks_data'] = merged_weeks
    merged['all_weeks'] = sorted(set(ledger_all_weeks) | set(key_all_weeks))
    merged['loaded_weeks'] = sorted(set(ledger_loaded_weeks) | set(key_loaded_weeks))

    # Extract unique values from Key data for filters (single-pass)
    _KEY_FILTER_KEYS = ('o', 'co', 'cc', 'st', 'qt', 'vc', 'pb')
    key_distinct = {k: set() for k in _KEY_FILTER_KEYS}
    for week_data in key_weeks.values():
        for row in week_data.get('raw', []):
            for k in _KEY_FILTER_KEYS:
                val = row.get(k)
                if val:
                    key_distinct[k].add(val.strip() if k == 'pb' else val)

    _OWNER_EXCLUDE = {'Rol Uncategorised', 'Key Uncategorised'}
    merged['countries'] = sorted(set(merged['countries']) | key_distinct['co'])
    merged['company_codes'] = sorted(set(merged['company_codes']) | key_distinct['cc'])
    merged['vendor_categories'] = sorted(set(merged['vendor_categories']) | key_distinct['vc'])
    merged['payment_blocks'] = sorted(set(merged['payment_blocks']) | key_distinct['pb'])
    current_filters = _current_week_filter_values(merged_weeks)
    merged['owners'] = sorted(set(current_filters['owners']) - _OWNER_EXCLUDE)
    merged['query_types'] = current_filters['query_types']
    merged['statuses'] = current_filters['statuses']

    log.info("[MERGE] Done: %d weeks, %d owners total", len(all_week_keys), len(merged['owners']))

    return merged


# 
# YEAR TREND CUBE
# 

def compute_year_trend_cube(weeks_data: Dict[str, Any], sorted_weeks: List[str]) -> Dict[str, Any]:
    """
    Pre-compute YEAR_TREND_CUBE for instant trend rendering.
    Stores per-week granular data as flat arrays indexed by (week_index, combo_index).
    """
    DOC_TYPES_KPI = {
        "ERP1": {"payment": {"KZ", "SA", "ZP", "AB"}, "invoice": {"KA", "KD", "KR", "Y0", "Z0"}, "credit_note": {"Z2", "KG"}},
        "ERP2": {"payment": {"KA", "KM", "KZ", "SE", "ZP", "AB"}, "invoice": {"KR", "KS", "RB", "RE", "Y0", "Z0", "1H", "UE"}, "credit_note": {"Z2", "KN", "KG"}},
        "ERP3": {"payment": {"K1", "K3", "K5", "KA", "KS", "SA", "ZB"}, "invoice": {"KD", "KR", "RE", "Y0", "Z0", "ZO", "SX"}, "credit_note": {"Z2"}},
        "UK":  {"payment": {"KZ", "SA", "ZP", "ZR", "AB", "SU"}, "invoice": {"KR", "RE"}, "credit_note": {"KG"}},
        "ERP4": {"payment": {"DZ", "KZ", "RK", "SA", "ZP"}, "invoice": {"KD", "KR", "ST", "VK", "Y0", "Z0", "ZC", "L3", "ZE"}, "credit_note": {"Z2", "KG"}},
    }

    def doc_key(row):
        sys_val = (row.get('sys') or '').upper().strip()
        co_val = (row.get('co') or '').upper().strip()
        if sys_val in ("ERP1", "ERP2", "ERP3", "ERP4"):
            return sys_val
        if co_val in ("UK", "GB", "UNITED KINGDOM"):
            return "UK"
        return ""

    def doc_category(row):
        key = doc_key(row)
        dt_val = (row.get('dt') or '').upper().strip()
        amt = float(row.get('a') or 0)
        kpi_map = DOC_TYPES_KPI.get(key)
        if not kpi_map or not dt_val:
            return ""
        if dt_val in kpi_map.get("credit_note", set()):
            return "CREDIT_NOTE"
        if dt_val in kpi_map["payment"]:
            return "PAYMENT"
        if dt_val in kpi_map["invoice"]:
            return "INVOICE" if amt < 0 else "CREDIT_NOTE"
        return ""

    def balance_type_str(val):
        if val > 0:
            return "DEBIT"
        elif val < 0:
            return "CREDIT"
        return ""

    weeks_ordered = list(reversed(sorted_weeks))
    n_weeks = len(weeks_ordered)
    log.info("  [..] Computing Year Trend Cube for %d weeks...", n_weeks)

    combo_map = {}
    combo_list = []

    def get_combo_idx(co, cc, st, qt, ow, sh, bal, dc, vc, pb):
        k = (co, cc, st, qt, ow, sh, bal, dc, vc, pb)
        if k not in combo_map:
            idx = len(combo_list)
            combo_map[k] = idx
            combo_list.append({
                'co': co, 'cc': cc, 'st': st, 'qt': qt, 'ow': ow,
                'sh': sh, 'bal': bal, 'dc': dc, 'vc': vc, 'pb': pb,
                'tv': [0.0] * n_weeks,
                'sv': [0] * n_weeks,
                'dv': [0.0] * n_weeks,
            })
        return combo_map[k]

    for wi, week in enumerate(weeks_ordered):
        week_raw = weeks_data.get(week, {}).get('raw', [])
        if not week_raw:
            continue

        headers = [r for r in week_raw if (r.get('rl') or '').upper() == 'HEADER']
        details = [r for r in week_raw if (r.get('rl') or '').upper() == 'DETAIL']

        supplier_cats = {}
        supplier_pbs = {}
        # Count DETAIL rows per supplier|cc for accurate doc volume
        detail_counts = {}
        for d in details:
            s = d.get('s', '')
            if not s:
                continue
            dc_key = s + '|' + (d.get('cc') or '')
            detail_counts[dc_key] = detail_counts.get(dc_key, 0) + 1
            cat = doc_category(d)
            if cat:
                supplier_cats.setdefault(s, set()).add(cat)
            dpb = (d.get('pb') or '').strip()
            if dpb:
                supplier_pbs.setdefault(s, set()).add(dpb)

        base_groups = {}
        for h in headers:
            s = h.get('s', '')
            if not s:
                continue
            sh = (h.get('sh') or '').upper().strip()
            co = h.get('co') or ''
            cc = h.get('cc') or ''
            st = h.get('st') or ''
            qt = h.get('qt') or ''
            ow = h.get('o') or ''
            vc = h.get('vc') or ''
            tv = float(h.get('tv') or 0)
            dc_key = s + '|' + cc
            dv = detail_counts.get(dc_key, 0)
            bal = balance_type_str(tv)

            pb_values = ['']
            spbs = supplier_pbs.get(s, set())
            for spb in spbs:
                if spb not in pb_values:
                    pb_values.append(spb)

            for pb in pb_values:
                base_key = (co, cc, st, qt, ow, sh, bal, vc, pb)
                if base_key not in base_groups:
                    base_groups[base_key] = {'tv': 0.0, 'dv': 0, 'suppliers': {}}
                grp = base_groups[base_key]
                grp['tv'] += tv
                grp['dv'] += dv
                if s not in grp['suppliers']:
                    grp['suppliers'][s] = {'tv': tv, 'dv': dv, 'cats': supplier_cats.get(s, set())}
                else:
                    grp['suppliers'][s]['tv'] += tv
                    grp['suppliers'][s]['dv'] += dv

        for (co, cc, st, qt, ow, sh, bal, vc, pb), grp in base_groups.items():
            idx = get_combo_idx(co, cc, st, qt, ow, sh, bal, "", vc, pb)
            combo_list[idx]['tv'][wi] += grp['tv']
            combo_list[idx]['sv'][wi] += len(grp['suppliers'])
            combo_list[idx]['dv'][wi] += grp['dv']

            cat_aggs = {}
            for s, sinfo in grp['suppliers'].items():
                for cat in sinfo['cats']:
                    if cat not in cat_aggs:
                        cat_aggs[cat] = {'tv': 0.0, 'dv': 0, 'n': 0}
                    cat_aggs[cat]['tv'] += sinfo['tv']
                    cat_aggs[cat]['dv'] += sinfo['dv']
                    cat_aggs[cat]['n'] += 1

            for cat, cagg in cat_aggs.items():
                cidx = get_combo_idx(co, cc, st, qt, ow, sh, bal, cat, vc, pb)
                combo_list[cidx]['tv'][wi] += cagg['tv']
                combo_list[cidx]['sv'][wi] += cagg['n']
                combo_list[cidx]['dv'][wi] += cagg['dv']

    for c in combo_list:
        c['tv'] = [round(v, 2) for v in c['tv']]

    log.info("  [OK] Cube complete: %d combos x %d weeks", len(combo_list), n_weeks)

    return {
        "weeks": weeks_ordered,
        "combos": combo_list
    }


# 
# SYNTHETIC_REVIEW DATA LOADING
# 


TREND_CUBE_FIELDS = ("co", "cc", "st", "qt", "ow", "sh", "bal", "dc", "vc", "pb")


def _combo_key(combo: Dict[str, Any]) -> tuple[str, ...]:
    return tuple(str(combo.get(field) or "") for field in TREND_CUBE_FIELDS)


def _load_trend_cube_from_js(cube_js: str) -> Dict[str, Any]:
    marker = "window._TREND_CUBE="
    start = cube_js.find(marker)
    if start < 0:
        raise ValueError("trend_cube.js does not contain window._TREND_CUBE")
    raw = cube_js[start + len(marker):].strip()
    if raw.endswith(";"):
        raw = raw[:-1]
    return json.loads(raw)


def _merge_incremental_trend_cube(
    existing_cube: Dict[str, Any],
    weeks_data: Dict[str, Any],
    sorted_weeks: List[str],
) -> Dict[str, Any]:
    """Append or refresh the newest week in an existing trend cube."""
    target_weeks = list(reversed(sorted_weeks))
    existing_weeks = list(existing_cube.get("weeks") or [])
    if not existing_weeks:
        raise ValueError("existing trend cube has no weeks")
    if target_weeks[:len(existing_weeks)] != existing_weeks:
        raise ValueError(
            "existing trend cube weeks are not a prefix of current dashboard weeks; "
            "run the rebuild-all dashboard build"
        )

    update_weeks = target_weeks[len(existing_weeks):]
    if not update_weeks:
        update_weeks = [target_weeks[-1]]
    if len(update_weeks) > 5:
        raise ValueError("too many missing weeks for incremental trend cube; run rebuild-all")

    final_weeks = existing_weeks + [week for week in update_weeks if week not in existing_weeks]
    final_week_index = {week: idx for idx, week in enumerate(final_weeks)}
    old_week_count = len(existing_weeks)
    final_week_count = len(final_weeks)

    existing_combos = list(existing_cube.get("combos") or [])
    combo_map: dict[tuple[str, ...], Dict[str, Any]] = {}
    for combo in existing_combos:
        for metric in ("tv", "sv", "dv"):
            values = list(combo.get(metric) or [])
            if len(values) != old_week_count:
                raise ValueError(f"trend cube combo has invalid {metric} length")
            values.extend([0] * (final_week_count - old_week_count))
            combo[metric] = values
        combo_map[_combo_key(combo)] = combo

    refresh_data = {week: weeks_data[week] for week in update_weeks}
    refresh_sorted = sorted(update_weeks, reverse=True)
    refresh_cube = compute_year_trend_cube(refresh_data, refresh_sorted)

    for combo in combo_map.values():
        for week in refresh_cube["weeks"]:
            idx = final_week_index[week]
            combo["tv"][idx] = 0.0
            combo["sv"][idx] = 0
            combo["dv"][idx] = 0.0

    for refresh_combo in refresh_cube["combos"]:
        key = _combo_key(refresh_combo)
        combo = combo_map.get(key)
        if combo is None:
            combo = {field: refresh_combo.get(field, "") for field in TREND_CUBE_FIELDS}
            combo["tv"] = [0.0] * final_week_count
            combo["sv"] = [0] * final_week_count
            combo["dv"] = [0.0] * final_week_count
            combo_map[key] = combo
            existing_combos.append(combo)
        for local_idx, week in enumerate(refresh_cube["weeks"]):
            idx = final_week_index[week]
            combo["tv"][idx] = refresh_combo["tv"][local_idx]
            combo["sv"][idx] = refresh_combo["sv"][local_idx]
            combo["dv"][idx] = refresh_combo["dv"][local_idx]

    log.info("  [OK] Incremental Year Trend Cube: refreshed weeks %s", update_weeks)
    return {"weeks": final_weeks, "combos": existing_combos}
def load_synthetic_review_from_sqlite() -> dict[str, Any] | None:
    """Load SyntheticReview data from its own SQLite database for the dashboard."""
    if not SYNTHETIC_REVIEW_DB.exists():
        return None
    with closing(sqlite3.connect(str(SYNTHETIC_REVIEW_DB))) as conn:
        configure_connection(conn)
        try:
            dates = [r[0] for r in conn.execute(
                "SELECT DISTINCT SnapshotDate FROM synthetic_review_lines ORDER BY SnapshotDate DESC"
            ).fetchall()]
            if not dates:
                return None

            _synthetic_review_cols = ', '.join(f'"{k}"' for k in SYNTHETIC_REVIEW_SHORT_KEYS)
            cur = conn.execute(f"SELECT {_synthetic_review_cols} FROM synthetic_review_lines ORDER BY SnapshotDate DESC")
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            records = []
            for row in rows:
                d = dict(zip(cols, row))
                records.append({v: d.get(k, '') for k, v in SYNTHETIC_REVIEW_SHORT_KEYS.items()})

            trend = []
            try:
                # SELECT * intentional  all columns passed through to dashboard JSON
                cur2 = conn.execute(
                    "SELECT * FROM synthetic_review_daily_summary ORDER BY SnapshotDate DESC"
                )
                trend_cols = [d[0] for d in cur2.description]
                trend_rows = cur2.fetchall()
                trend = [dict(zip(trend_cols, r)) for r in trend_rows]
            except sqlite3.OperationalError:
                log.warning("synthetic_review_daily_summary table not found, skipping trend")

            #  SYNTHETIC_REVIEW_WEEKLY_TREND aggregation 
            # Group synthetic_review_lines by WeekStartISO (Monday of SnapshotDate).
            # invoices = all rows that week
            # errors   = rows where SourceType='Invoice Error'
            # duplicates = rows where SourceType='Duplicate Invoice'
            #              (overridden by synthetic_review_duplicates table count if it exists)
            _xwt_buckets: dict[str, dict] = {}

            def _snap_to_monday(snap_date_raw: object) -> str | None:
                """Parse a SnapshotDate value and return the ISO Monday string."""
                snap_str = str(snap_date_raw or '').strip()
                if not snap_str:
                    return None
                for _fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
                    try:
                        _dt = datetime.strptime(snap_str, _fmt)
                        return (_dt - timedelta(days=_dt.weekday())).strftime('%Y-%m-%d')
                    except ValueError:
                        continue
                return None

            try:
                _snap_rows = conn.execute(
                    "SELECT SnapshotDate, SourceType FROM synthetic_review_lines"
                ).fetchall()
                for _snap_raw, _stype in _snap_rows:
                    _mon = _snap_to_monday(_snap_raw)
                    if _mon is None:
                        continue
                    if _mon not in _xwt_buckets:
                        _xwt_buckets[_mon] = {'invoices': 0, 'errors': 0, 'duplicates': 0}
                    _xwt_buckets[_mon]['invoices'] += 1
                    if _stype == 'Invoice Error':
                        _xwt_buckets[_mon]['errors'] += 1
                    elif _stype == 'Duplicate Invoice':
                        _xwt_buckets[_mon]['duplicates'] += 1
            except sqlite3.OperationalError as _xe:
                log.warning("SYNTHETIC_REVIEW_WEEKLY_TREND: synthetic_review_lines not accessible: %s", _xe)

            # If a dedicated synthetic_review_duplicates table exists, override duplicate counts
            try:
                _dup_tbl = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='synthetic_review_duplicates'"
                ).fetchone()
                if _dup_tbl:
                    _dup_rows = conn.execute(
                        "SELECT SnapshotDate FROM synthetic_review_duplicates"
                    ).fetchall()
                    for _bkt in _xwt_buckets.values():
                        _bkt['duplicates'] = 0
                    for (_snap_raw,) in _dup_rows:
                        _mon = _snap_to_monday(_snap_raw)
                        if _mon is not None and _mon in _xwt_buckets:
                            _xwt_buckets[_mon]['duplicates'] += 1
            except sqlite3.OperationalError as _de:
                log.warning("SYNTHETIC_REVIEW_WEEKLY_TREND: synthetic_review_duplicates query failed: %s", _de)

            synthetic_review_weekly_trend = sorted(
                [
                    {
                        'week': _w,
                        'invoices': int(_b['invoices']),
                        'errors': int(_b['errors']),
                        'duplicates': int(_b['duplicates']),
                    }
                    for _w, _b in _xwt_buckets.items()
                ],
                key=lambda x: x['week'],
            )
            log.info("[SYNTHETIC_REVIEW] Weekly trend: %d weeks aggregated", len(synthetic_review_weekly_trend))

            return {
                'rows': records,
                'dates': dates,
                'trend': trend,
                'synthetic_review_weekly_trend': synthetic_review_weekly_trend,
                'generated': datetime.now().isoformat(),
            }
        except sqlite3.OperationalError as e:
            log.warning("synthetic_review_lines table not accessible: %s", e)
            return None


# 
# PRODUCTIVITY TREND
# 


_PRODUCTIVITY_FINGERPRINT_FIELDS = (
    "rl", "o", "ad", "st", "a", "cm", "s", "sh", "cc", "sn", "co",
    "dn", "rn", "dt", "cur", "qt", "ns", "vc",
)


def _productivity_cache_path(category: str, key: str) -> Any:
    safe_key = re.sub(r"[^A-Za-z0-9_.-]+", "_", key).strip("_") or "cache"
    return PRODUCTIVITY_CACHE_DIR / category / f"{safe_key}.json"


def _week_rows_fingerprint(week_iso: str, week_data: dict[str, Any]) -> str:
    digest = hashlib.sha256()
    digest.update(PRODUCTIVITY_CACHE_VERSION.encode("utf-8"))
    digest.update(b"\0")
    digest.update(week_iso.encode("utf-8"))
    row_count = 0
    detail_count = 0
    for row in week_data.get("raw", []):
        row_count += 1
        if _display_doc_part(row.get("rl")).lower() == "detail":
            detail_count += 1
        for field in _PRODUCTIVITY_FINGERPRINT_FIELDS:
            digest.update(field.encode("utf-8"))
            digest.update(b"=")
            digest.update(_display_doc_part(row.get(field)).encode("utf-8", errors="replace"))
            digest.update(b"\x1f")
        digest.update(b"\x1e")
    return f"{digest.hexdigest()}:{row_count}:{detail_count}"


def _read_productivity_cache(category: str, key: str, fingerprint: str) -> dict[str, Any] | None:
    path = _productivity_cache_path(category, key)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        log.warning("[PRODUCTIVITY] Ignoring unreadable cache %s: %s", path, err)
        return None
    if payload.get("version") != PRODUCTIVITY_CACHE_VERSION:
        return None
    if payload.get("fingerprint") != fingerprint:
        return None
    return payload


def _write_productivity_cache(category: str, key: str, fingerprint: str, data: Any) -> None:
    path = _productivity_cache_path(category, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": PRODUCTIVITY_CACHE_VERSION,
        "fingerprint": fingerprint,
        "generated": datetime.now().isoformat(timespec="seconds"),
        "data": data,
    }
    atomic_write_text(path, json.dumps(payload, separators=(",", ":"), default=str))


def _merge_productivity_trend_rows(rows_by_week: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], int] = {}
    for rows in rows_by_week:
        for row in rows:
            owner = str(row.get("owner") or "")
            week = str(row.get("week") or "")
            if not owner or not week:
                continue
            key = (owner, week)
            buckets[key] = buckets.get(key, 0) + int(row.get("actioned") or 0)
    return sorted(
        [
            {"owner": owner, "week": week, "actioned": int(count)}
            for (owner, week), count in buckets.items()
        ],
        key=lambda row: (row["week"], row["owner"]),
    )

def _compute_productivity_trend_uncached(weeks_data: Dict[str, Any]) -> list:
    """Aggregate actioned-document counts per owner per week from weeks_data.

    Iterates every week in weeks_data, selects DETAIL rows that have a
    non-empty ActionDate ('ad' short key), parses the date with a
    multi-format strptime helper (same formats as _net_due / _snap_to_monday),
    snaps to the Monday of that week, applies .title() to the owner short key
    ('o'), and aggregates a count per (owner, weekMonday) pair.

    Args:
        weeks_data: Dict keyed by WeekStartISO -> {'raw': [row_dict, ...]}.
                    Row dicts use short keys ('rl', 'o', 'ad', ...).

    Returns:
        Sorted list of dicts [{'owner': str, 'week': str, 'actioned': int}]
        filtered to week >= '2026-01-05', sorted by (week, owner).
    """
    _CUTOFF = '2026-01-05'
    _AD_FORMATS = ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y')
    # Cap: Sunday of the current week (Mon-Sun)
    _today = datetime.now()
    _days_until_sunday = 6 - _today.weekday()  # weekday(): Mon=0 .. Sun=6
    _max_date = (_today + timedelta(days=_days_until_sunday)).strftime('%Y-%m-%d')

    buckets: dict[tuple[str, str], int] = {}

    for _week_iso, _week_data in weeks_data.items():
        for row in _week_data.get('raw', []):
            # DETAIL rows only
            if (row.get('rl') or '').strip().lower() != 'detail':
                continue
            ad_raw = str(row.get('ad') or '').strip()
            if not ad_raw:
                continue
            # Parse ActionDate  multi-format, same set as _net_due
            _parsed_dt = None
            for _fmt in _AD_FORMATS:
                try:
                    _parsed_dt = datetime.strptime(ad_raw, _fmt)
                    break
                except ValueError:
                    continue
            if _parsed_dt is None:
                continue
            week_monday = (_parsed_dt - timedelta(days=_parsed_dt.weekday())).strftime('%Y-%m-%d')
            if week_monday < _CUTOFF:
                continue
            if week_monday > _max_date:
                continue
            owner = str(row.get('o') or '').strip().title()
            if not owner:
                continue
            key = (owner, week_monday)
            buckets[key] = buckets.get(key, 0) + 1

    result = sorted(
        [
            {'owner': ow, 'week': wk, 'actioned': int(cnt)}
            for (ow, wk), cnt in buckets.items()
        ],
        key=lambda x: (x['week'], x['owner']),
    )
    log.info("[PRODUCTIVITY] Trend: %d (owner, week) pairs, cutoff >= %s", len(result), _CUTOFF)
    return result



def compute_productivity_trend(weeks_data: Dict[str, Any], use_cache: bool = True) -> list:
    """Aggregate productivity trend, reusing per-snapshot-week cache when allowed."""
    rows_by_week: list[list[dict[str, Any]]] = []
    hits = 0
    misses = 0
    for week_iso, week_data in weeks_data.items():
        fingerprint = _week_rows_fingerprint(week_iso, week_data)
        cached = _read_productivity_cache("trend", week_iso, fingerprint) if use_cache else None
        if cached is None:
            misses += 1
            rows = _compute_productivity_trend_uncached({week_iso: week_data})
            if use_cache:
                _write_productivity_cache("trend", week_iso, fingerprint, {"rows": rows})
        else:
            hits += 1
            rows = list((cached.get("data") or {}).get("rows") or [])
        rows_by_week.append(rows)

    result = _merge_productivity_trend_rows(rows_by_week)
    if use_cache:
        log.info("[PRODUCTIVITY] Trend cache: %d hits, %d refreshed", hits, misses)
    log.info("[PRODUCTIVITY] Trend: %d (owner, week) pairs", len(result))
    return result

def _productivity_rag(row: dict[str, Any], week_iso: str) -> str:
    status = _display_doc_part(row.get("st")).strip().lower()
    if status == "blocker":
        return "blocker"

    if any(term in status for term in ("waiting", "outstanding", "awaiting")):
        return "amber"

    action_date = _parse_action_date(row.get("ad"))
    if action_date is None:
        return "red"

    try:
        snapshot_date = datetime.strptime(week_iso, "%Y-%m-%d")
    except ValueError:
        snapshot_date = datetime.now()
    age_days = (snapshot_date.date() - action_date.date()).days
    if age_days <= 7:
        return "green"
    if 8 <= age_days <= 13:
        return "amber"
    return "red"


def _compute_productivity_scorecard_uncached(weeks_data: Dict[str, Any]) -> list[dict[str, Any]]:
    """Compact owner/week/source scorecard for Productivity filters and RAG."""
    buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
    vendors_reviewed: dict[tuple[str, str, str], set[str]] = {}

    for week_iso, week_data in weeks_data.items():
        for row in week_data.get("raw", []):
            if _display_doc_part(row.get("rl")).lower() != "detail":
                continue
            owner = _display_doc_part(row.get("o")).title()
            if not owner:
                continue
            source = _source_from_row(row)
            key = (owner, week_iso, source)
            if key not in buckets:
                buckets[key] = {
                    "owner": owner,
                    "week": week_iso,
                    "source": source,
                    "aged_items_cleared": 0,
                    "value_cleared": 0.0,
                    "vendor_reviews_completed": 0,
                    "comments_updated": 0,
                    "blockers_raised": 0,
                    "rag_green": 0,
                    "rag_amber": 0,
                    "rag_red": 0,
                    "rag_blocker": 0,
                    "rag_total": 0,
                }
                vendors_reviewed[key] = set()

            bucket = buckets[key]
            rag = _productivity_rag(row, week_iso)
            bucket[f"rag_{rag}"] += 1
            bucket["rag_total"] += 1

            status = _display_doc_part(row.get("st")).strip().lower()
            actioned_in_week = _action_date_in_week(row.get("ad"), week_iso)
            if status == "blocker" and actioned_in_week:
                bucket["blockers_raised"] += 1
            if actioned_in_week:
                if status == "resolved":
                    bucket["aged_items_cleared"] += 1
                    bucket["value_cleared"] += safe_float(row.get("a"))
                if _display_doc_part(row.get("cm")):
                    bucket["comments_updated"] += 1
                supplier = _display_doc_part(row.get("s"))
                if supplier:
                    vendors_reviewed[key].add(supplier)

    for key, suppliers in vendors_reviewed.items():
        buckets[key]["vendor_reviews_completed"] = len(suppliers)
        buckets[key]["value_cleared"] = round(buckets[key]["value_cleared"], 2)

    return sorted(buckets.values(), key=lambda r: (r["week"], r["owner"], r["source"]))


def compute_productivity_scorecard(weeks_data: Dict[str, Any], use_cache: bool = True) -> list[dict[str, Any]]:
    """Build owner/week/source scorecard with per-week cache reuse."""
    rows: list[dict[str, Any]] = []
    hits = 0
    misses = 0
    for week_iso, week_data in weeks_data.items():
        fingerprint = _week_rows_fingerprint(week_iso, week_data)
        cached = _read_productivity_cache("scorecard", week_iso, fingerprint) if use_cache else None
        if cached is None:
            misses += 1
            week_rows = _compute_productivity_scorecard_uncached({week_iso: week_data})
            if use_cache:
                _write_productivity_cache("scorecard", week_iso, fingerprint, {"rows": week_rows})
        else:
            hits += 1
            week_rows = list((cached.get("data") or {}).get("rows") or [])
        rows.extend(week_rows)
    if use_cache:
        log.info("[PRODUCTIVITY] Scorecard cache: %d hits, %d refreshed", hits, misses)
    return sorted(rows, key=lambda r: (r["week"], r["owner"], r["source"]))

def _norm_doc_part(value: Any) -> str:
    """Normalize document identity fields for cross-week matching."""
    if value is None:
        return ""
    raw = str(value).strip().replace("\xa0", " ")
    if raw.endswith(".0"):
        raw = raw[:-2]
    return " ".join(raw.split()).upper()


def _display_doc_part(value: Any) -> str:
    """Normalize document fields for display while preserving readable case."""
    if value is None:
        return ""
    raw = str(value).strip().replace("\xa0", " ")
    if raw.endswith(".0"):
        raw = raw[:-2]
    return " ".join(raw.split())


def _source_from_row(row: dict[str, Any]) -> str:
    sheet = _display_doc_part(row.get("sh")).upper()
    return "KEY" if sheet == "KEY" else "LEDGER"


def _parse_action_date(value: Any) -> datetime | None:
    """Parse an Action Date value using dashboard-supported formats."""
    raw = _display_doc_part(value)
    if not raw:
        return None
    for fmt_str in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt_str)
        except ValueError:
            continue
    if _EXCEL_SERIAL_DATE_RE.match(raw):
        try:
            serial = float(raw)
        except ValueError:
            return None
        if 1 <= serial <= 60000:
            return _EXCEL_DATE_EPOCH + timedelta(days=serial)
    return None


def _action_date_in_week(action_date: Any, week_iso: str) -> bool:
    parsed = _parse_action_date(action_date)
    if parsed is None:
        return False
    week_start = parsed - timedelta(days=parsed.weekday())
    return week_start.strftime("%Y-%m-%d") == week_iso


def _amount_match_key(amount: float) -> str:
    return f"{round(amount, 2):.2f}"


def _document_base_key(row: dict[str, Any]) -> tuple[str, ...] | None:
    """Return the non-amount identity required before amount matching."""
    cc = _norm_doc_part(row.get("cc"))
    supplier = _norm_doc_part(row.get("s"))
    document = _norm_doc_part(row.get("dn"))
    reference = _norm_doc_part(row.get("rn"))
    doc_type = _norm_doc_part(row.get("dt"))

    if not (cc and supplier and document and reference and doc_type):
        return None
    return (cc, supplier, document, reference, doc_type)


def _document_amount_key(base_key: tuple[str, ...], amount: float) -> tuple[str, ...]:
    """Append rounded total amount to the document identity key."""
    return (*base_key, _amount_match_key(amount))


def _merge_doc_record(existing: ResolvedDoc | None, row: dict[str, Any], key: tuple[str, ...], confidence: str) -> ResolvedDoc:
    amount = safe_float(row.get("a"))
    if existing is None:
        return ResolvedDoc(
            key=key,
            confidence=confidence,
            source={_source_from_row(row)},
            team={_display_doc_part(row.get("sh")).upper()},
            owner=_display_doc_part(row.get("o")).title(),
            company_code=_display_doc_part(row.get("cc")),
            supplier=_display_doc_part(row.get("s")),
            supplier_name=_display_doc_part(row.get("sn")),
            country=_display_doc_part(row.get("co")),
            document_number=_display_doc_part(row.get("dn")),
            reference=_display_doc_part(row.get("rn")),
            document_type=_display_doc_part(row.get("dt")).upper(),
            amount=amount,
            amount_key="",
            match_reason="exact_doc_amount",
            currency=_display_doc_part(row.get("cur")),
            status=_display_doc_part(row.get("st")),
            action_date=_display_doc_part(row.get("ad")),
            query_type=_display_doc_part(row.get("qt")),
            comment=_display_doc_part(row.get("cm")),
            next_step=_display_doc_part(row.get("ns")),
            vendor_category=_display_doc_part(row.get("vc")),
            line_count=1,
        )

    existing.source.add(_source_from_row(row))
    existing.team.add(_display_doc_part(row.get("sh")).upper())
    existing.amount += amount
    existing.line_count += 1
    for attr, row_key, transform in (
        ("owner", "o", lambda v: _display_doc_part(v).title()),
        ("supplier_name", "sn", _display_doc_part),
        ("country", "co", _display_doc_part),
        ("currency", "cur", _display_doc_part),
        ("status", "st", _display_doc_part),
        ("action_date", "ad", _display_doc_part),
        ("query_type", "qt", _display_doc_part),
        ("comment", "cm", _display_doc_part),
        ("next_step", "ns", _display_doc_part),
        ("vendor_category", "vc", _display_doc_part),
    ):
        if not getattr(existing, attr):
            setattr(existing, attr, transform(row.get(row_key)))
    return existing


def _finalize_amount_keyed_docs(base_docs: dict[tuple[str, ...], ResolvedDoc]) -> dict[tuple[str, ...], ResolvedDoc]:
    docs: dict[tuple[str, ...], ResolvedDoc] = {}
    for base_key, doc in base_docs.items():
        amount_key = _amount_match_key(doc.amount)
        doc.key = _document_amount_key(base_key, doc.amount)
        doc.amount_key = amount_key
        doc.match_reason = "exact_doc_amount"
        doc.confidence = "high"
        docs[doc.key] = doc
    return docs


def _resolution_breakdown_key(doc: ResolvedDoc) -> tuple[str, str, str, str]:
    return (
        "+".join(sorted(doc.source)),
        "+".join(sorted(doc.team)),
        doc.owner,
        doc.confidence,
    )


def _resolution_breakdown(
    snapshot_resolved: dict[tuple[str, ...], ResolvedDoc],
    actioned_resolved: dict[tuple[str, ...], ResolvedDoc],
    snapshot_carryover_keys: set[tuple[str, ...]],
    actioned_carryover_keys: set[tuple[str, ...]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    def bucket(doc: ResolvedDoc) -> dict[str, Any]:
        key = _resolution_breakdown_key(doc)
        if key not in grouped:
            src, team, owner, confidence = key
            grouped[key] = {"src": src, "team": team, "o": owner, "conf": confidence, "sr": 0, "sc": 0, "ar": 0, "ac": 0}
        return grouped[key]

    for key, doc in snapshot_resolved.items():
        item = bucket(doc)
        item["sr"] += 1
        if key in snapshot_carryover_keys:
            item["sc"] += 1

    for key, doc in actioned_resolved.items():
        item = bucket(doc)
        item["ar"] += 1
        if key in actioned_carryover_keys:
            item["ac"] += 1

    return sorted(grouped.values(), key=lambda r: (r["src"], r["team"], r["o"], r["conf"]))


def _doc_record_to_payload(
    prev_doc: ResolvedDoc,
    present_doc: ResolvedDoc,
    resolved_week: str,
    present_week: str,
    actioned_in_week: bool,
) -> dict[str, Any]:
    return {
        "rw": resolved_week,
        "pw": present_week,
        "src": "+".join(sorted(prev_doc.source)),
        "psrc": "+".join(sorted(present_doc.source)),
        "team": "+".join(sorted(prev_doc.team)),
        "pteam": "+".join(sorted(present_doc.team)),
        "o": prev_doc.owner,
        "po": present_doc.owner,
        "cc": prev_doc.company_code,
        "s": prev_doc.supplier,
        "sn": prev_doc.supplier_name,
        "co": prev_doc.country,
        "dn": prev_doc.document_number,
        "rn": prev_doc.reference,
        "dt": prev_doc.document_type,
        "a": round(prev_doc.amount, 2),
        "mk": prev_doc.amount_key,
        "mr": prev_doc.match_reason,
        "cur": prev_doc.currency,
        "st": prev_doc.status,
        "ad": prev_doc.action_date,
        "qt": prev_doc.query_type,
        "cm": prev_doc.comment,
        "ns": prev_doc.next_step,
        "vc": prev_doc.vendor_category,
        "conf": prev_doc.confidence,
        "act": 1 if actioned_in_week else 0,
        "lc": prev_doc.line_count,
        "plc": present_doc.line_count,
        "pa": round(present_doc.amount, 2),
        "adiff": round(present_doc.amount - prev_doc.amount, 2),
    }


def _compute_resolved_carryover_audit_uncached(weeks_data: Dict[str, Any]) -> dict[str, Any]:
    """Build document-level Resolution Quality audit from weekly history."""
    weeks = sorted(weeks_data)
    docs_by_week: dict[str, dict[tuple[str, ...], ResolvedDoc]] = {}
    snapshot_resolved_by_week: dict[str, dict[tuple[str, ...], ResolvedDoc]] = {}
    actioned_resolved_by_week: dict[str, dict[tuple[str, ...], ResolvedDoc]] = {}

    for week in weeks:
        docs_base: dict[tuple[str, ...], ResolvedDoc] = {}
        snapshot_resolved_base: dict[tuple[str, ...], ResolvedDoc] = {}
        actioned_resolved_base: dict[tuple[str, ...], ResolvedDoc] = {}
        for row in weeks_data.get(week, {}).get("raw", []):
            if _display_doc_part(row.get("rl")).lower() != "detail":
                continue
            base_key = _document_base_key(row)
            if base_key is None:
                continue
            docs_base[base_key] = _merge_doc_record(docs_base.get(base_key), row, base_key, "high")
            if _display_doc_part(row.get("st")).lower() != "resolved":
                continue
            snapshot_resolved_base[base_key] = _merge_doc_record(snapshot_resolved_base.get(base_key), row, base_key, "high")
            if _action_date_in_week(row.get("ad"), week):
                actioned_resolved_base[base_key] = _merge_doc_record(actioned_resolved_base.get(base_key), row, base_key, "high")

        docs_by_week[week] = _finalize_amount_keyed_docs(docs_base)
        snapshot_resolved_by_week[week] = _finalize_amount_keyed_docs(snapshot_resolved_base)
        actioned_resolved_by_week[week] = _finalize_amount_keyed_docs(actioned_resolved_base)

    rows: list[dict[str, Any]] = []
    trend: list[dict[str, Any]] = []
    for idx, week in enumerate(weeks[:-1]):
        present_week = weeks[idx + 1]
        present_docs = docs_by_week.get(present_week, {})
        snapshot_resolved = snapshot_resolved_by_week.get(week, {})
        actioned_resolved = actioned_resolved_by_week.get(week, {})
        snapshot_carryover_keys = set(snapshot_resolved) & set(present_docs)
        actioned_carryover_keys = set(actioned_resolved) & set(present_docs)

        trend.append({
            "rw": week,
            "pw": present_week,
            "sr": len(snapshot_resolved),
            "sc": len(snapshot_carryover_keys),
            "ar": len(actioned_resolved),
            "ac": len(actioned_carryover_keys),
            "bd": _resolution_breakdown(snapshot_resolved, actioned_resolved, snapshot_carryover_keys, actioned_carryover_keys),
        })

        for key in sorted(snapshot_carryover_keys):
            rows.append(
                _doc_record_to_payload(
                    snapshot_resolved[key],
                    present_docs[key],
                    week,
                    present_week,
                    key in actioned_carryover_keys,
                )
            )

    latest_pair = trend[-1] if trend else None
    summary = {
        "rw": latest_pair["rw"] if latest_pair else "",
        "pw": latest_pair["pw"] if latest_pair else "",
        "resolved": latest_pair["ar"] if latest_pair else 0,
        "carryover": latest_pair["ac"] if latest_pair else 0,
        "rate": round((latest_pair["ac"] / latest_pair["ar"] * 100), 1) if latest_pair and latest_pair["ar"] else 0.0,
        "snapshot_resolved": latest_pair["sr"] if latest_pair else 0,
        "snapshot_carryover": latest_pair["sc"] if latest_pair else 0,
    }

    log.info("[PRODUCTIVITY] Resolved carryover: %d audit rows, %d trend pairs", len(rows), len(trend))
    return {"summary": summary, "trend": trend, "rows": rows, "generated": datetime.now().isoformat(timespec="seconds")}


def _doc_key_to_cache_key(key: tuple[str, ...]) -> str:
    return json.dumps(list(key), separators=(",", ":"))


def _doc_key_from_cache_key(raw: str) -> tuple[str, ...]:
    return tuple(json.loads(raw))


def _resolved_doc_to_payload(doc: ResolvedDoc) -> dict[str, Any]:
    return {
        "key": list(doc.key),
        "confidence": doc.confidence,
        "source": sorted(doc.source),
        "team": sorted(doc.team),
        "owner": doc.owner,
        "company_code": doc.company_code,
        "supplier": doc.supplier,
        "supplier_name": doc.supplier_name,
        "country": doc.country,
        "document_number": doc.document_number,
        "reference": doc.reference,
        "document_type": doc.document_type,
        "amount": doc.amount,
        "amount_key": doc.amount_key,
        "match_reason": doc.match_reason,
        "currency": doc.currency,
        "status": doc.status,
        "action_date": doc.action_date,
        "query_type": doc.query_type,
        "comment": doc.comment,
        "next_step": doc.next_step,
        "vendor_category": doc.vendor_category,
        "line_count": doc.line_count,
    }


def _resolved_doc_from_payload(payload: dict[str, Any]) -> ResolvedDoc:
    return ResolvedDoc(
        key=tuple(str(part) for part in payload.get("key", [])),
        confidence=str(payload.get("confidence") or ""),
        source=set(payload.get("source") or []),
        team=set(payload.get("team") or []),
        owner=str(payload.get("owner") or ""),
        company_code=str(payload.get("company_code") or ""),
        supplier=str(payload.get("supplier") or ""),
        supplier_name=str(payload.get("supplier_name") or ""),
        country=str(payload.get("country") or ""),
        document_number=str(payload.get("document_number") or ""),
        reference=str(payload.get("reference") or ""),
        document_type=str(payload.get("document_type") or ""),
        amount=float(payload.get("amount") or 0.0),
        amount_key=str(payload.get("amount_key") or ""),
        match_reason=str(payload.get("match_reason") or ""),
        currency=str(payload.get("currency") or ""),
        status=str(payload.get("status") or ""),
        action_date=str(payload.get("action_date") or ""),
        query_type=str(payload.get("query_type") or ""),
        comment=str(payload.get("comment") or ""),
        next_step=str(payload.get("next_step") or ""),
        vendor_category=str(payload.get("vendor_category") or ""),
        line_count=int(payload.get("line_count") or 0),
    )


def _serialize_doc_map(docs: dict[tuple[str, ...], ResolvedDoc]) -> dict[str, Any]:
    return {_doc_key_to_cache_key(key): _resolved_doc_to_payload(doc) for key, doc in docs.items()}


def _deserialize_doc_map(payload: dict[str, Any]) -> dict[tuple[str, ...], ResolvedDoc]:
    docs: dict[tuple[str, ...], ResolvedDoc] = {}
    for raw_key, raw_doc in payload.items():
        doc = _resolved_doc_from_payload(raw_doc)
        key = _doc_key_from_cache_key(raw_key)
        doc.key = key
        docs[key] = doc
    return docs


def _compute_resolved_carryover_week_state(week: str, week_data: dict[str, Any]) -> dict[str, dict[tuple[str, ...], ResolvedDoc]]:
    docs_base: dict[tuple[str, ...], ResolvedDoc] = {}
    snapshot_resolved_base: dict[tuple[str, ...], ResolvedDoc] = {}
    actioned_resolved_base: dict[tuple[str, ...], ResolvedDoc] = {}
    for row in week_data.get("raw", []):
        if _display_doc_part(row.get("rl")).lower() != "detail":
            continue
        base_key = _document_base_key(row)
        if base_key is None:
            continue
        docs_base[base_key] = _merge_doc_record(docs_base.get(base_key), row, base_key, "high")
        if _display_doc_part(row.get("st")).lower() != "resolved":
            continue
        snapshot_resolved_base[base_key] = _merge_doc_record(snapshot_resolved_base.get(base_key), row, base_key, "high")
        if _action_date_in_week(row.get("ad"), week):
            actioned_resolved_base[base_key] = _merge_doc_record(actioned_resolved_base.get(base_key), row, base_key, "high")

    return {
        "docs": _finalize_amount_keyed_docs(docs_base),
        "snapshot": _finalize_amount_keyed_docs(snapshot_resolved_base),
        "actioned": _finalize_amount_keyed_docs(actioned_resolved_base),
    }


def _load_resolved_carryover_week_state(
    week: str,
    week_data: dict[str, Any],
    fingerprint: str,
    use_cache: bool,
) -> tuple[dict[str, dict[tuple[str, ...], ResolvedDoc]], bool]:
    cached = _read_productivity_cache("carry_week", week, fingerprint) if use_cache else None
    if cached is not None:
        data = cached.get("data") or {}
        return {
            "docs": _deserialize_doc_map(data.get("docs") or {}),
            "snapshot": _deserialize_doc_map(data.get("snapshot") or {}),
            "actioned": _deserialize_doc_map(data.get("actioned") or {}),
        }, True

    state = _compute_resolved_carryover_week_state(week, week_data)
    if use_cache:
        _write_productivity_cache(
            "carry_week",
            week,
            fingerprint,
            {
                "docs": _serialize_doc_map(state["docs"]),
                "snapshot": _serialize_doc_map(state["snapshot"]),
                "actioned": _serialize_doc_map(state["actioned"]),
            },
        )
    return state, False


def _compute_resolved_carryover_pair(
    week: str,
    present_week: str,
    present_docs: dict[tuple[str, ...], ResolvedDoc],
    snapshot_resolved: dict[tuple[str, ...], ResolvedDoc],
    actioned_resolved: dict[tuple[str, ...], ResolvedDoc],
) -> dict[str, Any]:
    snapshot_carryover_keys = set(snapshot_resolved) & set(present_docs)
    actioned_carryover_keys = set(actioned_resolved) & set(present_docs)
    trend = {
        "rw": week,
        "pw": present_week,
        "sr": len(snapshot_resolved),
        "sc": len(snapshot_carryover_keys),
        "ar": len(actioned_resolved),
        "ac": len(actioned_carryover_keys),
        "bd": _resolution_breakdown(snapshot_resolved, actioned_resolved, snapshot_carryover_keys, actioned_carryover_keys),
    }
    rows = [
        _doc_record_to_payload(
            snapshot_resolved[key],
            present_docs[key],
            week,
            present_week,
            key in actioned_carryover_keys,
        )
        for key in sorted(snapshot_carryover_keys)
    ]
    return {"trend": trend, "rows": rows}


def compute_resolved_carryover_audit(weeks_data: Dict[str, Any], use_cache: bool = True) -> dict[str, Any]:
    """Build resolved carryover audit with per-week and per-pair cache reuse."""
    if not use_cache:
        return _compute_resolved_carryover_audit_uncached(weeks_data)

    weeks = sorted(weeks_data)
    fingerprints = {week: _week_rows_fingerprint(week, weeks_data.get(week, {})) for week in weeks}
    states: dict[str, dict[str, dict[tuple[str, ...], ResolvedDoc]]] = {}
    week_hits = 0
    week_misses = 0
    for week in weeks:
        state, hit = _load_resolved_carryover_week_state(week, weeks_data.get(week, {}), fingerprints[week], use_cache=True)
        states[week] = state
        if hit:
            week_hits += 1
        else:
            week_misses += 1

    rows: list[dict[str, Any]] = []
    trend: list[dict[str, Any]] = []
    pair_hits = 0
    pair_misses = 0
    for idx, week in enumerate(weeks[:-1]):
        present_week = weeks[idx + 1]
        pair_key = f"{week}__{present_week}"
        pair_fingerprint = f"{fingerprints[week]}|{fingerprints[present_week]}"
        cached_pair = _read_productivity_cache("carry_pair", pair_key, pair_fingerprint)
        if cached_pair is None:
            pair_misses += 1
            pair_data = _compute_resolved_carryover_pair(
                week,
                present_week,
                states[present_week]["docs"],
                states[week]["snapshot"],
                states[week]["actioned"],
            )
            _write_productivity_cache("carry_pair", pair_key, pair_fingerprint, pair_data)
        else:
            pair_hits += 1
            pair_data = cached_pair.get("data") or {"trend": {}, "rows": []}
        trend.append(pair_data.get("trend") or {})
        rows.extend(pair_data.get("rows") or [])

    latest_pair = trend[-1] if trend else None
    summary = {
        "rw": latest_pair["rw"] if latest_pair else "",
        "pw": latest_pair["pw"] if latest_pair else "",
        "resolved": latest_pair["ar"] if latest_pair else 0,
        "carryover": latest_pair["ac"] if latest_pair else 0,
        "rate": round((latest_pair["ac"] / latest_pair["ar"] * 100), 1) if latest_pair and latest_pair["ar"] else 0.0,
        "snapshot_resolved": latest_pair["sr"] if latest_pair else 0,
        "snapshot_carryover": latest_pair["sc"] if latest_pair else 0,
    }

    log.info(
        "[PRODUCTIVITY] Resolved carryover cache: week %d hits/%d refreshed, pair %d hits/%d refreshed",
        week_hits,
        week_misses,
        pair_hits,
        pair_misses,
    )
    log.info("[PRODUCTIVITY] Resolved carryover: %d audit rows, %d trend pairs", len(rows), len(trend))
    return {"summary": summary, "trend": trend, "rows": rows, "generated": datetime.now().isoformat(timespec="seconds")}

def write_resolved_carryover_audit(audit: dict[str, Any], db_path=None) -> None:
    """Persist the derived resolved-carryover audit for local inspection."""
    rows = audit.get("rows", [])
    if db_path is None:
        db_path = RESOLVED_CARRYOVER_DB
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS resolved_carryover_audit (
                ResolvedWeek TEXT NOT NULL,
                PresentWeek TEXT NOT NULL,
                Source TEXT,
                PresentSource TEXT,
                Team TEXT,
                PresentTeam TEXT,
                Owner TEXT,
                PresentOwner TEXT,
                CompanyCode TEXT,
                Supplier TEXT,
                SupplierName TEXT,
                Country TEXT,
                DocumentNumber TEXT,
                Reference TEXT,
                DocumentType TEXT,
                Amount REAL,
                AmountKey TEXT,
                MatchReason TEXT,
                AmountDifference REAL,
                Currency TEXT,
                Status TEXT,
                ActionDate TEXT,
                QueryType TEXT,
                Comment TEXT,
                NextStep TEXT,
                VendorCategory TEXT,
                Confidence TEXT,
                ActionedInWeek INTEGER DEFAULT 0,
                LineCount INTEGER,
                PresentLineCount INTEGER,
                PresentAmount REAL,
                GeneratedAt TEXT NOT NULL
            )
        """)
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(resolved_carryover_audit)").fetchall()}
        if "ActionedInWeek" not in existing_cols:
            conn.execute("ALTER TABLE resolved_carryover_audit ADD COLUMN ActionedInWeek INTEGER DEFAULT 0")
        if "AmountKey" not in existing_cols:
            conn.execute("ALTER TABLE resolved_carryover_audit ADD COLUMN AmountKey TEXT")
        if "MatchReason" not in existing_cols:
            conn.execute("ALTER TABLE resolved_carryover_audit ADD COLUMN MatchReason TEXT")
        if "AmountDifference" not in existing_cols:
            conn.execute("ALTER TABLE resolved_carryover_audit ADD COLUMN AmountDifference REAL")
        conn.execute("DELETE FROM resolved_carryover_audit")
        generated_at = str(audit.get("generated") or datetime.now().isoformat(timespec="seconds"))
        conn.executemany(
            """
            INSERT INTO resolved_carryover_audit (
                ResolvedWeek, PresentWeek, Source, PresentSource, Team, PresentTeam,
                Owner, PresentOwner, CompanyCode, Supplier, SupplierName, Country,
                DocumentNumber, Reference, DocumentType, Amount, AmountKey, MatchReason,
                AmountDifference, Currency, Status,
                ActionDate, QueryType, Comment, NextStep, VendorCategory, Confidence,
                ActionedInWeek, LineCount, PresentLineCount, PresentAmount, GeneratedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    r.get("rw", ""), r.get("pw", ""), r.get("src", ""), r.get("psrc", ""),
                    r.get("team", ""), r.get("pteam", ""), r.get("o", ""), r.get("po", ""),
                    r.get("cc", ""), r.get("s", ""), r.get("sn", ""), r.get("co", ""),
                    r.get("dn", ""), r.get("rn", ""), r.get("dt", ""), float(r.get("a") or 0),
                    r.get("mk", ""), r.get("mr", ""), float(r.get("adiff") or 0),
                    r.get("cur", ""), r.get("st", ""), r.get("ad", ""), r.get("qt", ""),
                    r.get("cm", ""), r.get("ns", ""), r.get("vc", ""), r.get("conf", ""),
                    int(r.get("act") or 0), int(r.get("lc") or 0), int(r.get("plc") or 0),
                    float(r.get("pa") or 0), generated_at,
                )
                for r in rows
            ],
        )
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_resolved_carryover_pair
            ON resolved_carryover_audit(ResolvedWeek, PresentWeek)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_resolved_carryover_owner
            ON resolved_carryover_audit(Owner)
        """)
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    log.info("[PRODUCTIVITY] Audit table refreshed: %s (%d rows)", db_path, len(rows))

# 
# STATEMENT DATA LOADING
# 

def load_statement_from_sqlite() -> dict[str, Any] | None:
    """Load Statement (Reconciliation History) data from synthetic_review_daily.sqlite."""
    if not SYNTHETIC_REVIEW_DB.exists():
        return None
    with closing(sqlite3.connect(str(SYNTHETIC_REVIEW_DB))) as conn:
        configure_connection(conn)
        try:
            # Check table exists
            tbl = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='statement_lines'"
            ).fetchone()
            if not tbl:
                return None

            dates = [r[0] for r in conn.execute(
                "SELECT DISTINCT SnapshotDate FROM statement_lines ORDER BY SnapshotDate DESC"
            ).fetchall()]
            if not dates:
                return None

            # Probe schema  pick _vc_col: prefer VendorCategory, fall back to Category, else None
            _pragma_rows = conn.execute("PRAGMA table_info(statement_lines)").fetchall()
            _stmt_col_names = {r[1] for r in _pragma_rows}
            if 'VendorCategory' in _stmt_col_names:
                _vc_col = 'VendorCategory'
            elif 'Category' in _stmt_col_names:
                _vc_col = 'Category'
            else:
                _vc_col = None

            # Validate _vc_col before SQL interpolation (allowlist via regex)
            if _vc_col and not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', _vc_col):
                _vc_col = None

            cols_sql = ', '.join(f'"{k}"' for k in STATEMENT_SHORT_KEYS)
            # Append _vc_col to SELECT only when not already covered by STATEMENT_SHORT_KEYS
            if _vc_col and _vc_col not in STATEMENT_SHORT_KEYS:
                cols_sql += f', "{_vc_col}"'

            cur = conn.execute(f"SELECT {cols_sql} FROM statement_lines ORDER BY SnapshotDate DESC")
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            records = []
            for row in rows:
                d = dict(zip(cols, row))
                rec = {v: d.get(k, '') for k, v in STATEMENT_SHORT_KEYS.items()}
                # Add vendor category short key using probed column
                val = d.get(_vc_col) if _vc_col else ''
                val = str(val or '').strip()
                rec['vc'] = _normalize_vc(val) if val else 'Uncategorised'
                records.append(rec)

            return {
                'rows': records,
                'dates': dates,
                'generated': datetime.now().isoformat(),
            }
        except sqlite3.OperationalError as e:
            log.warning("statement_lines table not accessible: %s", e)
            return None


# 
# ESCALATION DATA LOADING
# 

def _empty_escalation_payload() -> dict[str, Any]:
    return {
        'rows': [],
        'dates': [],
        'generated': datetime.now().isoformat(),
    }


def load_escalation_from_sqlite() -> dict[str, Any]:
    """Load escalation_lines data from escalation_daily.sqlite."""
    if not ESCALATION_DB.exists():
        return _empty_escalation_payload()

    with closing(sqlite3.connect(str(ESCALATION_DB))) as conn:
        configure_connection(conn)
        try:
            tbl = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='escalation_lines'"
            ).fetchone()
            if not tbl:
                return _empty_escalation_payload()

            dates = [r[0] for r in conn.execute(
                """
                SELECT DISTINCT EscalationDate
                FROM escalation_lines
                WHERE EscalationDate IS NOT NULL AND EscalationDate <> ''
                ORDER BY EscalationDate DESC
                """
            ).fetchall()]

            cols_sql = ', '.join(f'"{k}"' for k in ESCALATION_SHORT_KEYS)
            cur = conn.execute(f"SELECT {cols_sql} FROM escalation_lines ORDER BY EscalationDate DESC")
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            records = []
            for row in rows:
                d = dict(zip(cols, row))
                records.append({v: d.get(k, '') for k, v in ESCALATION_SHORT_KEYS.items()})

            return {
                'rows': records,
                'dates': dates,
                'generated': datetime.now().isoformat(),
            }
        except sqlite3.OperationalError as e:
            log.warning("escalation_lines table not accessible: %s", e)
            return _empty_escalation_payload()


def _storebook_zr_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.endswith(".0") and re.fullmatch(r"-?\d+\.0", text):
        return text[:-2]
    return text


def _storebook_zr_lookup_key(value: Any) -> str:
    return _storebook_zr_text(value).casefold()


def _storebook_zr_matrix_column_key(column: Any) -> str:
    return str(column).replace("\xa0", " ").strip().casefold()


def _load_storebook_zr_category_lookup() -> dict[str, str]:
    path = MASTER_DATA / "Synthetic_Vendor_Master_Matrix.csv"
    if not path.exists():
        return {}

    for encoding in ("utf-8-sig", "latin1"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                reader = csv.DictReader(handle)
                lookup: dict[str, str] = {}
                for raw in reader:
                    normalized = {
                        _storebook_zr_matrix_column_key(key): value
                        for key, value in raw.items()
                    }
                    category = _storebook_zr_text(normalized.get("category"))
                    if not category:
                        continue
                    unique_ref = _storebook_zr_lookup_key(normalized.get("unique ref"))
                    vendor = _storebook_zr_lookup_key(normalized.get("vendor"))
                    if unique_ref:
                        lookup[f"unique_ref:{unique_ref}"] = category
                    if vendor and f"vendor:{vendor}" not in lookup:
                        lookup[f"vendor:{vendor}"] = category
                return lookup
        except UnicodeDecodeError:
            continue
    return {}


def _storebook_zr_category_for_row(row: dict[str, Any], lookup: dict[str, str]) -> str:
    unique_ref = _storebook_zr_lookup_key(row.get("unique_ref"))
    supplier_id = _storebook_zr_lookup_key(row.get("supplier_id"))
    if unique_ref:
        category = lookup.get(f"unique_ref:{unique_ref}")
        if category:
            return category
    if supplier_id:
        return lookup.get(f"vendor:{supplier_id}", "")
    return ""


def _normalize_storebook_zr_payload_row(
    row: dict[str, Any],
    category_lookup: dict[str, str],
) -> dict[str, Any]:
    source = _storebook_zr_text(row.get("source"))
    if source.casefold() != "storebook":
        return row

    supplier_id = _storebook_zr_text(row.get("supplier_id"))
    current_unique_ref = _storebook_zr_text(row.get("unique_ref"))
    unique_ref = f"9001 {supplier_id}" if supplier_id else current_unique_ref
    row["source"] = "Storebook"
    row["unique_ref"] = unique_ref
    row["company_code"] = "9001"
    row["company_or_entity"] = "9001"
    row["status"] = _storebook_zr_text(row.get("status"))
    row["status_system"] = _storebook_zr_text(row.get("status_system"))

    lookup_category = _storebook_zr_category_for_row(row, category_lookup)
    row["category"] = lookup_category or _storebook_zr_text(row.get("category"))
    return row


def _derive_zr_action_dates(rows: list[dict[str, Any]]) -> None:
    history: dict[str, dict[str, Any]] = {}
    ordered = sorted(
        rows,
        key=lambda row: (
            _storebook_zr_text(row.get("snapshot_date")),
            _storebook_zr_text(row.get("source_key")),
        ),
    )
    for row in ordered:
        row["action_date_source"] = ""
        if _storebook_zr_text(row.get("source")).casefold() not in {"z & r", "zr"}:
            continue
        if _storebook_zr_text(row.get("resolution_source")) == "auto_missing_from_source":
            row["action_date"] = ""
            continue

        source_key = _storebook_zr_text(row.get("source_key"))
        state = history.setdefault(source_key, {"manual_values": None, "last_action_date": ""})
        manual_values = (
            _storebook_zr_text(row.get("status")),
            _storebook_zr_text(row.get("comments")),
        )
        explicit_action_date = _storebook_zr_text(row.get("action_date"))
        if explicit_action_date:
            row["action_date"] = explicit_action_date
            row["action_date_source"] = "manual"
            state["last_action_date"] = explicit_action_date
        elif any(manual_values) and manual_values != state["manual_values"]:
            derived_date = _storebook_zr_text(row.get("snapshot_date"))
            row["action_date"] = derived_date
            row["action_date_source"] = "derived_manual_change"
            state["last_action_date"] = derived_date
        elif state["last_action_date"]:
            row["action_date"] = state["last_action_date"]
            row["action_date_source"] = "carried_from_history"
        state["manual_values"] = manual_values


def load_storebook_zr_from_sqlite() -> dict[str, Any]:
    """Load Storebook / Z & R rows from the pack-local SQLite feed."""
    empty: dict[str, Any] = {
        "rows": [],
        "dates": [],
        "summary": {},
        "generated": datetime.now().isoformat(),
    }
    if not STOREBOOK_ZR_DB.exists():
        return empty

    with closing(sqlite3.connect(str(STOREBOOK_ZR_DB))) as conn:
        configure_connection(conn)
        try:
            table_exists = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                ("storebook_zr_lines",),
            ).fetchone()
            if not table_exists:
                return empty

            dates = [
                row[0]
                for row in conn.execute(
                    "SELECT DISTINCT snapshot_date FROM storebook_zr_lines ORDER BY snapshot_date DESC"
                ).fetchall()
            ]
            cols = [
                "source",
                "snapshot_date",
                "source_key",
                "unique_ref",
                "owner",
                "supplier_id",
                "supplier_name",
                "company_or_entity",
                "company_code",
                "category",
                "status_system",
                "value",
                "opened_date",
                "action_date",
                "action_date_source",
                "resolved_date",
                "status",
                "comments",
                "resolution_source",
                "site_id",
                "site_name",
            ]
            available_cols = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(storebook_zr_lines)").fetchall()
            }
            select_exprs = [
                f'"{col}"' if col in available_cols else f"'' AS \"{col}\""
                for col in cols
            ]
            cols_sql = ", ".join(select_exprs)
            cur = conn.execute(
                f"""
                SELECT {cols_sql}
                FROM storebook_zr_lines
                ORDER BY snapshot_date DESC, source, supplier_name
                """
            )
            category_lookup = _load_storebook_zr_category_lookup()
            rows = [
                _normalize_storebook_zr_payload_row(dict(zip(cols, row)), category_lookup)
                for row in cur.fetchall()
            ]
            _derive_zr_action_dates(rows)
            summary_rows = conn.execute(
                """
                SELECT source, snapshot_date, COUNT(*) AS row_count, COALESCE(SUM(value), 0) AS total_value
                FROM storebook_zr_lines
                GROUP BY source, snapshot_date
                ORDER BY snapshot_date DESC, source
                """
            ).fetchall()
            summary = [
                {
                    "source": row[0],
                    "snapshot_date": row[1],
                    "row_count": int(row[2] or 0),
                    "total_value": float(row[3] or 0),
                }
                for row in summary_rows
            ]
            return {
                "rows": rows,
                "dates": dates,
                "summary": summary,
                "generated": datetime.now().isoformat(),
            }
        except sqlite3.OperationalError as e:
            log.warning("storebook_zr_lines table not accessible: %s", e)
            return empty


# 
# DATA JS GENERATION
# 

def _compress_dashboard_payload(value: Any) -> str:
    payload_json = json.dumps(value, separators=(",", ":"), default=str)
    payload_bytes = zlib.compress(payload_json.encode("utf-8"), level=6)
    return base64.b64encode(payload_bytes).decode("ascii")


def _write_compressed_dashboard_chunk(filename: str, global_name: str, compressed_value: str) -> None:
    chunk_js = f"window.{global_name}={json.dumps(compressed_value)};\n"
    atomic_write_text(CHUNKS_DIR / filename, chunk_js)


def _decompress_dashboard_payload(compressed_value: str) -> Any:
    payload_bytes = base64.b64decode(compressed_value.encode("ascii"))
    return json.loads(zlib.decompress(payload_bytes).decode("utf-8"))


def _read_compressed_dashboard_chunk(filename: str, global_name: str) -> Any | None:
    path = CHUNKS_DIR / filename
    if not path.exists():
        return None
    marker = f"window.{global_name}="
    chunk_js = path.read_text(encoding="utf-8")
    start = chunk_js.find(marker)
    if start < 0:
        raise ValueError(f"{filename} does not contain {global_name}")
    raw = chunk_js[start + len(marker):].strip()
    if raw.endswith(";"):
        raw = raw[:-1]
    compressed_value = json.loads(raw)
    if not compressed_value:
        return None
    return _decompress_dashboard_payload(compressed_value)


def _merge_rows_by_week(existing_rows: list[dict[str, Any]] | None, refreshed_rows: list[dict[str, Any]], refreshed_weeks: set[str]) -> list[dict[str, Any]]:
    retained = [row for row in (existing_rows or []) if str(row.get("week") or "") not in refreshed_weeks]
    merged_rows = retained + list(refreshed_rows or [])
    return sorted(
        merged_rows,
        key=lambda row: (
            str(row.get("week") or ""),
            str(row.get("owner") or ""),
            str(row.get("source") or ""),
        ),
    )


def _summary_from_resolved_pair(pair: dict[str, Any] | None) -> dict[str, Any]:
    if not pair:
        return {
            "rw": "",
            "pw": "",
            "resolved": 0,
            "carryover": 0,
            "rate": 0.0,
            "snapshot_resolved": 0,
            "snapshot_carryover": 0,
        }
    resolved = int(pair.get("ar") or 0)
    carryover = int(pair.get("ac") or 0)
    return {
        "rw": str(pair.get("rw") or ""),
        "pw": str(pair.get("pw") or ""),
        "resolved": resolved,
        "carryover": carryover,
        "rate": round((carryover / resolved * 100), 1) if resolved else 0.0,
        "snapshot_resolved": int(pair.get("sr") or 0),
        "snapshot_carryover": int(pair.get("sc") or 0),
    }


def _merge_resolved_carryover_audit(existing: dict[str, Any] | None, refreshed: dict[str, Any], refreshed_weeks: set[str]) -> dict[str, Any]:
    existing = existing or {}
    retained_trend = [row for row in existing.get("trend", []) if str(row.get("rw") or "") not in refreshed_weeks]
    retained_rows = [row for row in existing.get("rows", []) if str(row.get("rw") or "") not in refreshed_weeks]
    trend = retained_trend + list(refreshed.get("trend") or [])
    rows = retained_rows + list(refreshed.get("rows") or [])
    trend = sorted(trend, key=lambda row: (str(row.get("rw") or ""), str(row.get("pw") or "")))
    rows = sorted(
        rows,
        key=lambda row: (
            str(row.get("rw") or ""),
            str(row.get("pw") or ""),
            str(row.get("o") or ""),
            str(row.get("s") or ""),
            str(row.get("dn") or ""),
        ),
    )
    latest_pair = trend[-1] if trend else None
    return {
        "summary": _summary_from_resolved_pair(latest_pair),
        "trend": trend,
        "rows": rows,
        "generated": datetime.now().isoformat(timespec="seconds"),
    }

def generate_data_js(data: Dict[str, Any], reuse_trend_cube: bool = False, incremental_trend_cube: bool = False) -> str:
    """Generate dashboard_data.js (core) + chunk files (progressive loading).

    Architecture (3 tiers):
      TIER 1  Core (dashboard_data.js, ~2 MB):
        metadata, filters, 2 most recent weeks, synthetic_review, statement
      TIER 2  Trend cube (data/trend_cube.js, ~500 KB):
        loaded async after initial render
      TIER 3  Week chunks (data/week_YYYY-MM-DD.js, ~1 MB each):
        loaded on-demand when user switches to a historical week

    Returns the core JS content string. Chunk files are written to CHUNKS_DIR.
    """
    global PRODUCTIVITY_TREND, PRODUCTIVITY_SCORECARD, RESOLVED_CARRYOVER_AUDIT

    weeks_data = data['weeks_data']
    sorted_weeks = sorted(data.get('all_weeks') or weeks_data.keys(), reverse=True)
    CHUNKS_DIR.mkdir(parents=True, exist_ok=True)

    # Split: core weeks (2 most recent) vs chunk weeks.
    CORE_WEEK_COUNT = 2
    core_week_keys = sorted_weeks[:CORE_WEEK_COUNT]
    chunk_week_keys = sorted_weeks[CORE_WEEK_COUNT:]
    reuse_week_chunks = reuse_trend_cube or incremental_trend_cube

    # Compress only what this run needs. Daily/weekly incremental runs reuse
    # existing historical week chunks and recompress core/new/missing weeks.
    compressed_weeks = {}
    total_orig = 0
    total_comp = 0
    compressed_count = 0
    reused_chunk_count = 0
    for week_key in sorted_weeks:
        week_path = CHUNKS_DIR / f"week_{week_key}.js"
        is_core_week = week_key in core_week_keys
        has_week_data = week_key in weeks_data
        can_reuse_chunk = reuse_week_chunks and (not is_core_week) and (not has_week_data) and week_path.exists()
        if can_reuse_chunk:
            reused_chunk_count += 1
            continue
        if not has_week_data:
            raise FileNotFoundError(
                f"Missing raw data and existing week chunk for {week_key}. "
                "Run the rebuild-all dashboard build before using incremental mode."
            )
        week_val = weeks_data[week_key]
        week_json = json.dumps(week_val, separators=(",", ":"), default=str)
        week_bytes = zlib.compress(week_json.encode("utf-8"), level=6)
        week_b64 = base64.b64encode(week_bytes).decode("ascii")
        compressed_weeks[week_key] = week_b64
        total_orig += len(week_json)
        total_comp += len(week_b64)
        compressed_count += 1
    if total_orig:
        orig_mb = total_orig / (1024 * 1024)
        comp_mb = total_comp / (1024 * 1024)
        log.info("  [OK] Per-week compression: %d compressed, %d reused, %.1f MB -> %.1f MB (%.1f%%)", compressed_count, reused_chunk_count, orig_mb, comp_mb, comp_mb/orig_mb*100)
    else:
        log.info("  [OK] Per-week compression: 0 compressed, %d reused", reused_chunk_count)

    missing_core_weeks = [w for w in core_week_keys if w not in compressed_weeks]
    if missing_core_weeks:
        raise FileNotFoundError(f"Missing compressed core week data: {missing_core_weeks}")
    core_compressed = {w: compressed_weeks[w] for w in core_week_keys}
    log.info("  [OK] Core weeks: %s", core_week_keys)
    log.info("  [OK] Chunk weeks: %d files expected", len(chunk_week_keys))

    # Year Trend Cube. Daily can reuse it; weekly can update latest/new weeks;
    # rebuild-all regenerates from scratch.
    cube_path = CHUNKS_DIR / "trend_cube.js"
    cube_js = ""
    if reuse_trend_cube:
        if not cube_path.exists():
            raise FileNotFoundError(
                f"Cannot reuse Year Trend Cube because {cube_path} does not exist. "
                "Run the rebuild-all dashboard build first."
            )
        cube_js = cube_path.read_text(encoding="utf-8")
        log.info("  [SKIP] Year Trend Cube reused from %s (%.1f KB)", cube_path, len(cube_js) / 1024)
    else:
        if incremental_trend_cube:
            if not cube_path.exists():
                raise FileNotFoundError(
                    f"Cannot increment Year Trend Cube because {cube_path} does not exist. "
                    "Run the rebuild-all dashboard build first."
                )
            existing_cube = _load_trend_cube_from_js(cube_path.read_text(encoding="utf-8"))
            year_trend_cube = _merge_incremental_trend_cube(existing_cube, weeks_data, sorted_weeks)
        else:
            year_trend_cube = compute_year_trend_cube(weeks_data, sorted_weeks)
        log.info("  [OK] Year Trend Cube: %d combos", len(year_trend_cube['combos']))
        cube_json = json.dumps(year_trend_cube, separators=(",", ":"), default=str)
        data['_cached_year_trend_cube_json'] = cube_json
        try:
            atomic_write_text(OUTPUT_CUBE_LEDGER, cube_json)
            log.info("  [OK] Cube saved: %s (%.1f KB)", OUTPUT_CUBE_LEDGER, len(cube_json) / 1024)
        except Exception as e:
            log.warning("  Could not save cube JSON: %s", e)
        cube_js = f"// Auto-generated - Year Trend Cube\nwindow._TREND_CUBE={cube_json};\n"
        atomic_write_text(cube_path, cube_js)
        log.info("  [OK] trend_cube.js: %.1f KB", len(cube_js) / 1024)

    # Productivity metrics use week/pair caches for daily/full incremental runs; rebuild-all recomputes everything.
    use_productivity_cache = reuse_trend_cube or incremental_trend_cube
    incremental_metrics = use_productivity_cache and len(weeks_data) < len(sorted_weeks)
    refreshed_weeks = set(weeks_data.keys())
    if incremental_metrics:
        log.info("  [..] Productivity incremental merge for %d refreshed weeks over %d dashboard weeks", len(refreshed_weeks), len(sorted_weeks))
        refreshed_trend = compute_productivity_trend(weeks_data, use_cache=use_productivity_cache)
        existing_trend = _read_compressed_dashboard_chunk("productivity_trend.js", "_PRODUCTIVITY_TREND_COMPRESSED")
        if existing_trend is None:
            raise FileNotFoundError("Missing productivity_trend.js; run the rebuild-all dashboard build before incremental mode")
        PRODUCTIVITY_TREND = _merge_rows_by_week(existing_trend, refreshed_trend, refreshed_weeks)

        refreshed_scorecard = compute_productivity_scorecard(weeks_data, use_cache=use_productivity_cache)
        existing_scorecard = _read_compressed_dashboard_chunk("productivity_scorecard.js", "_PRODUCTIVITY_SCORECARD_COMPRESSED")
        if existing_scorecard is None:
            raise FileNotFoundError("Missing productivity_scorecard.js; run the rebuild-all dashboard build before incremental mode")
        PRODUCTIVITY_SCORECARD = _merge_rows_by_week(existing_scorecard, refreshed_scorecard, refreshed_weeks)

        refreshed_carryover = compute_resolved_carryover_audit(weeks_data, use_cache=use_productivity_cache)
        existing_carryover = _read_compressed_dashboard_chunk("resolved_carryover.js", "_RESOLVED_CARRYOVER_COMPRESSED")
        if existing_carryover is None:
            raise FileNotFoundError("Missing resolved_carryover.js; run the rebuild-all dashboard build before incremental mode")
        RESOLVED_CARRYOVER_AUDIT = _merge_resolved_carryover_audit(existing_carryover, refreshed_carryover, refreshed_weeks)
    else:
        PRODUCTIVITY_TREND = compute_productivity_trend(weeks_data, use_cache=use_productivity_cache)
        PRODUCTIVITY_SCORECARD = compute_productivity_scorecard(weeks_data, use_cache=use_productivity_cache)
        RESOLVED_CARRYOVER_AUDIT = compute_resolved_carryover_audit(weeks_data, use_cache=use_productivity_cache)
    log.info("  [OK] Productivity Trend: %d entries", len(PRODUCTIVITY_TREND))
    log.info("  [OK] Productivity Scorecard: %d entries", len(PRODUCTIVITY_SCORECARD))
    try:
        write_resolved_carryover_audit(RESOLVED_CARRYOVER_AUDIT)
    except Exception as e:
        log.warning("  Could not save resolved carryover audit: %s", e)

    # TIER 3: One file per historical week.
    expected_chunk_names = set()
    written_chunks = 0
    reused_chunks = 0
    for week_key in chunk_week_keys:
        week_path = CHUNKS_DIR / f"week_{week_key}.js"
        expected_chunk_names.add(week_path.name)
        if week_key not in compressed_weeks and week_path.exists():
            reused_chunks += 1
            continue
        if week_key not in compressed_weeks:
            raise FileNotFoundError(f"Missing compressed data for {week_key}; run rebuild-all")
        week_js = (
            f"window._WEEK_CHUNKS=window._WEEK_CHUNKS||{{}};"
            f'window._WEEK_CHUNKS["{week_key}"]="{compressed_weeks[week_key]}";'
        )
        atomic_write_text(week_path, week_js)
        written_chunks += 1
    pruned_chunks = 0
    for stale in CHUNKS_DIR.glob("week_*.js"):
        if stale.name not in expected_chunk_names:
            stale.unlink()
            pruned_chunks += 1
    if chunk_week_keys:
        log.info("  [OK] %d week chunks written, %d reused in %s", written_chunks, reused_chunks, CHUNKS_DIR)
    if pruned_chunks:
        log.info("  [OK] Pruned %d stale week chunk files from %s", pruned_chunks, CHUNKS_DIR)

    #  Build CORE payload (TIER 1) 
    payload = {
        "generated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "sorted_weeks": sorted_weeks,
        "chunk_weeks": chunk_week_keys,
        "filters": {
            "countries": data['countries'],
            "company_codes": data['company_codes'],
            "statuses": data['statuses'],
            "query_types": data['query_types'],
            "owners": data['owners'],
            "vendor_categories": data.get('vendor_categories', []),
            "payment_blocks": data.get('payment_blocks', []),
        },
        "compressed_weeks": core_compressed,
    }

    # SyntheticReview data
    synthetic_review_data = data.get('synthetic_review')
    if synthetic_review_data:
        synthetic_review_json = json.dumps(synthetic_review_data, separators=(",", ":"), default=str)
        synthetic_review_bytes = zlib.compress(synthetic_review_json.encode("utf-8"), level=6)
        synthetic_review_b64 = base64.b64encode(synthetic_review_bytes).decode("ascii")
        payload['synthetic_review_compressed'] = synthetic_review_b64
        log.info("  [OK] SyntheticReview: %.1f KB -> %.1f KB", len(synthetic_review_json)/1024, len(synthetic_review_b64)/1024)
    else:
        payload['synthetic_review_compressed'] = ''

    # Statement data
    stmt_data = data.get('statement')
    if stmt_data:
        stmt_json = json.dumps(stmt_data, separators=(",", ":"), default=str)
        stmt_bytes = zlib.compress(stmt_json.encode("utf-8"), level=6)
        stmt_b64 = base64.b64encode(stmt_bytes).decode("ascii")
        payload['statement_compressed'] = stmt_b64
        log.info("  [OK] Statement: %.1f KB -> %.1f KB", len(stmt_json)/1024, len(stmt_b64)/1024)
    else:
        payload['statement_compressed'] = ''

    # Escalation data
    escalation_data = data.get('escalation')
    if escalation_data and escalation_data.get('rows'):
        escalation_json = json.dumps(escalation_data, separators=(",", ":"), default=str)
        escalation_bytes = zlib.compress(escalation_json.encode("utf-8"), level=6)
        escalation_b64 = base64.b64encode(escalation_bytes).decode("ascii")
        payload['escalation_compressed'] = escalation_b64
        log.info(
            "  [OK] Escalation: %.1f KB -> %.1f KB",
            len(escalation_json) / 1024,
            len(escalation_b64) / 1024,
        )
    else:
        payload['escalation_compressed'] = ''

    # Storebook / Z & R data
    storebook_zr_data = data.get('storebook_zr')
    if isinstance(storebook_zr_data, list):
        storebook_zr_data = {'rows': storebook_zr_data}
    if storebook_zr_data and storebook_zr_data.get('rows'):
        for row in storebook_zr_data.get('rows', []):
            if isinstance(row, dict):
                source = str(row.get('source') or '').strip().upper().replace(' ', '')
                row['source'] = 'ZR' if source in {'ZR', 'Z&R', 'ZANDR'} else 'STOREBOOK'
        storebook_zr_json = json.dumps(storebook_zr_data, separators=(",", ":"), default=str)
        storebook_zr_bytes = zlib.compress(storebook_zr_json.encode("utf-8"), level=6)
        storebook_zr_b64 = base64.b64encode(storebook_zr_bytes).decode("ascii")
        payload['storebook_zr_compressed'] = storebook_zr_b64
        log.info(
            "  [OK] Storebook/ZR: %.1f KB -> %.1f KB",
            len(storebook_zr_json) / 1024,
            len(storebook_zr_b64) / 1024,
        )
    else:
        payload['storebook_zr_compressed'] = ''

    # Productivity trend
    if PRODUCTIVITY_TREND:
        prod_b64 = _compress_dashboard_payload(PRODUCTIVITY_TREND)
        log.info("  [OK] Productivity trend: %d entries -> %.1f KB", len(PRODUCTIVITY_TREND), len(prod_b64)/1024)
    else:
        prod_b64 = ''
    _write_compressed_dashboard_chunk(
        "productivity_trend.js",
        "_PRODUCTIVITY_TREND_COMPRESSED",
        prod_b64,
    )

    if PRODUCTIVITY_SCORECARD:
        scorecard_b64 = _compress_dashboard_payload(PRODUCTIVITY_SCORECARD)
        log.info("  [OK] Productivity scorecard: %d entries -> %.1f KB", len(PRODUCTIVITY_SCORECARD), len(scorecard_b64)/1024)
    else:
        scorecard_b64 = ''
    _write_compressed_dashboard_chunk(
        "productivity_scorecard.js",
        "_PRODUCTIVITY_SCORECARD_COMPRESSED",
        scorecard_b64,
    )

    # Resolution Quality audit
    if RESOLVED_CARRYOVER_AUDIT:
        carry_b64 = _compress_dashboard_payload(RESOLVED_CARRYOVER_AUDIT)
        log.info(
            "  [OK] Resolved carryover: %d rows -> %.1f KB",
            len(RESOLVED_CARRYOVER_AUDIT.get("rows", [])),
            len(carry_b64) / 1024,
        )
    else:
        carry_b64 = ''
    _write_compressed_dashboard_chunk(
        "resolved_carryover.js",
        "_RESOLVED_CARRYOVER_COMPRESSED",
        carry_b64,
    )

    payload_json = json.dumps(payload, separators=(",", ":"), default=str)
    ts = datetime.now().strftime('%Y-%m-%d %H:%M')
    js_content = (
        f"// Auto-generated by Rol_Query.py  DO NOT EDIT\n"
        f"// Generated: {ts}\n"
        f"// Core: {len(core_week_keys)} weeks inline, "
        f"{len(chunk_week_keys)} weeks as chunks, trend cube separate\n"
        f"window.DASHBOARD_DATA = {payload_json};\n"
    )
    log.info("  [OK] dashboard_data.js (core): %.1f KB", len(js_content) / 1024)
    log.info("  [OK] Total data: core %.1f KB + cube %.1f KB + %d chunks",
             len(js_content) / 1024, len(cube_js) / 1024, len(chunk_week_keys))
    return js_content
