#!/usr/bin/env python3
"""Load Ledger Weekly  parse Excel ledger/key data and load into SQLite databases."""
from __future__ import annotations

import argparse
import logging
import re
import sqlite3
import sys
import time
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, Tuple, Set

import pandas as pd

# =========================
# CONFIG
# =========================
from ..utils.paths import (
    MASTER_DATA, KEY_DATA, LEDGER_DATA, KEY_DB, LEDGER_DB,
    KEY_ARCHIVE, LEDGER_ARCHIVE, SQL_DIR,
    archive_old_files, collect_all_files,
)
from ..utils.db_helpers import staged_databases
from ..utils.masterdata_core import (
    allowed_ledger_owners,
    current_ledger_owners,
    load_key_team_owners,
)
from ..dashboard.dashboard_config import PAYMENT_DOC_TYPES

# SQL layer  reads indexes/views/summary from sql/ files when available
try:
    from ..utils.sql_loader import execute_sql_file, load_named_queries
    _SQL_AVAILABLE = True
except ImportError:
    _SQL_AVAILABLE = False

INPUT_PATHS = [KEY_DATA, LEDGER_DATA]

OUTPUT_KEY_SQLITE = KEY_DB
OUTPUT_LEDGER_SQLITE = LEDGER_DB

KEY_TABLE = "key_lines"
LEDGER_TABLE = "ledger_lines"

# Views Key (detail/header e ultima semana)
KEY_VIEW_DETAIL = "key_detail"
KEY_VIEW_HEADERS = "key_headers"
KEY_VIEW_LATEST_DETAIL = "latest_week_key_detail"
KEY_VIEW_LATEST_HEADERS = "latest_week_key_headers"

# Views Ledger (detail/header e ultima semana)
LEDGER_LATEST_VIEW_ALL = "latest_week_ledger_all"
LEDGER_LATEST_VIEW_ROL = "latest_week_rol"
# LEDGER_LATEST_VIEW_QUERY removed: QUERY merged into ROL (migration 99_migrate_query_to_rol.sql)

LEDGER_VIEW_DETAIL = "ledger_detail"
LEDGER_VIEW_HEADERS = "ledger_headers"
LEDGER_VIEW_LATEST_DETAIL = "latest_week_ledger_detail"
LEDGER_VIEW_LATEST_HEADERS = "latest_week_ledger_headers"

RECURSIVE = False
ONLY_LATEST_SNAPSHOT = False  # False = historico

# REBUILD: controlled via --rebuild flag (default: False = incremental)
REBUILD_LEDGER_TABLE = False
REBUILD_KEY_TABLE = False

# Carrega todas as abas exceto Summary e so abas que tenham coluna Sheet
SKIP_TABS = {"summary"}
REQUIRED_COLS_ANY = {"sheet"}  # precisa existir coluna "Sheet"

# =========================
# TABS (ABAS) PERMITIDAS
# =========================
# >>> Independente do nome do arquivo. Se a aba nao estiver aqui, nao carrega.
KEY_TABS = load_key_team_owners(str(MASTER_DATA / "Owner_map.csv"))


def load_current_ledger_tab_owners(owner_map_path=None) -> Set[str]:
    return current_ledger_owners(owner_map_path=owner_map_path)


def load_allowed_ledger_tab_owners(owner_map_path=None) -> Set[str]:
    return allowed_ledger_owners(owner_map_path=owner_map_path)


CURRENT_LEDGER_TABS = load_current_ledger_tab_owners()
LEDGER_TABS = load_allowed_ledger_tab_owners()

# =========================
# DOCUMENTOS EXCLUIDOS
# =========================
# (Unique Ref, Document Number)  removidos do carregamento.
EXCLUDED_DOCUMENTS = {
    ("SYN-CC-011 1000273", "100021812"),   # Synthetic Retail EGOTM
    ("SYN-CC-011 1000273", "100029890"),   # Synthetic Retail EGOTM
    ("SYN-CC-011 1000273", "100032320"),   # Synthetic Retail EGOTM
}

# =========================
# COLUNAS (ALLOWLIST)
# =========================
KEY_ALLOWED_BASE = {
    "Country", "Vendor category", "Company Code", "Supplier", "Name 1",
    "Document Date", "Document Number", "Reference", "Amount in doc. curr.",
    "Document Type", "Net due date", "Document currency", "Posting Date",
    "Payment Block",
    "07-30 Days overdue", "31-60 Days overdue", "61-90 Days overdue",
    "91-120 Days Overdue", "121-180 Days Overdue", "180> Days Overdue",
    "TOTAL VALUE", "TOTAL VOL", "Total Value Over 90",
    "Query type", "Status", "AP Specialist comment", "Next Step", "Action Date",
    "TL Comment", "Review Date", "Open Payment", "Sheet", "Owner", "Text", "Unique Ref",
    "System", "User name", "Payment Issues",
    "Review this week", "Complete",
    "07-30 Days overdue (Unified)",
}

LEDGER_ALLOWED_BASE = {
    "Country", "System", "Vendor category", "Company Code", "Supplier", "Name 1",
    "Document Date", "Document Number", "Reference", "Amount in doc. curr.",
    "Document Type", "Net due date", "Document currency", "Posting Date",
    "Payment Block",
    "0-30 Days overdue", "31-60 Days overdue", "61-90 Days overdue",
    "91-120 Days Overdue", "121-180 Days Overdue", "180> Days Overdue",
    "TOTAL VALUE", "TOTAL VOL", "Total Value Over 90",
    "Query type", "Status", "AP Specialist comment", "Next Step", "Action Date",
    "TL Comment", "Review Date",
    "Open Payment", "Sheet", "Previous Owner", "Owner", "Text", "Unique Ref",
    "User name", "Payment Issues",
    "Review this week", "Complete",
}

