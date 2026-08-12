"""Create the pack-local SQLite fixtures from checked-in SQL and JSON data."""
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "runtime" / "db"
SQL_DIR = ROOT / "sql"


def _reset(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    return sqlite3.connect(path)


def _ledger_values(row: dict[str, object], source: str, row_level: str) -> dict[str, object]:
    is_header = row_level == "Header"
    return {
        "Country": row["co"], "Vendor category": row["vc"], "Company Code": row["cc"],
        "Supplier": row["s"], "Name 1": row["sn"], "Document Date": "10-08-2026",
        "Document Number": row["dn"], "Reference": row["rn"], "Amount in doc. curr.": row["a"],
        "Document Type": row["dt"], "Net due date": "10-08-2026", "Document currency": row["cur"],
        "Posting Date": "10-08-2026", "Payment Block": row["pb"],
        "0-30 Days overdue": row["tv"] if is_header else 0,
        "TOTAL VALUE": row["tv"],
        "TOTAL VOL": 1, "Query type": row["qt"], "Status": row["st"], "AP Specialist comment": row["cm"],
        "Next Step": row["ns"], "Action Date": "10-08-2026", "Sheet": source, "Owner": row["o"],
        "Unique Ref": f"{row['cc']} {row['s']}", "System": row["sys"], "SourceFile": f"Synthetic_{source}.xlsx",
        "SourcePath": f"data/{source.casefold()}/Synthetic_{source}.xlsx", "SourceTab": source,
        "SnapshotDate": "10-08-2026", "WeekStart": "10-08-2026", "LoadDate": "2026-08-10T12:00:00",
        "SnapshotDateISO": "2026-08-10", "WeekStartISO": "2026-08-10", "ISOYear": 2026,
        "ISOWeek": 33, "RowLevel": row_level, "DocClass": "Header" if is_header else "Invoice",
    }


def _insert_row(conn: sqlite3.Connection, table: str, values: dict[str, object]) -> None:
    available = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
    selected = {key: value for key, value in values.items() if key in available}
    columns = ", ".join(f'"{key}"' for key in selected)
    placeholders = ", ".join("?" for _ in selected)
    conn.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})', tuple(selected.values()))


