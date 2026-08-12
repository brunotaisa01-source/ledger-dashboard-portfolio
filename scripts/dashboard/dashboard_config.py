#!/usr/bin/env python3
"""
AP CONTROL DASHBOARD V19 - Configuration Module
All constants, paths, themes, and shared config.
Split from Rol_Query.py for maintainability.
"""

import os
from pathlib import Path
from datetime import datetime

from ..utils.paths import LEDGER_DB, KEY_DB, DASHBOARD_DIR, LIBS_DIR, SYNTHETIC_REVIEW_DB


# 
# PURE HELPERS
# 

def _normalize_vc(v: str) -> str:
    """Normalize Vendor Category: Title Case + fix acronyms/typos."""
    s = v.strip().title()
    s = s.replace('Ftg', 'FTG').replace('Cng', 'CNG')
    # Fix "It" only as standalone word (not inside Litigation, Utilities, etc.)
    words = s.split()
    words = ['IT' if w == 'It' else w for w in words]
    # Also handle "It/" prefix like "It/Something"
    words = [w.replace('It/', 'IT/') if w.startswith('It/') else w for w in words]
    s = ' '.join(words)
    s = s.replace('Payroll/Hr', 'Payroll/HR')
    s = s.replace('Transpport', 'Transport')
    return s


# 
# PATHS & DATABASE
# 

SQLITE_PATH = LEDGER_DB
KEY_SQLITE_PATH = KEY_DB

def get_output_html_path():
    """Lazy generation of output HTML filename (avoids side effect on import)."""
    return Path(f"ROL_Dashboard_V1_{datetime.now().strftime('%Y_%m_%d_%H%M')}.html")

# AUTO-COPY: SQLite source from the generator script output
SQLITE_SOURCE = LEDGER_DB


# 
# HELPER MODE CONFIG
# Set HELPER_MODE = True to generate a lightweight HTML that
# fetches data from the Go helper server instead of embedding
# compressed data blobs.
# 
HELPER_MODE = False
HELPER_PORT = 17831
HELPER_BIND = "127.0.0.1"
# Local Fixture Store pack: pack_env.bat MUST set DASHBOARD_OUTPUT_DIR to this pack's
# own dashboard folder. The fallback is a pack-local sentinel so a bare run can
# never publish to an external destination.
_DEFAULT_PACK_OUTPUT = DASHBOARD_DIR / "out_unscoped"
OUTPUT_DIR = Path(os.environ.get("DASHBOARD_OUTPUT_DIR", _DEFAULT_PACK_OUTPUT))
OUTPUT_CUBE_LEDGER = OUTPUT_DIR / "data" / "year_trend_cube_ledger.json"
OUTPUT_DASHBOARD = OUTPUT_DIR / "dashboard.html"


# 
# JSON MODE: Static HTML template + external dashboard_data.js
# - dashboard.html  = template (generated once, never changes)
# - dashboard_data.js = data (updated daily by automation)
# Works from synced folders without a server.
# 
JSON_MODE = True
JSON_LOCAL_DIR = Path(os.environ.get("DASHBOARD_LOCAL_DIR", DASHBOARD_DIR))
JSON_SDRIVE_DIR = OUTPUT_DIR


# 
# UI THEME: "classic" = original V19, "modern" = novo visual executivo
# Para reverter: trocar "modern" por "classic" e regenerar
# 
UI_THEME = "classic"


# 
# DASHBOARD YEAR FILTER
# Controls which weeks are loaded into the dashboard.
#   DASHBOARD_YEAR = 2026   -> loads only 2026 weeks + last week of 2025
#   DASHBOARD_YEAR = None   -> loads ALL weeks (no filter)
# 
DASHBOARD_YEAR = 2026


COLORS = {
    'primary': '#028090', 'secondary': '#00A896', 'accent': '#02C39A',
    'dark': '#1E2761', 'green': '#28A745', 'red': '#DC3545',
    'orange': '#FF6B35', 'yellow': '#FFC107',
}


# 
# MODERN THEME CSS OVERRIDE
# Injected as a second <style> block AFTER the original CSS.
# CSS cascade ensures these win (same specificity, later declaration).
# 
# Dark theme CSS is now loaded via _load_css() with [data-theme="dark"] selectors
# No need for separate style block or disabled attribute