META_COLUMNS = {
    "SourceFile", "SourcePath", "SourceTab",
    "SnapshotDate", "WeekStart", "LoadDate",
    "SnapshotDateISO", "WeekStartISO", "ISOYear", "ISOWeek",
    "RowLevel", "DocClass",
}

MAX_LEDGER_COLS = 250
MAX_KEY_COLS = 300

# =========================
# LOG
# =========================
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("weekly_split_loader_safe_final")

# =========================
# PADRONIZACAO DE COLUNAS
# =========================
def _norm_col(name: str) -> str:
    s = str(name).strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower()

COLUMN_RENAMES: Dict[str, str] = {
    _norm_col("Amount in doc. curr"): "Amount in doc. curr.",
    _norm_col("Amount in doc. curr."): "Amount in doc. curr.",
    _norm_col("Document number"): "Document Number",
    _norm_col("Document Number"): "Document Number",
    _norm_col("Document type"): "Document Type",
    _norm_col("Document Type"): "Document Type",
    _norm_col("Posting date"): "Posting Date",
    _norm_col("Posting Date"): "Posting Date",
    _norm_col("Document date"): "Document Date",
    _norm_col("Document Date"): "Document Date",
    _norm_col("Company code"): "Company Code",
    _norm_col("Company Code"): "Company Code",
    _norm_col("Total value"): "TOTAL VALUE",
    _norm_col("TOTAL VALUE"): "TOTAL VALUE",
    _norm_col("Total vol"): "TOTAL VOL",
    _norm_col("TOTAL VOL"): "TOTAL VOL",
    _norm_col("Query Type"): "Query type",
    _norm_col("Query type"): "Query type",
    _norm_col("User Name"): "User name",
    _norm_col("User name"): "User name",
    _norm_col("Vendor Category"): "Vendor category",
    _norm_col("Vendor category"): "Vendor category",
    _norm_col("Name1"): "Name 1",
    _norm_col("Name 1"): "Name 1",
    _norm_col("0-30 Days Overdue"): "0-30 Days overdue",
    _norm_col("0-30 Days overdue"): "0-30 Days overdue",
    _norm_col("07-30 Days Overdue"): "07-30 Days overdue",
    _norm_col("07-30 Days overdue"): "07-30 Days overdue",
    _norm_col("7-30 Days Overdue"): "07-30 Days overdue",
    _norm_col("31-60 Days Overdue"): "31-60 Days overdue",
    _norm_col("31-60 Days overdue"): "31-60 Days overdue",
    _norm_col("61-90 Days Overdue"): "61-90 Days overdue",
    _norm_col("61-90 Days overdue"): "61-90 Days overdue",
    _norm_col("91-120 Days overdue"): "91-120 Days Overdue",
    _norm_col("91-120 Days Overdue"): "91-120 Days Overdue",
    _norm_col("121 - 180"): "121-180 Days Overdue",
    _norm_col("121-180"): "121-180 Days Overdue",
    _norm_col("121 - 180 Overdue"): "121-180 Days Overdue",
    _norm_col("121 - 180 Days Overdue"): "121-180 Days Overdue",
    _norm_col("121-180 Days Overdue"): "121-180 Days Overdue",
    _norm_col("180>"): "180> Days Overdue",
    _norm_col("180 >"): "180> Days Overdue",
    _norm_col("180> Days Overdue"): "180> Days Overdue",
}

def normalize_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = (pd.Index(df.columns)
        .map(lambda c: str(c).strip())
        .map(lambda c: re.sub(r"\s+", " ", c))
    )
    return df

def canonicalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    rename_map: Dict[str, str] = {}
    for col in out.columns:
        key = _norm_col(col)
        if key in COLUMN_RENAMES:
            rename_map[col] = COLUMN_RENAMES[key]
    if rename_map:
        out = out.rename(columns=rename_map)

    cols = list(out.columns)
    seen: Dict[str, list[int]] = {}
    for i, c in enumerate(cols):
        seen.setdefault(c, []).append(i)

    for name, idxs in list(seen.items()):
        if len(idxs) <= 1:
            continue
        base = out.iloc[:, idxs[0]].copy()
        for j in idxs[1:]:
            base = base.combine_first(out.iloc[:, j])
        keep_positions = []
        used = False
        for pos, colname in enumerate(cols):
            if colname == name:
                if not used:
                    keep_positions.append(pos)
                    used = True
            else:
                keep_positions.append(pos)
        out = out.iloc[:, keep_positions].copy()
        out[name] = base
    return out

# =========================
# RowLevel + DocClass
# =========================
def add_rowlevel_and_docclass(df: pd.DataFrame) -> pd.DataFrame:
    """RowLevel igual ao Summary: Detail se Document Number preenchido."""
    out = df.copy()
    if "Document Number" in out.columns:
        doc = (out["Document Number"].fillna("").astype(str).str.strip()
               .str.replace(r"\.0$", "", regex=True))
        is_detail = doc.ne("")
    else:
        is_detail = pd.Series(True, index=out.index)
    out["RowLevel"] = is_detail.map(lambda x: "Detail" if x else "Header")

    out["DocClass"] = "Other"
    out.loc[out["RowLevel"] == "Header", "DocClass"] = "Header"

    dt = out["Document Type"].astype(str).str.strip().str.upper() if "Document Type" in out.columns else None
    amt = pd.to_numeric(out["Amount in doc. curr."], errors="coerce") if "Amount in doc. curr." in out.columns else None

    mask_detail = out["RowLevel"] == "Detail"
    if dt is not None:
        out.loc[mask_detail & dt.isin(PAYMENT_DOC_TYPES), "DocClass"] = "Payment"
    if amt is not None:
        mask_other = mask_detail & (out["DocClass"] == "Other") & amt.notna()
        out.loc[mask_other & (amt < 0), "DocClass"] = "CreditNote"
        out.loc[mask_other & (amt > 0), "DocClass"] = "Invoice"
    return out

