# -*- coding: utf-8 -*-
"""Build MasterData Weekly  extract and refresh weekly ERP vendor master data."""
from __future__ import annotations

import os
import sys
import pandas as pd
from datetime import date, datetime

from ..utils import masterdata_core as core
from ..utils.paths import MASTER_DATA, MASTER_ARCHIVE, archive_old_files
from ..utils.report_utils import validate_masterdata_csv
BASE_DIR = str(MASTER_DATA)

# Concurrency lock  prevent two builds from running simultaneously
LOCK_FILE = os.path.join(BASE_DIR, ".masterdata_build.lock")


def _acquire_lock() -> bool:
    """Acquire an exclusive file lock. Returns True on success."""
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                pid = int(f.read().strip())
            # Check if the process is still alive (Windows-compatible)
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if handle:
                kernel32.CloseHandle(handle)
                print(f"[BLOCK] Another build_masterdata_weekly is running (PID {pid}). Aborting.")
                return False
            # Stale lock  process is dead, safe to overwrite
            print(f"[WARN] Stale lock from PID {pid} removed.")
        except (ValueError, OSError):
            print("[WARN] Invalid lock file removed.")
    with open(LOCK_FILE, "w") as f:
        f.write(str(os.getpid()))
    return True


def _release_lock() -> None:
    """Release the file lock."""
    try:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
    except OSError:
        pass


def save_previous_assignments(out_csv: str, base_dir: str) -> None:
    """
    Salva o snapshot de historico para o proximo WEEKLY.
    Gera dois arquivos:
      - previous_assignments_WWYY.csv  (backup datado  nunca sobrescrito)
      - previous_assignments.csv       (ponteiro atual para leitura)
    Mantem: Unique Ref, Sheet, Owner
    """
    usecols = ["Unique Ref", "Sheet", "Owner"]
    try:
        df_prev = pd.read_csv(out_csv, usecols=usecols, dtype=str, encoding="utf-8-sig", on_bad_lines="skip")
    except ValueError:
        df_prev = pd.read_csv(out_csv, usecols=["Unique Ref", "Sheet"], dtype=str, encoding="utf-8-sig", on_bad_lines="skip")
        df_prev["Owner"] = ""

    df_prev["Unique Ref"] = df_prev["Unique Ref"].fillna("").astype(str).str.strip()
    df_prev["Sheet"] = df_prev["Sheet"].fillna("").astype(str).str.strip()
    df_prev["Owner"] = df_prev.get("Owner", "").fillna("").astype(str).str.strip()
    df_prev = df_prev[df_prev["Unique Ref"] != ""]
    df_prev = df_prev.drop_duplicates(subset=["Unique Ref"], keep="last")

    # 1. Backup datado (WWYY)  preserva versao anterior
    iso_year, iso_week, _ = date.today().isocalendar()
    dated_name = f"previous_assignments_{iso_week:02d}{str(iso_year)[-2:]}.csv"
    dated_path = os.path.join(base_dir, dated_name)
    df_prev.to_csv(dated_path, index=False, encoding="utf-8-sig")
    print(f"[OK] Previous assignments backup: {dated_name} ({len(df_prev)} URs)")

    # 2. Ponteiro atual (para leitura pelo proximo run)
    prev_path = os.path.join(base_dir, "previous_assignments.csv")
    df_prev.to_csv(prev_path, index=False, encoding="utf-8-sig")
    print(f"[OK] Previous assignments current: {prev_path}")


def main() -> None:
    if not _acquire_lock():
        raise SystemExit(1)
    try:
        _main_impl()
    finally:
        _release_lock()