# 
# SHARED JS STATE VARIABLES  single source of truth
# Used by BOTH embedded mode and helper mode.
# In embedded mode, SORTED_WEEKS is a populated const.
# In helper mode, SORTED_WEEKS starts as [] (set later in init).
# 
_JS_STATE_VARS = """
// Using var (not let) so these are window properties  enables window[name] = value in FILTER_DEFAULTS reset loop
var currentWeek = SORTED_WEEKS[0];
var countryFilter = new Set(), companyFilter = new Set(), statusFilter = new Set(), queryTypeFilter = new Set(), ownerFilter = new Set();
var balanceTypeFilter = new Set(), viewModeFilter = 'VALUE', prodTeamFilter = '';
var docCategoryFilter = new Set();
var workedCategoryFilter = '';
var prodDateFrom = '';
var prodDateTo = '';
var supplierSearchFilter = '';
var vendorCategoryFilter = new Set();
var paymentBlockFilter = new Set();
var movementTeamFilter = '';
var movementStatusFilter = '';
var movWeek1 = SORTED_WEEKS[0];
var movWeek2 = SORTED_WEEKS.length > 1 ? SORTED_WEEKS[1] : SORTED_WEEKS[0];
var globalBucketFilter = new Set();
var charts = {};
var tableLimits = { overview: 10, key: 10, rol: 10, prod: 9999, movement: 10, synthetic_review: 10, synthetic_reviewDupes: 10, synthetic_reviewErrors: 10, stmt: 10, stmtNoStmt: 10, resolvedCarryover: 10 };
var pageState = { overview: 1, key: 1, movement: 1, rol: 1, workedSuppliers: 1, resolvedCarryover: 1, synthetic_review: 1, synthetic_reviewDupes: 1, synthetic_reviewErrors: 1, stmt: 1, stmtNoStmt: 1 };
var pageData = { overview: [], key: [], movement: [], rol: [], workedSuppliers: [], resolvedCarryover: [], synthetic_review: [], synthetic_reviewDupes: [], synthetic_reviewErrors: [], stmt: [], stmtNoStmt: [] };
var _paginating = false;
var overdueWeek1 = SORTED_WEEKS[0];
var overdueWeek2 = SORTED_WEEKS.length > 1 ? SORTED_WEEKS[1] : SORTED_WEEKS[0];
var overdueTeamFilter = new Set();
var overdueAgingFilter = new Set();
var overdueCountrySlice = '';
var overdueCompanyFilter = new Set();
var topSupplierBalanceType = 'ALL';
var rolBalanceTypeFilter = 'ALL';
var overviewTeamFilter = '';
var overviewTableTeamFilter = '';
var keyBalanceTypeFilter = 'ALL';


// SyntheticReview tab state
let synthetic_reviewData = null;
let synthetic_reviewCharts = {};

// Statement tab state
let stmtData = null;
let stmtCharts = {};
let stmtCoverageCache = null;
"""

# 
# PAYMENT DOC TYPES  used by loader for RowLevel/DocClass classification
# 
PAYMENT_DOC_TYPES = {"KS", "SA", "DZ", "KZ", "ZP", "ZR", "ZE", "AB", "K1", "K5", "SE"}


CURRENCY_MAP = {
    'UK': 'GBP', 'GB': 'GBP', 'UNITED KINGDOM': 'GBP',
    'ENGLAND': 'GBP', 'SCOTLAND': 'GBP', 'WALES': 'GBP',
}