# =========================
# Snapshot / leitura
# =========================
@dataclass(frozen=True)
class FileScanResult:
    file: Path
    loaded_rows: int
    loaded_tabs: int
    skipped_tabs: int

def extract_snapshot_date_from_filename(path: Path) -> date:
    name = path.stem
    today = date.today()
    m = re.search(r"(\d{2})[-_.](\d{2})[-_.](\d{4})", name)
    if m:
        dd, mm, yyyy = map(int, m.groups())
        return date(yyyy, mm, dd)
    m = re.search(r"(\d{4})[-_.](\d{2})[-_.](\d{2})", name)
    if m:
        yyyy, mm, dd = map(int, m.groups())
        return date(yyyy, mm, dd)
    m = re.search(r"(\d{2})[-_.](\d{2})(?![-_.]\d{2,4})", name)
    if m:
        dd, mm = map(int, m.groups())
        candidates: list[date] = []
        for yyyy in (today.year - 1, today.year, today.year + 1):
            try:
                candidates.append(date(yyyy, mm, dd))
            except ValueError:
                pass
        if candidates:
            return min(candidates, key=lambda d: abs((d - today).days))
    return today

def add_week_fields(df: pd.DataFrame, snapshot: date) -> pd.DataFrame:
    """Derive week/snapshot fields from the snapshot date (extracted from filename).

    IMPORTANT: Both WeekStartISO and SnapshotDateISO are normalized to the Monday
    of that week. This means Ledger 17.03.xlsx (Tuesday) and Ledger 16.03.xlsx (Monday)
    both produce WeekStartISO = SnapshotDateISO = '2026-03-16'.
    This prevents duplicates when files from different days of the same week are loaded.
    """
    df = df.copy()
    snapshot_dt = pd.Timestamp(snapshot)
    week_start = (snapshot_dt - pd.Timedelta(days=int(snapshot_dt.dayofweek))).date()
    df["SnapshotDate"] = week_start.strftime("%d-%m-%Y")
    df["WeekStart"] = week_start.strftime("%d-%m-%Y")
    df["LoadDate"] = datetime.now().strftime("%d-%m-%Y")
    df["SnapshotDateISO"] = week_start.strftime("%Y-%m-%d")
    df["WeekStartISO"] = week_start.strftime("%Y-%m-%d")
    iso = snapshot_dt.isocalendar()
    df["ISOYear"] = int(iso.year)
    df["ISOWeek"] = int(iso.week)
    return df



def ensure_unique_ref(df: pd.DataFrame) -> pd.DataFrame:
    """
    Garante que 'Unique Ref' exista e esteja preenchida.
    Quando estiver vazia, deriva de: Company Code + " " + Supplier
    (mesmo padrao observado nas semanas mais novas).
    """
    out = df.copy()

    # Se nao existir, cria
    if "Unique Ref" not in out.columns:
        out["Unique Ref"] = pd.NA

    # Se nao tiver inputs, nao da pra derivar
    if ("Company Code" not in out.columns) or ("Supplier" not in out.columns):
        return out

    # Constroi chave no formato "CC Supplier"
    cc = out["Company Code"].astype(str).str.strip()
    sup = pd.to_numeric(out["Supplier"], errors="coerce")

    derived = cc + " " + sup.fillna(0).astype("Int64").astype(str)
    derived = derived.where(cc.ne("") & sup.notna(), pd.NA)

    # Preenche so quando Unique Ref estiver vazia
    ur = out["Unique Ref"].astype(str).str.strip()
    mask_blank = out["Unique Ref"].isna() | ur.eq("") | ur.str.lower().isin({"nan", "none"})
    out.loc[mask_blank, "Unique Ref"] = derived.loc[mask_blank]

    return out
def should_load_sheet(df: pd.DataFrame, sheet_name: str) -> bool:
    if sheet_name.strip().lower() in SKIP_TABS:
        return False
    cols_lower = {c.lower() for c in df.columns}
    return REQUIRED_COLS_ANY.issubset(cols_lower)

def iter_excel_files(folder: Path, recursive: bool) -> Iterable[Path]:
    patterns = ["*.xlsx", "*.xlsm"]
    if recursive:
        for pat in patterns:
            yield from folder.rglob(pat)
    else:
        for pat in patterns:
            yield from folder.glob(pat)

