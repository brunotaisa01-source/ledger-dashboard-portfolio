"""
SQL Loader - reads .sql files from the sql/ directory.
Supports named queries within a file using -- @query_name markers.
"""
from pathlib import Path
from typing import Dict, List

_SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def load_sql_file(filename: str) -> str:
    """Read entire SQL file as string."""
    path = _SQL_DIR / filename
    return path.read_text(encoding="utf-8")


def load_named_queries(filename: str) -> Dict[str, str]:
    """Parse a SQL file into named queries separated by '-- @name' markers."""
    text = load_sql_file(filename)
    queries: Dict[str, str] = {}
    current_name = None
    current_lines: List[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("-- @"):
            if current_name:
                queries[current_name] = "\n".join(current_lines).strip()
            current_name = stripped[4:].strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_name:
        queries[current_name] = "\n".join(current_lines).strip()
    return queries


def execute_sql_file(conn, filename: str, ignore_errors: bool = True):
    """Execute all statements in a SQL file against a connection.

    Handles comment blocks correctly: a statement preceded by -- comments
    is still executed (SQLite supports -- comments natively).
    """
    text = load_sql_file(filename)
    for stmt in text.split(";"):
        stmt = stmt.strip()
        if not stmt:
            continue
        # Skip blocks that are ONLY comments (no real SQL)
        has_sql = any(
            l.strip() and not l.strip().startswith("--")
            for l in stmt.splitlines()
        )
        if not has_sql:
            continue
        try:
            conn.execute(stmt)
        except Exception as e:
            if not ignore_errors:
                raise
    conn.commit()
