"""Dependency analysis tool - identifies orphaned files and import relationships.

Scans Python files for imports, batch files for script calls, builds dependency
graph, and generates report of potentially orphaned files.
"""
from __future__ import annotations

import ast
import re
from datetime import datetime
from pathlib import Path
from typing import Set, Dict, List

# Project root
ROOT = Path(__file__).resolve().parent.parent.parent

# Known entry points (not orphans even if not imported)
ENTRY_POINTS = {
    'Rol_Query.py',
    'run_weekly.py',
    'deploy.py',
    'load_ledger_weekly_to_sqlite_clean_split.py',
    'synthetic_review_loader.py',
    'synthetic_review_downloader.py',
    'statement_loader.py',
    'statement_downloader.py',
    'validate_data.py',
    'health_check.py',
    'build_key_report.py',
    'build_ledger_report.py',
    'build_masterdata_weekly.py',
    'build_masterdata_monthly.py',
    'analyze_dependencies.py',
    'check_imports.py',
}


def extract_python_imports(file_path: Path) -> Set[str]:
    """Extract imported modules from Python file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read(), filename=str(file_path))
    except Exception:
        return set()

    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.add(node.module.split('.')[0])

    return imports


def extract_bat_calls(file_path: Path) -> Set[str]:
    """Extract Python script calls from batch file."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except Exception:
        return set()

    # Match: py "%SCRIPTS%\foo.py", %PY% "%SCRIPTS%\foo.py", python scripts/foo.py
    pattern = r'(?:py|python|%PY%)\s+["\']?(?:%SCRIPTS%[\\/]|scripts[\\/])?(\w+\.py)'
    matches = re.findall(pattern, content, re.IGNORECASE)
    return set(matches)


def build_dependency_graph() -> Dict[str, Set[str]]:
    """Build dependency graph: file -> set of files it imports."""
    graph: Dict[str, Set[str]] = {}

    scripts_dir = ROOT / 'scripts'
    for py_file in scripts_dir.glob('*.py'):
        if py_file.name.startswith('__'):
            continue

        imported_modules = extract_python_imports(py_file)
        # Filter to local scripts only
        local_imports = {
            f"{mod}.py" for mod in imported_modules
            if (scripts_dir / f"{mod}.py").exists()
        }
        graph[py_file.name] = local_imports

    return graph


def find_bat_references() -> Set[str]:
    """Find all Python scripts referenced in batch files."""
    referenced = set()

    automation_dir = ROOT / 'automation'
    if automation_dir.exists():
        for bat_file in automation_dir.glob('*.bat'):
            referenced.update(extract_bat_calls(bat_file))
    else:
        print(f"Warning: automation directory not found: {automation_dir}")

    return referenced


def find_orphans(graph: Dict[str, Set[str]], bat_refs: Set[str]) -> List[str]:
    """Identify orphaned files (not imported, not in batch, not entry point)."""
    all_files = set(graph.keys())
    imported_files = set()

    # Collect all imported files
    for imports in graph.values():
        imported_files.update(imports)

    # Orphans = not imported AND not in batch AND not entry point
    orphans = []
    for file in all_files:
        if (file not in imported_files and
            file not in bat_refs and
            file not in ENTRY_POINTS):
            orphans.append(file)

    return sorted(orphans)


def generate_report():
    """Generate dependency analysis report."""
    print("Analyzing dependencies...")

    graph = build_dependency_graph()
    bat_refs = find_bat_references()
    orphans = find_orphans(graph, bat_refs)

    report_path = ROOT / 'docs' / 'dependency_analysis.md'

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("# Dependency Analysis Report\n\n")
        timestamp = datetime.fromtimestamp(Path(__file__).stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S')
        f.write(f"**Generated:** {timestamp}\n\n")

        f.write("## Summary\n\n")
        f.write(f"- Total Python files: {len(graph)}\n")
        f.write(f"- Batch file references: {len(bat_refs)}\n")
        f.write(f"- Entry points: {len(ENTRY_POINTS)}\n")
        f.write(f"- **Potential orphans: {len(orphans)}**\n\n")

        f.write("## Potential Orphaned Files\n\n")
        if orphans:
            f.write("These files are not imported by any Python script, ")
            f.write("not called in batch files, and not known entry points:\n\n")
            for orphan in orphans:
                f.write(f"- `scripts/{orphan}`\n")
        else:
            f.write("No orphaned files detected.\n")

        f.write("\n## Recommendations\n\n")
        f.write("- Review each orphaned file to determine if it's truly unused\n")
        f.write("- If unused, move to archive or delete\n")
        f.write("- If used but not detected, update ENTRY_POINTS list or ensure it's called in batch files\n")

        f.write("\n## Batch File References\n\n")
        if bat_refs:
            for ref in sorted(bat_refs):
                f.write(f"- `{ref}`\n")
        else:
            f.write("No Python scripts referenced in batch files.\n")

        f.write("\n## Import Graph\n\n")
        for file in sorted(graph.keys()):
            imports = graph[file]
            if imports:
                f.write(f"### {file}\n\n")
                f.write("Imports:\n")
                for imp in sorted(imports):
                    f.write(f"- `{imp}`\n")
                f.write("\n")

    print(f"Report generated: {report_path}")
    print(f"\nFound {len(orphans)} potential orphaned files.")
    if orphans:
        print("\nOrphaned files:")
        for orphan in orphans:
            print(f"  - scripts/{orphan}")


if __name__ == "__main__":
    generate_report()