def sanitize_for_sqlite(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out = out.dropna(axis=1, how="all")
    out = out.loc[:, [not str(c).startswith("Unnamed:") for c in out.columns]]
    out = out.loc[:, [str(c).strip() != "" for c in out.columns]]
    out = out.loc[:, ~out.columns.duplicated()]
    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = out[col].dt.strftime("%d-%m-%Y")
    def conv(v):
        if pd.isna(v):
            return None
        if isinstance(v, pd.Timestamp):
            return v.to_pydatetime().date().strftime("%d-%m-%Y")
        if isinstance(v, datetime):
            return v.date().strftime("%d-%m-%Y")
        if isinstance(v, date):
            return v.strftime("%d-%m-%Y")
        return v
    obj_cols = [c for c in out.columns if out[c].dtype == "object"]
    for col in obj_cols:
        sample = out[col].dropna().head(50).tolist()
        if any(isinstance(x, (pd.Timestamp, datetime, date)) for x in sample):
            out[col] = out[col].map(conv)
    return out

def load_one_file(path: Path) -> Tuple[pd.DataFrame, FileScanResult]:
    logger.info("Lendo arquivo: %s", path.name)
    snapshot = extract_snapshot_date_from_filename(path)
    xls = pd.ExcelFile(path)
    frames: list[pd.DataFrame] = []
    loaded_tabs = 0
    skipped_tabs = 0
    for tab in xls.sheet_names:
        tab_clean = tab.strip()
        if tab_clean.lower() in SKIP_TABS:
            skipped_tabs += 1
            continue
        # filtro de abas independente do nome do arquivo
        if (tab_clean not in KEY_TABS) and (tab_clean not in LEDGER_TABS):
            skipped_tabs += 1
            continue
        try:
            df = pd.read_excel(path, sheet_name=tab_clean, engine="openpyxl")
        except Exception as exc:
            skipped_tabs += 1
            logger.warning("  - Pulando aba '%s' (erro ao ler): %s", tab_clean, exc)
            continue
        if df.empty:
            skipped_tabs += 1
            continue
        df = normalize_cols(df)
        df = canonicalize_columns(df)
        df = ensure_unique_ref(df)
        df = strip_owner_columns(df)
        if not should_load_sheet(df, tab_clean):
            skipped_tabs += 1
            continue
        df["SourceFile"] = path.name
        df["SourcePath"] = str(path)
        df["SourceTab"] = tab_clean
        df = add_week_fields(df, snapshot)
        frames.append(df)
        loaded_tabs += 1
    if not frames:
        return pd.DataFrame(), FileScanResult(path, 0, 0, skipped_tabs)
    out = pd.concat(frames, ignore_index=True, sort=False)
    return out, FileScanResult(path, len(out), loaded_tabs, skipped_tabs)

def strip_owner_columns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    for col in out.columns:
        if "owner" not in str(col).lower():
            continue
        out[col] = out[col].map(lambda value: value.strip() if isinstance(value, str) else value)
    return out

def allowlist_columns(df: pd.DataFrame, allowed: Set[str]) -> pd.DataFrame:
    if df.empty:
        return df
    cols = [c for c in df.columns if c in allowed]
    return df[cols].copy()

def _apply_document_exclusions(df: pd.DataFrame) -> pd.DataFrame:
    """Remove documentos listados em EXCLUDED_DOCUMENTS."""
    if df.empty or not EXCLUDED_DOCUMENTS:
        return df
    ur = df.get("Unique Ref")
    dn = df.get("Document Number")
    if ur is None or dn is None:
        return df
    ur_s = ur.astype(str).str.strip()
    dn_s = dn.astype(str).str.strip()
    mask = pd.Series(False, index=df.index)
    for exc_ur, exc_dn in EXCLUDED_DOCUMENTS:
        mask |= (ur_s == exc_ur) & (dn_s == exc_dn)
    n_removed = mask.sum()
    if n_removed:
        logger.info("  Excluidos %d documentos (EXCLUDED_DOCUMENTS)", n_removed)
    return df.loc[~mask].copy()


def split_key_ledger(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if df.empty or "Sheet" not in df.columns:
        return pd.DataFrame(), pd.DataFrame()
    sheet_upper = df["Sheet"].astype(str).str.strip().str.upper()
    df_key_raw = df.loc[sheet_upper == "KEY"].copy()
    df_key_raw = _apply_document_exclusions(df_key_raw)
    df_ledger_raw = df.loc[sheet_upper.isin({"ROL", "QUERY"})].copy()
    # Normalize historical QUERY  ROL on ingest (migration: 99_migrate_query_to_rol.sql)
    mask = df_ledger_raw["Sheet"].str.upper() == "QUERY"
    if mask.any():
        df_ledger_raw.loc[mask, "Sheet"] = "ROL"
    # KEY: cria Unified
    s_new = df_key_raw.get("07-30 Days overdue")
    s_old = df_key_raw.get("0-30 Days overdue")
    if (s_new is not None) or (s_old is not None):
        if s_new is None:
            unified = s_old
        else:
            unified = s_new.copy()
            if s_old is not None:
                unified = unified.fillna(s_old)
        df_key_raw["07-30 Days overdue (Unified)"] = unified
    key_allowed = KEY_ALLOWED_BASE.union(META_COLUMNS)
    ledger_allowed = LEDGER_ALLOWED_BASE.union(META_COLUMNS)
    df_key = allowlist_columns(df_key_raw, key_allowed)
    df_ledger = allowlist_columns(df_ledger_raw, ledger_allowed)
    if not df_ledger.empty and df_ledger.shape[1] > MAX_LEDGER_COLS:
        raise RuntimeError(f"LEDGER com colunas demais: {df_ledger.shape[1]} > {MAX_LEDGER_COLS}")
    if not df_key.empty and df_key.shape[1] > MAX_KEY_COLS:
        raise RuntimeError(f"KEY com colunas demais: {df_key.shape[1]} > {MAX_KEY_COLS}")
    return df_key, df_ledger

# ---------- SQLite helpers ----------
def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None

def get_table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    cur = conn.execute(f'PRAGMA table_info("{table}")')
    return [row[1] for row in cur.fetchall()]

def pandas_dtype_to_sqlite(dtype: pd.api.extensions.ExtensionDtype) -> str:
    if pd.api.types.is_integer_dtype(dtype) or pd.api.types.is_bool_dtype(dtype):
        return "INTEGER"
    if pd.api.types.is_float_dtype(dtype):
        return "REAL"
    return "TEXT"

def ensure_table_schema(conn: sqlite3.Connection, df: pd.DataFrame, table: str, *, allow_new_cols: bool, allowed_new_cols: Set[str] | None = None) -> None:
    if df.empty:
        return
    if not table_exists(conn, table):
        df.head(0).to_sql(table, conn, if_exists="replace", index=False)
        return
    existing_cols = set(get_table_columns(conn, table))
    new_cols = [c for c in df.columns if c not in existing_cols]
    if not new_cols or not allow_new_cols:
        return
    if allowed_new_cols is not None:
        new_cols = [c for c in new_cols if c in allowed_new_cols]
    for col in new_cols:
        conn.execute(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {pandas_dtype_to_sqlite(df[col].dtype)}')
    if new_cols:
        conn.commit()

def align_df_to_table(conn: sqlite3.Connection, df: pd.DataFrame, table: str) -> pd.DataFrame:
    table_cols = get_table_columns(conn, table)
    out = df.copy()
    for c in table_cols:
        if c not in out.columns:
            out[c] = pd.NA
    extra = [c for c in out.columns if c not in table_cols]
    return out[table_cols + extra]

def delete_existing_for_snapshot(conn: sqlite3.Connection, table: str, snapshot_iso: str) -> None:
    """Delete existing rows for the same week (by WeekStartISO) to prevent duplicates.

    Uses WeekStartISO instead of SnapshotDateISO because files from different days
    of the same week (e.g. Ledger 16.03 and Ledger 17.03) should map to the same
    Monday and replace each other, not accumulate.
    """
    if not table_exists(conn, table):
        return
    # Derive Monday (WeekStartISO) from snapshot date
    snap_date = date.fromisoformat(snapshot_iso)
    monday = snap_date - timedelta(days=snap_date.weekday())
    week_iso = monday.strftime("%Y-%m-%d")
    existing = conn.execute(
        f'SELECT COUNT(*) FROM "{table}" WHERE "WeekStartISO" = ?', (week_iso,)
    ).fetchone()[0]
    if existing:
        conn.execute(f'DELETE FROM "{table}" WHERE "WeekStartISO" = ?', (week_iso,))
        conn.commit()
        logger.info("  Idempotent: deleted %d existing rows for week %s", existing, week_iso)

def create_indexes(conn: sqlite3.Connection, table: str) -> None:
    stmts = [
        f'CREATE INDEX IF NOT EXISTS idx_{table}_weekstartiso ON "{table}"("WeekStartISO")',
        f'CREATE INDEX IF NOT EXISTS idx_{table}_snapshotiso ON "{table}"("SnapshotDateISO")',
        f'CREATE INDEX IF NOT EXISTS idx_{table}_sheet ON "{table}"("Sheet")',
        f'CREATE INDEX IF NOT EXISTS idx_{table}_rowlevel ON "{table}"("RowLevel")',
        f'CREATE INDEX IF NOT EXISTS idx_{table}_docclass ON "{table}"("DocClass")',
    ]
    for s in stmts:
        try:
            conn.execute(s)
        except sqlite3.OperationalError:
            pass
    conn.commit()

def create_key_views(conn: sqlite3.Connection) -> None:
    # SELECT * in VIEWs intentional  views pass through all columns from base table
    conn.execute(f'DROP VIEW IF EXISTS "{KEY_VIEW_DETAIL}"')
    conn.execute(f'CREATE VIEW "{KEY_VIEW_DETAIL}" AS SELECT * FROM "{KEY_TABLE}" WHERE COALESCE("RowLevel","Detail") = "Detail";')
    conn.execute(f'DROP VIEW IF EXISTS "{KEY_VIEW_HEADERS}"')
    conn.execute(f'CREATE VIEW "{KEY_VIEW_HEADERS}" AS SELECT * FROM "{KEY_TABLE}" WHERE COALESCE("RowLevel","Detail") = "Header";')
    conn.execute(f'DROP VIEW IF EXISTS "{KEY_VIEW_LATEST_DETAIL}"')
    conn.execute(f'CREATE VIEW "{KEY_VIEW_LATEST_DETAIL}" AS SELECT * FROM "{KEY_VIEW_DETAIL}" WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "{KEY_VIEW_DETAIL}");')
    conn.execute(f'DROP VIEW IF EXISTS "{KEY_VIEW_LATEST_HEADERS}"')
    conn.execute(f'CREATE VIEW "{KEY_VIEW_LATEST_HEADERS}" AS SELECT * FROM "{KEY_VIEW_HEADERS}" WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "{KEY_VIEW_HEADERS}");')
    conn.commit()

def create_ledger_views(conn: sqlite3.Connection) -> None:
    # SELECT * in VIEWs intentional  views pass through all columns from base table
    conn.execute(f'DROP VIEW IF EXISTS "{LEDGER_LATEST_VIEW_ALL}"')
    conn.execute(f'CREATE VIEW "{LEDGER_LATEST_VIEW_ALL}" AS SELECT * FROM "{LEDGER_TABLE}" WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "{LEDGER_TABLE}");')
    conn.execute(f'DROP VIEW IF EXISTS "{LEDGER_LATEST_VIEW_ROL}"')
    conn.execute(f'CREATE VIEW "{LEDGER_LATEST_VIEW_ROL}" AS SELECT * FROM "{LEDGER_LATEST_VIEW_ALL}" WHERE UPPER(COALESCE("Sheet","")) = "ROL";')
    # latest_week_query view removed: QUERY merged into ROL (migration 99_migrate_query_to_rol.sql)
    conn.execute('DROP VIEW IF EXISTS "latest_week_query"')
    conn.execute(f'DROP VIEW IF EXISTS "{LEDGER_VIEW_DETAIL}"')
    conn.execute(f'CREATE VIEW "{LEDGER_VIEW_DETAIL}" AS SELECT * FROM "{LEDGER_TABLE}" WHERE COALESCE("RowLevel","Detail") = "Detail";')
    conn.execute(f'DROP VIEW IF EXISTS "{LEDGER_VIEW_HEADERS}"')
    conn.execute(f'CREATE VIEW "{LEDGER_VIEW_HEADERS}" AS SELECT * FROM "{LEDGER_TABLE}" WHERE COALESCE("RowLevel","Detail") = "Header";')
    conn.execute(f'DROP VIEW IF EXISTS "{LEDGER_VIEW_LATEST_DETAIL}"')
    conn.execute(f'CREATE VIEW "{LEDGER_VIEW_LATEST_DETAIL}" AS SELECT * FROM "{LEDGER_VIEW_DETAIL}" WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "{LEDGER_VIEW_DETAIL}");')
    conn.execute(f'DROP VIEW IF EXISTS "{LEDGER_VIEW_LATEST_HEADERS}"')
    conn.execute(f'CREATE VIEW "{LEDGER_VIEW_LATEST_HEADERS}" AS SELECT * FROM "{LEDGER_VIEW_HEADERS}" WHERE "WeekStartISO" = (SELECT MAX("WeekStartISO") FROM "{LEDGER_VIEW_HEADERS}");')
    conn.commit()

def _exec_named_section(conn: sqlite3.Connection, filename: str, section: str) -> bool:
    """Load a named section from a SQL file and execute all its statements."""
    queries = load_named_queries(filename)
    sql = queries.get(section, "")
    if not sql:
        return False
    for stmt in sql.split(";"):
        stmt = stmt.strip()
        if not stmt:
            continue
        if all(l.strip().startswith("--") or not l.strip() for l in stmt.splitlines()):
            continue
        conn.execute(stmt)
    conn.commit()
    return True


def _apply_indexes(conn: sqlite3.Connection, table: str, db_type: str) -> None:
    """Apply indexes from sql/02_indexes.sql [section], fallback to inline."""
    if _SQL_AVAILABLE:
        try:
            if _exec_named_section(conn, "02_indexes.sql", f"{db_type}_indexes"):
                logger.info("Indexes from sql/02_indexes.sql [%s_indexes] applied", db_type)
                return
        except FileNotFoundError:
            logger.warning("sql/02_indexes.sql not found  using inline indexes")
    create_indexes(conn, table)


def _apply_views(conn: sqlite3.Connection, db_type: str) -> None:
    """Apply views from sql/03_views.sql [section], fallback to inline."""
    if _SQL_AVAILABLE:
        try:
            if _exec_named_section(conn, "03_views.sql", f"{db_type}_views"):
                logger.info("Views from sql/03_views.sql [%s_views] applied", db_type)
                return
        except FileNotFoundError:
            logger.warning("sql/03_views.sql not found  using inline views")
    if db_type == "key":
        create_key_views(conn)
    else:
        create_ledger_views(conn)


def _refresh_weekly_summary(conn: sqlite3.Connection) -> None:
    """Create/refresh weekly_summary pre-aggregated table for trend charts."""
    if not _SQL_AVAILABLE:
        logger.info("weekly_summary skipped (sql_loader not available)")
        return
    try:
        if _exec_named_section(conn, "07_validation.sql", "weekly_summary_refresh"):
            cur = conn.execute("SELECT COUNT(*) FROM weekly_summary")
            count = cur.fetchone()[0]
            logger.info("weekly_summary refreshed: %d rows", count)
        else:
            logger.warning("weekly_summary_refresh section not found in 07_validation.sql")
    except FileNotFoundError:
        logger.warning("sql/07_validation.sql not found  weekly_summary skipped")
    except Exception as e:
        logger.warning("weekly_summary refresh failed: %s", e)


def _archive_previous_weeks(files_by_snapshot: dict, latest_snapshot: str) -> None:
    """Move xlsx files from previous snapshots to archive/ folders."""
    for snap_iso, files in files_by_snapshot.items():
        if snap_iso >= latest_snapshot:
            continue
        for f in files:
            parent = f.parent
            if parent == KEY_DATA:
                archive_dir = KEY_ARCHIVE
            elif parent == LEDGER_DATA:
                archive_dir = LEDGER_ARCHIVE
            else:
                continue
            archive_dir.mkdir(parents=True, exist_ok=True)
            dest = archive_dir / f.name
            if not dest.exists():
                import shutil
                shutil.move(str(f), str(dest))
                logger.info("  Archived: %s  %s", f.name, archive_dir.name)


def _load(args: argparse.Namespace) -> int:
    global REBUILD_KEY_TABLE, REBUILD_LEDGER_TABLE, ONLY_LATEST_SNAPSHOT
    REBUILD_KEY_TABLE = bool(args.rebuild)
    REBUILD_LEDGER_TABLE = bool(args.rebuild)
    ONLY_LATEST_SNAPSHOT = bool(args.latest)
    do_archive = not args.no_archive  # default: archive on --latest
    # --weeks N: partial rebuild (only last N snapshots, no DROP TABLE)
    rebuild_weeks = args.weeks
    if rebuild_weeks > 0:
        mode = f"REBUILD (last {rebuild_weeks} weeks)"
    elif REBUILD_KEY_TABLE:
        mode = "REBUILD (full)"
    elif ONLY_LATEST_SNAPSHOT:
        mode = "LATEST"
    else:
        mode = "ALL"
    logger.info("Mode: %s", mode)

    for ip in INPUT_PATHS:
        if not ip.exists():
            logger.error("INPUT_PATH nao existe: %s", ip)
            return 1
    # In rebuild mode, also scan archive/ directories
    if REBUILD_KEY_TABLE or REBUILD_LEDGER_TABLE:
        excel_files = sorted(
            set(
                list(iter_excel_files(KEY_DATA, RECURSIVE))
                + list(iter_excel_files(LEDGER_DATA, RECURSIVE))
                + (list(iter_excel_files(KEY_ARCHIVE, RECURSIVE)) if KEY_ARCHIVE.exists() else [])
                + (list(iter_excel_files(LEDGER_ARCHIVE, RECURSIVE)) if LEDGER_ARCHIVE.exists() else [])
            )
        )
    else:
        excel_files = sorted(f for ip in INPUT_PATHS for f in iter_excel_files(ip, RECURSIVE))
    if not excel_files:
        logger.warning("Nenhum Excel encontrado em: %s", INPUT_PATHS)
        return 0
    files_by_snapshot: dict[str, list[Path]] = {}
    for f in excel_files:
        snap = extract_snapshot_date_from_filename(f)
        # Normalize to Monday of that week (prevents duplicates from different days)
        monday = snap - timedelta(days=snap.weekday())
        snap_iso = monday.strftime("%Y-%m-%d")
        files_by_snapshot.setdefault(snap_iso, []).append(f)
    if rebuild_weeks > 0 and files_by_snapshot:
        # Partial rebuild: only last N snapshots, DON'T drop tables
        all_snaps = sorted(files_by_snapshot.keys())
        recent = all_snaps[-rebuild_weeks:]
        files_by_snapshot = {k: v for k, v in files_by_snapshot.items() if k in recent}
        REBUILD_KEY_TABLE = False
        REBUILD_LEDGER_TABLE = False
        logger.info("[PARTIAL REBUILD] Processing only %d most recent snapshots: %s", rebuild_weeks, ", ".join(recent))
    elif ONLY_LATEST_SNAPSHOT and files_by_snapshot:
        latest = max(files_by_snapshot.keys())
        files_by_snapshot = {latest: files_by_snapshot[latest]}
    total_key_rows = 0
    total_ledger_rows = 0
    total_snapshots = 0
    t_start_all = time.perf_counter()
    if REBUILD_KEY_TABLE or REBUILD_LEDGER_TABLE:
        targets = []
        if REBUILD_KEY_TABLE:
            targets.append("KEY")
        if REBUILD_LEDGER_TABLE:
            targets.append("LEDGER")
        logger.warning("[!] REBUILD mode ON for: %s  tables will be DROPPED and recreated from scratch", ", ".join(targets))
    with closing(sqlite3.connect(OUTPUT_KEY_SQLITE)) as conn_key, closing(sqlite3.connect(OUTPUT_LEDGER_SQLITE)) as conn_ledger:
        if REBUILD_KEY_TABLE:
            conn_key.execute(f'DROP TABLE IF EXISTS "{KEY_TABLE}"')
            conn_key.commit()
        if REBUILD_LEDGER_TABLE:
            conn_ledger.execute(f'DROP TABLE IF EXISTS "{LEDGER_TABLE}"')
            conn_ledger.commit()
        for snap_idx, snapshot_iso in enumerate(sorted(files_by_snapshot.keys()), 1):
            files = files_by_snapshot[snapshot_iso]
            logger.info("== Snapshot %s (%d/%d) | arquivos: %s",
                        snapshot_iso, snap_idx, len(files_by_snapshot),
                        ", ".join(p.name for p in files))
            t_snap = time.perf_counter()
            key_frames: list[pd.DataFrame] = []
            ledger_frames: list[pd.DataFrame] = []
            for f in files:
                df, result = load_one_file(f)
                logger.info("  -> %s | abas carregadas=%d | abas puladas=%d | linhas=%d", f.name, result.loaded_tabs, result.skipped_tabs, result.loaded_rows)
                if df.empty:
                    continue
                df = sanitize_for_sqlite(df)
                df = add_rowlevel_and_docclass(df)
                df_key_part, df_ledger_part = split_key_ledger(df)
                if not df_key_part.empty:
                    key_frames.append(df_key_part)
                if not df_ledger_part.empty:
                    ledger_frames.append(df_ledger_part)
            if not key_frames and not ledger_frames:
                continue
            df_key = pd.concat(key_frames, ignore_index=True, sort=False) if key_frames else pd.DataFrame()
            df_ledger = pd.concat(ledger_frames, ignore_index=True, sort=False) if ledger_frames else pd.DataFrame()
            if not df_key.empty:
                key_allowed = KEY_ALLOWED_BASE.union(META_COLUMNS)
                ensure_table_schema(conn_key, df_key, KEY_TABLE, allow_new_cols=True, allowed_new_cols=key_allowed)
                delete_existing_for_snapshot(conn_key, KEY_TABLE, snapshot_iso)
                df_key = align_df_to_table(conn_key, df_key, KEY_TABLE)
                df_key.to_sql(KEY_TABLE, conn_key, if_exists="append", index=False, chunksize=5000)
                total_key_rows += len(df_key)
            if not df_ledger.empty:
                ledger_allowed = LEDGER_ALLOWED_BASE.union(META_COLUMNS)
                ensure_table_schema(conn_ledger, df_ledger, LEDGER_TABLE, allow_new_cols=True, allowed_new_cols=ledger_allowed)
                delete_existing_for_snapshot(conn_ledger, LEDGER_TABLE, snapshot_iso)
                df_ledger = align_df_to_table(conn_ledger, df_ledger, LEDGER_TABLE)
                df_ledger.to_sql(LEDGER_TABLE, conn_ledger, if_exists="append", index=False, chunksize=5000)
                total_ledger_rows += len(df_ledger)
            total_snapshots += 1
            logger.info("   Snapshot %s done in %.1fs", snapshot_iso, time.perf_counter() - t_snap)
        if table_exists(conn_key, KEY_TABLE):
            _apply_indexes(conn_key, KEY_TABLE, "key")
            _apply_views(conn_key, "key")
        if table_exists(conn_ledger, LEDGER_TABLE):
            _apply_indexes(conn_ledger, LEDGER_TABLE, "ledger")
            _apply_views(conn_ledger, "ledger")
            _refresh_weekly_summary(conn_ledger)
    if total_snapshots <= 0 or (total_key_rows + total_ledger_rows) <= 0:
        logger.error(
            "No non-empty snapshot was staged (snapshots=%d, key_rows=%d, ledger_rows=%d)",
            total_snapshots,
            total_key_rows,
            total_ledger_rows,
        )
        return 1
    # Compact DB and update query planner stats after bulk inserts
    for label, path in [("KEY", OUTPUT_KEY_SQLITE), ("LEDGER", OUTPUT_LEDGER_SQLITE)]:
        if path.exists():
            with closing(sqlite3.connect(path)) as c:
                c.execute("ANALYZE")
                c.execute("VACUUM")
            size_mb = path.stat().st_size / (1024 * 1024)
            logger.info("%s SQLite optimized (ANALYZE+VACUUM): %.1f MB", label, size_mb)
    logger.info("OK.")
    logger.info("KEY SQLite: %s", OUTPUT_KEY_SQLITE)
    logger.info("LEDGER SQLite: %s", OUTPUT_LEDGER_SQLITE)
    logger.info("Snapshots processados: %d", total_snapshots)
    logger.info("Linhas KEY inseridas: %d", total_key_rows)
    logger.info("Linhas LEDGER inseridas (ROL): %d", total_ledger_rows)
    logger.info("Tempo total: %.1fs", time.perf_counter() - t_start_all)
    # Archive previous weeks' xlsx files (only on --latest, unless --no-archive)
    if ONLY_LATEST_SNAPSHOT and do_archive and files_by_snapshot:
        latest = max(files_by_snapshot.keys())
        _archive_previous_weeks(files_by_snapshot, latest)
    return 0


def _require_sql_contract() -> None:
    required = {
        "01_schema.sql": (),
        "02_indexes.sql": ("key_indexes", "ledger_indexes"),
        "03_views.sql": ("key_views", "ledger_views"),
        "07_validation.sql": ("weekly_summary_refresh",),
    }
    for filename, sections in required.items():
        path = SQL_DIR / filename
        if not path.is_file() or not path.read_text(encoding="utf-8").strip():
            raise RuntimeError(f"Required SQL file is missing or empty: {filename}")
        if sections:
            named = load_named_queries(filename)
            missing = [section for section in sections if not named.get(section, "").strip()]
            if missing:
                raise RuntimeError(f"Required SQL section missing or empty in {filename}: {', '.join(missing)}")


def main(argv: list[str] | None = None) -> int:
    global INPUT_PATHS, OUTPUT_KEY_SQLITE, OUTPUT_LEDGER_SQLITE
    global KEY_DATA, LEDGER_DATA, KEY_ARCHIVE, LEDGER_ARCHIVE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("--latest", action="store_true")
    parser.add_argument("--no-archive", action="store_true")
    parser.add_argument("--weeks", type=int, default=0, metavar="N")
    parser.add_argument("--key-dir", type=Path, default=KEY_DATA)
    parser.add_argument("--ledger-dir", type=Path, default=LEDGER_DATA)
    parser.add_argument("--key-db", type=Path, default=KEY_DB)
    parser.add_argument("--ledger-db", type=Path, default=LEDGER_DB)
    args = parser.parse_args(argv)
    if args.weeks < 0:
        parser.error("--weeks must be zero or greater")

    original = (
        INPUT_PATHS,
        OUTPUT_KEY_SQLITE,
        OUTPUT_LEDGER_SQLITE,
        KEY_DATA,
        LEDGER_DATA,
        KEY_ARCHIVE,
        LEDGER_ARCHIVE,
    )
    target_key = args.key_db.resolve()
    target_ledger = args.ledger_db.resolve()
    try:
        _require_sql_contract()
        KEY_DATA = args.key_dir.resolve()
        LEDGER_DATA = args.ledger_dir.resolve()
        KEY_ARCHIVE = KEY_DATA / "archive"
        LEDGER_ARCHIVE = LEDGER_DATA / "archive"
        INPUT_PATHS = [KEY_DATA, LEDGER_DATA]
        for input_path in INPUT_PATHS:
            if not input_path.is_dir():
                raise RuntimeError(f"Input directory does not exist: {input_path}")
        if not any(
            any(True for _ in iter_excel_files(input_path, RECURSIVE))
            for input_path in INPUT_PATHS
        ):
            raise RuntimeError("No Excel input files found; published databases were preserved")
        with staged_databases((target_key, target_ledger)) as stages:
            OUTPUT_KEY_SQLITE = stages[target_key]
            OUTPUT_LEDGER_SQLITE = stages[target_ledger]
            result = _load(args)
            if result:
                raise RuntimeError("Ledger/Key staging failed; published databases were preserved")
        OUTPUT_KEY_SQLITE = target_key
        OUTPUT_LEDGER_SQLITE = target_ledger
        return 0
    except Exception as exc:
        logger.error("Ledger/Key load failed: %s", exc)
        return 1
    finally:
        (
            INPUT_PATHS,
            OUTPUT_KEY_SQLITE,
            OUTPUT_LEDGER_SQLITE,
            KEY_DATA,
            LEDGER_DATA,
            KEY_ARCHIVE,
            LEDGER_ARCHIVE,
        ) = original


if __name__ == "__main__":
    raise SystemExit(main())