def _main_impl() -> None:
    base_dir = BASE_DIR
    vendor_matrix = os.path.join(base_dir, "Synthetic_Vendor_Master_Matrix.csv")
    key_owner_map_path = os.path.join(base_dir, "Owner_map.csv")
    prev_assignments = os.path.join(base_dir, "previous_assignments.csv")
    vendor_pm_map_path = os.path.join(base_dir, "Vendor_PM_Mapping.csv")

    as_of: date = date.today()

    # 1. Carregar Maps e Historico
    print(">>> Carregando mapas...")
    vendor_cat_map = core.load_vendor_category_map(vendor_matrix)
    vendor_name_map = core.load_vendor_name1_map(vendor_matrix)
    key_owner_map = core.load_key_owner_map_from_vba_txt(key_owner_map_path)
    vendor_pm_map = {}
    if os.path.exists(vendor_pm_map_path):
        vendor_pm_map = core.load_vendor_pm_name_map(vendor_pm_map_path)
    else:
        print(f"[WARN] Vendor_PM_Mapping.csv nao encontrado em: {vendor_pm_map_path}. PM Name ficara em branco.")

    prev_map = core.load_prev_assignments(prev_assignments)
    prev_owner_map = core.load_prev_owners(prev_assignments)
    # 2. CARREGAR PAYMENT ISSUES DOS LOGS (RESILIENTE)
    # Se nao houver logs, retorna dicts vazios e segue o jogo
    v_issues, d_issues = core.load_payment_issues(base_dir)

    # 3. Descobrir os CSVs de entrada
    paths: list[str] = []
    token_to_path: dict[str, str] = {}
    for t in core.TOKENS_DEFAULT:
        p = core.find_latest_csv_for_token(base_dir, t)
        if p:
            paths.append(p)
            token_to_path[t] = p

    print(f"[OK] Vendor category map: {len(vendor_cat_map)} URs")
    print(f"[OK] Key owner map: {len(key_owner_map)} URs")
    print(f"[OK] Payment Issues: {len(v_issues)} vendors, {len(d_issues)} docs")

    # --- NOME PADRONIZADO (WWYY) ---
    iso_year, iso_week, _ = as_of.isocalendar()
    fname = f"MasterData_{iso_week:02d}{str(iso_year)[-2:]}.csv"
    out_csv = os.path.join(BASE_DIR, fname)
    tmp_csv = out_csv + ".tmp"

    # Write to .tmp so a crash/interrupt never leaves a corrupted CSV in place.
    # The previous MasterData_WWYY.csv stays intact until validation passes.
    if os.path.exists(tmp_csv):
        try:
            os.remove(tmp_csv)
        except PermissionError:
            print(f"[ERRO] O arquivo {fname}.tmp esta aberto. Feche e tente novamente.")
            return

    # 4. Processamento com a nova coluna
    print(f"-> Gerando {fname} (Weekly)...")
    write_header = True
    for t in core.TOKENS_DEFAULT:
        p = token_to_path.get(t)
        if not p: continue

        print(f"   Processando: {os.path.basename(p)}")
        write_header = core.process_file_grouped(
            path=p,
            out_csv=tmp_csv,
            vendor_cat_map=vendor_cat_map,
            key_owner_map=key_owner_map,
            prev_map=prev_map,
            prev_owner_map=prev_owner_map,
            vendor_pm_map=vendor_pm_map,
            vendor_name_map=vendor_name_map,
            vendor_issues=v_issues,  # <--- Passando os logs
            doc_issues=d_issues,     # <--- Passando os logs
            mode="weekly",
            as_of=as_of,
            write_header=write_header,
        )

    # Validate before promoting .tmp to the real file. If this raises, the
    # previous MasterData_WWYY.csv stays intact and .tmp is preserved for
    # inspection. Nothing downstream sees a corrupt CSV.
    name_info = core.canonicalize_masterdata_name1_by_unique_ref(
        tmp_csv,
        vendor_name_map=vendor_name_map,
    )
    if name_info["rows_changed"]:
        print(
            "[WARN] Name 1 canonicalizado por Unique Ref: "
            f"{name_info['rows_changed']} rows, {name_info['groups_changed']} suppliers"
        )

    try:
        info = validate_masterdata_csv(tmp_csv)
        print(f"[VALIDATE] {fname}.tmp OK ({info['rows']} rows)")
    except Exception as e:
        print(f"[ERRO] MasterData invalido, mantendo CSV anterior intacto: {e}")
        print(f"[ERRO] Arquivo invalido preservado em: {tmp_csv} (apague depois de investigar)")
        raise

    # Atomic rename on the same filesystem  Local Fixture Store treats it as a rename,
    # NOT a copy+delete, so the shared drive stays consistent.
    os.replace(tmp_csv, out_csv)
    print(f"[OK] {fname} promovido (atomic rename)")

    save_previous_assignments(out_csv, base_dir)

    # Archive old MasterData CSVs (keep only current week's file)
    archived = archive_old_files(MASTER_DATA, MASTER_ARCHIVE, keep_pattern=fname, glob_pattern='MasterData_*.csv')
    if archived:
        print(f"[ARCHIVE] Moved {len(archived)} old MasterData CSV(s) to archive/")

    print(f"[DONE] Weekly gerado com sucesso.")

if __name__ == "__main__":
    main()