def bootstrap() -> dict[str, int]:
    fixture = json.loads((ROOT / "data/ledger/fixture.json").read_text(encoding="utf-8"))["rows"]
    review_fixture = json.loads((ROOT / "data/SyntheticReview/fixture.json").read_text(encoding="utf-8"))
    schema = (SQL_DIR / "01_schema.sql").read_text(encoding="utf-8")
    indexes = (SQL_DIR / "02_indexes.sql").read_text(encoding="utf-8")
    views = (SQL_DIR / "03_views.sql").read_text(encoding="utf-8")
    counts: dict[str, int] = {}
    for filename, table, source in (
        ("ledger_weekly.sqlite", "ledger_lines", "ROL"),
        ("key_weekly.sqlite", "key_lines", "KEY"),
    ):
        with _reset(DB_DIR / filename) as conn:
            conn.executescript(schema + indexes + views)
            for row in fixture:
                _insert_row(conn, table, _ledger_values(row, source, "Header"))
                _insert_row(conn, table, _ledger_values(row, source, "Detail"))
            conn.commit()
            counts[filename] = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])

    with _reset(DB_DIR / "synthetic_review_daily.sqlite") as conn:
        for name in ("10_synthetic_review_schema.sql", "11_synthetic_review_indexes.sql", "12_synthetic_review_views.sql"):
            conn.executescript((SQL_DIR / name).read_text(encoding="utf-8"))
        for name in ("20_statement_schema.sql", "21_statement_indexes.sql"):
            conn.executescript((SQL_DIR / name).read_text(encoding="utf-8"))
        for row in review_fixture["rows"]:
            _insert_row(conn, "synthetic_review_lines", row)
        for row in review_fixture["statement_rows"]:
            _insert_row(conn, "statement_lines", row)
        conn.commit()
        counts["synthetic_review_daily.sqlite"] = int(
            conn.execute("SELECT COUNT(*) FROM synthetic_review_lines").fetchone()[0]
        )
        counts["statement_rows"] = int(
            conn.execute("SELECT COUNT(*) FROM statement_lines").fetchone()[0]
        )

    escalation_sql = """
    CREATE TABLE escalation_lines (
      UniqueKey TEXT PRIMARY KEY, LoadedAt TEXT NOT NULL, Category TEXT, Mailbox TEXT,
      FromEmail TEXT, VendorNo TEXT, VendorName TEXT, Entity TEXT, EntityCode TEXT,
      Reference TEXT, DocDate TEXT, InvRef TEXT, Value REAL, ValueRaw TEXT, ActionType TEXT,
      Status TEXT, StatusRaw TEXT, IsOpen INTEGER, Priority TEXT, APOwner TEXT,
      ReceivedDate TEXT, EscalationDate TEXT, WorkingNotes TEXT, DateResolved TEXT,
      DaysToResolveSource INTEGER, DaysToResolveCalc INTEGER, DaysOpen INTEGER,
      InternetMsgId TEXT, MasterCategory TEXT, MasterPriority TEXT, MasterAPOwner TEXT, Flags TEXT
    );
    """
    with _reset(DB_DIR / "escalation_daily.sqlite") as conn:
        conn.executescript(escalation_sql)
        conn.execute(
            "INSERT INTO escalation_lines (UniqueKey,LoadedAt,Category,VendorNo,VendorName,EntityCode,Status,IsOpen,APOwner,EscalationDate) VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("SYN-ESC-001", "2026-08-10T12:00:00", "Synthetic", "SYN-SUP-001", "Synthetic Supplier Alpha", "SYN-ENT-001", "Open", 1, "Synthetic Owner 001", "2026-08-10"),
        )
        conn.commit()
        counts["escalation_daily.sqlite"] = 1
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate existing fixtures without rebuilding")
    args = parser.parse_args(argv)
    if args.check:
        expected = {
            "ledger_weekly.sqlite": ("ledger_lines", 4),
            "key_weekly.sqlite": ("key_lines", 4),
            "synthetic_review_daily.sqlite": ("synthetic_review_lines", 1),
            "escalation_daily.sqlite": ("escalation_lines", 1),
        }
        failures: list[str] = []
        checks_run = 0
        for filename, (table, minimum) in expected.items():
            path = DB_DIR / filename
            try:
                with sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True) as conn:
                    checks_run += 1
                    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        failures.append(filename)
                    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                        failures.append(f"{filename}:{table}")
                        continue
                    count = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
                    if count < minimum:
                        failures.append(f"{filename}:{table}:rows={count},minimum={minimum}")
                    if filename == "synthetic_review_daily.sqlite" and count >= minimum:
                        rows = conn.execute(
                            "SELECT SnapshotDate, Owner, Category FROM synthetic_review_lines"
                        ).fetchall()
                        if not all(
                            snapshot and owner and category and date.fromisoformat(snapshot)
                            for snapshot, owner, category in rows
                        ):
                            failures.append("synthetic_review_daily.sqlite:date-owner-category")
                        statement_count = int(conn.execute("SELECT COUNT(*) FROM statement_lines").fetchone()[0])
                        if statement_count < 1:
                            failures.append("synthetic_review_daily.sqlite:statement_lines:rows=0")
            except (sqlite3.Error, OSError, ValueError) as exc:
                failures.append(f"{filename}:{exc}")
        if checks_run == 0:
            failures.append("no checks executed")
        print(json.dumps({"status": "GREEN" if not failures else "RED", "checks_run": checks_run, "failures": failures}))
        return 1 if failures else 0
    print(json.dumps({"status": "GREEN", "rows": bootstrap()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