# 
# SYNTHETIC_REVIEW SHORT KEY MAPPING
# Maps full column names to short keys for data compression.
# 
SYNTHETIC_REVIEW_SHORT_KEYS = {
    'SnapshotDate':       'sd',
    'SourceType':         'st',
    'PairID':             'pid',
    'Risk':               'rk',
    'System':             'sys',
    'DivisionRef':        'dr',
    'Division':           'div',
    'VendorNo':           'vn',
    'VendorName':         'vname',
    'Region':             'reg',
    'InvoiceDate':        'id',
    'PostedDate':         'pd',
    'Deleted':            'del',
    'ClosedDate':         'cd',
    'InvoiceNo':          'ino',
    'InternalRef':        'iref',
    'InvoiceAmount':      'amt',
    'AmountBase':         'amtb',
    'Currency':           'cur',
    'IdentifiedDate':     'idd',
    'AgeDays':            'age',
    'ErrorType':          'et',
    'Classification':     'cls',
    'Reason':             'rsn',
    'RecoveryStatus':     'rs',
    'AssignedUser':       'au',
    'DocType':            'dt',
    'CompanyCode':        'cc',
    'Comments':           'cmt',
    'ValueFlag':          'vf',
    'HasAttachment':      'att',
    'UniqueRef':          'ur',
    'Category':           'cat',
    'Owner':              'o',
    'Team':               'tm',
}

# 
# STATEMENT SHORT KEY MAPPING
# Maps full column names to short keys for data compression.
# 
STATEMENT_SHORT_KEYS = {
    'SnapshotDate':       'sd',
    'RecID':              'rid',
    'RecStatus':          'rs',
    'VendorNos':          'vnos',
    'VendorNames':        'vn',
    'VendorGroup':        'vg',
    'LedgerDate':         'ld',
    'CreatedDate':        'crd',
    'ReconciledDate':     'rcd',
    'EarliestInvoiceDate': 'eid',
    'LedgerBalance':      'lb',
    'StatementBalance':   'sb',
    'Difference':         'dif',
    'LineItems':          'li',
    'ActionsPending':     'ap',
    'StatementType':      'stt',
    'ReconciledBy':       'rb',
    'AssignedUser':       'au',
    'CompanyCodes':       'cc',
    'Country':            'cty',
    'PrimaryCompanyCode': 'pcc',
    'Category':           'cat',
    'Owner':              'o',
    'Team':               'tm',
    'ProblemInvoices':    'pi',
    'CopyRequested':      'cr',
    'RequestCopy':        'rc',
    'Investigate':        'inv',
    'Unposted':           'up',
    'AllRecComments':     'cmt',
}


# 
# TEAM CONFIG  Python mirror of dashboard/js/00_config.js
# Used by dashboard_html.py to generate team page HTML dynamically.
# To add a new team: add entry here AND in 00_config.js.
# 
TEAM_CONFIG = {
    'ROL': {
        'label': 'ROL Team',
        'subtitle': 'Full aging spectrum \u2014 0-30 through 180+ days overdue',
        'icon': 'chart-bar',
        'color': '#028090',
        'color_hex': '#028090',
        'aging_chart_title': 'ROL Aging Buckets',
        'aging_chart_icon': 'chart-bar',
        'chart_height': 180,
        'table_icon_color': 'var(--orange)',
        'balance_type_filter_id': 'rolBalanceTypeFilter',
        'balance_type_style': 'select',   # 'select' = dropdown, 'buttons' = toggle buttons
        'priority_filter_id': 'rolPriorityFilter',
        'page_size_id': 'rolPageSize',
        'export_fn': 'exportROLCSV',
        'extras': ['trendChart', 'rootCauseChart'],
    },
    'KEY': {
        'label': 'Key Team',
        'subtitle': 'Full aging spectrum \u2014 0-30 through 180+ days overdue',
        'icon': 'key',
        'color': '#6F42C1',
        'color_hex': '#6F42C1',
        'aging_chart_title': 'Key Aging Buckets (0-30 to 180+)',
        'aging_chart_icon': 'chart-bar',
        'chart_height': 200,
        'table_icon_color': '#6F42C1',
        'balance_type_filter_id': 'keyBalanceTypeDropdown',
        'balance_type_style': 'buttons',   # Key uses toggle buttons
        'priority_filter_id': 'keyPriorityFilter',
        'page_size_id': 'keyPageSize',
        'export_fn': 'exportKeyCSV',
        'extras': ['trendChart'],
    },
    #  Future teams 
    # 'PAYMENT': { 'label': 'Payment Team', 'icon': 'credit-card', ... },
    # 'ESCALATION': { 'label': 'Escalation', 'icon': 'arrow-up-right-dots', ... },
}
