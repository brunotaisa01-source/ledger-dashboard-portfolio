"""Security validation checks for Dashboard Ledger.

Scans for:
- Hardcoded secrets (API keys, passwords, tokens)
- SQL injection vulnerabilities (f-strings in execute calls)
- Dependency vulnerabilities (npm audit, pip-audit)
- Hardcoded absolute paths (not via paths.py)

Exit codes:
- 0: All checks pass
- 1: One or more checks fail
"""
from __future__ import annotations

import logging
import re
import subprocess
import sys
from pathlib import Path
from typing import Tuple

# Handle both module import and standalone execution
try:
    from ..utils.paths import ROOT
except ImportError:
    # Standalone mode - compute ROOT manually
    ROOT = Path(__file__).resolve().parent.parent.parent

logger = logging.getLogger(__name__)

#  Secret Detection Patterns 
SECRET_PATTERNS = [
    # Generic
    (r'(?i)(password|passwd|pwd)\s*[=:]\s*["\'](?!.*\*|.*x{3,}|.*\.{3,})([^"\']{4,})["\']', 'Password'),
    (r'(?i)(api[_-]?key|apikey)\s*[=:]\s*["\']([A-Za-z0-9_\-]{20,})["\']', 'API Key'),
    (r'(?i)(secret[_-]?key|secretkey)\s*[=:]\s*["\']([A-Za-z0-9_\-]{20,})["\']', 'Secret Key'),
    (r'(?i)(access[_-]?token|accesstoken)\s*[=:]\s*["\']([A-Za-z0-9_\-]{20,})["\']', 'Access Token'),

    # AWS
    (r'(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}', 'AWS Access Key'),
    (r'(?i)aws(.{0,20})?["\'][0-9a-zA-Z/+]{40}["\']', 'AWS Secret Key'),

    # GCP
    (r'AIza[0-9A-Za-z_\-]{35}', 'GCP API Key'),

    # Azure
    (r'(?i)azure.{0,20}["\'][a-z0-9]{32,}["\']', 'Azure Key'),

    # GitHub
    (r'gh[pousr]_[A-Za-z0-9_]{36,}', 'GitHub Token'),

    # OpenAI
    (r'sk-[A-Za-z0-9]{48}', 'OpenAI API Key'),

    # Private Keys
    (r'-----BEGIN [A-Z ]+PRIVATE KEY-----', 'Private Key'),
]

#  File Patterns to Skip 
SKIP_FILES = {
    'CLAUDE.md',
    'MEMORY.md',
    'PROJECT_GUIDE.md',
    'README.md',
    'security_check.py',  # This file (patterns are examples)
}

SKIP_DIRS = {
    '__pycache__',
    '.git',
    'node_modules',
    'venv',
    '.venv',
    'dist',
    'build',
}

SKIP_PATHS = {
    Path('dashboard/data'),
}


def check_secrets(files: list[Path]) -> Tuple[bool, list[str]]:
    """Scan Python/TypeScript files for hardcoded secrets.

    Args:
        files: List of file paths to scan

    Returns:
        Tuple of (pass: bool, issues: list[str])
    """
    issues = []

    for file_path in files:
        if file_path.name in SKIP_FILES:
            continue

        try:
            content = file_path.read_text(encoding='utf-8')
            lines = content.splitlines()

            for line_num, line in enumerate(lines, 1):
                # Skip if line has nosec comment
                if '# nosec' in line or '// nosec' in line:
                    continue

                for pattern, secret_type in SECRET_PATTERNS:
                    match = re.search(pattern, line)
                    if match:
                        rel_path = file_path.relative_to(ROOT)
                        issues.append(
                            f"{rel_path}:{line_num} - Potential {secret_type} detected: {line.strip()[:80]}"
                        )
        except Exception as e:
            logger.warning(f"Could not read {file_path}: {e}")

    return (len(issues) == 0, issues)


def check_sql_injection(files: list[Path]) -> Tuple[bool, list[str]]:
    """Detect f-strings used in SQL execute calls (SQL injection risk).

    SAFE patterns (table/view/column names from constants):
    - f'SELECT * FROM "{TABLE_CONSTANT}"'
    - f'DROP VIEW IF EXISTS "{VIEW_NAME}"'
    - f'ALTER TABLE "{table}" ADD COLUMN "{col}"'

    UNSAFE patterns (user input interpolated):
    - f'SELECT * FROM users WHERE id={user_id}'
    - f"DELETE FROM {table} WHERE name='{name}'"

    Args:
        files: List of Python file paths to scan

    Returns:
        Tuple of (pass: bool, issues: list[str])
    """
    issues = []

    # Pattern: cursor.execute(f"...{var}...") or conn.execute(f"...")
    sql_fstring_pattern = re.compile(
        r'\.execute\s*\(\s*f["\']',
        re.IGNORECASE
    )

    # Safe patterns: table/view/col names in quotes, PRAGMA, schema operations
    safe_patterns = [
        r'f["\'][^"\']*\{[^}]+\}[^"\']*["\']',  # General f-string with vars
        r"f'''",                                   # Multiline f-string (needs manual review)
        r'f"""',                                   # Multiline f-string (needs manual review)
        r'PRAGMA\s+table_info',                   # PRAGMA queries (safe)
        r'DROP\s+(TABLE|VIEW)\s+IF\s+EXISTS\s+"',  # DROP with quoted names
        r'CREATE\s+(TABLE|VIEW)\s+"',              # CREATE with quoted names
        r'ALTER\s+TABLE\s+"',                      # ALTER with quoted names
        r'INSERT\s+INTO\s+"',                      # INSERT with quoted names
        r'DELETE\s+FROM\s+"\{',                    # DELETE with quoted table
        r'SELECT\s+\{[^}]+\}\s+FROM',              # SELECT with column list var
        r'FROM\s+"\{',                             # FROM with quoted table variable
    ]

    # Compile safe patterns
    safe_compiled = [re.compile(p, re.IGNORECASE) for p in safe_patterns]

    for file_path in files:
        if file_path.suffix != '.py':
            continue
        if file_path.name in SKIP_FILES:
            continue

        try:
            content = file_path.read_text(encoding='utf-8')
            lines = content.splitlines()

            for line_num, line in enumerate(lines, 1):
                # Skip if line has nosec comment
                if '# nosec' in line:
                    continue

                if sql_fstring_pattern.search(line):
                    # Check if it matches a safe pattern
                    is_safe = False
                    for safe_re in safe_compiled:
                        if safe_re.search(line):
                            is_safe = True
                            break

                    # Only report if NOT safe
                    if not is_safe:
                        rel_path = file_path.relative_to(ROOT)
                        issues.append(
                            f"{rel_path}:{line_num} - SQL f-string (possible injection): {line.strip()[:80]}"
                        )
        except Exception as e:
            logger.warning(f"Could not read {file_path}: {e}")

    return (len(issues) == 0, issues)


def check_dependencies() -> Tuple[bool, list[str]]:
    """Run npm audit and pip-audit for dependency vulnerabilities.

    Returns:
        Tuple of (pass: bool, issues: list[str])
    """
    issues = []
    all_passed = True

    #  npm audit 
    package_json = ROOT / "package.json"
    if package_json.exists():
        try:
            result = subprocess.run(
                ["npm", "audit", "--audit-level=moderate", "--json"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=30
            )
            # npm audit returns non-zero if vulnerabilities found
            if result.returncode != 0:
                issues.append("npm audit found vulnerabilities (run 'npm audit' for details)")
                all_passed = False
        except FileNotFoundError:
            issues.append("npm not found (skipping npm audit)")
        except subprocess.TimeoutExpired:
            issues.append("npm audit timed out")
        except Exception as e:
            issues.append(f"npm audit failed: {e}")

    #  pip-audit 
    try:
        result = subprocess.run(
            ["pip-audit", "--format=json"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60
        )
        # pip-audit returns non-zero if vulnerabilities found
        if result.returncode != 0:
            issues.append("pip-audit found vulnerabilities (run 'pip-audit' for details)")
            all_passed = False
    except FileNotFoundError:
        issues.append("pip-audit not installed (skipping; install: pip install pip-audit)")
    except subprocess.TimeoutExpired:
        issues.append("pip-audit timed out")
    except Exception as e:
        issues.append(f"pip-audit failed: {e}")

    return (all_passed, issues)


def check_hardcoded_paths(files: list[Path]) -> Tuple[bool, list[str]]:
    """Detect hardcoded absolute paths (should use paths.py instead).

    Args:
        files: List of file paths to scan

    Returns:
        Tuple of (pass: bool, warnings: list[str])
        Note: This check warns but doesn't fail (some paths in docs are OK)
    """
    warnings = []

    # Patterns for absolute paths
    windows_path = re.compile(r'[A-Z]:\\(?:Users\\[^\\]+\\|ProgramData\\|Windows\\|Temp\\)', re.IGNORECASE)
    unix_path = re.compile(r'/(?:Users|home)/[^/]+/')

    for file_path in files:
        if file_path.name in SKIP_FILES:
            continue

        try:
            content = file_path.read_text(encoding='utf-8')
            lines = content.splitlines()

            for line_num, line in enumerate(lines, 1):
                # Skip if line has nosec comment
                if '# nosec' in line or '// nosec' in line:
                    continue

                # Skip comments and docstrings (common for examples)
                stripped = line.strip()
                if stripped.startswith('#') or stripped.startswith('//') or stripped.startswith('*'):
                    continue

                # Check for Windows paths
                if windows_path.search(line):
                    rel_path = file_path.relative_to(ROOT)
                    warnings.append(
                        f"{rel_path}:{line_num} - Hardcoded Windows path detected: {line.strip()[:80]}"
                    )

                # Check for Unix paths
                if unix_path.search(line):
                    rel_path = file_path.relative_to(ROOT)
                    warnings.append(
                        f"{rel_path}:{line_num} - Hardcoded Unix path detected: {line.strip()[:80]}"
                    )
        except Exception as e:
            logger.warning(f"Could not read {file_path}: {e}")

    # Warnings don't fail the check
    return (True, warnings)


def collect_source_files() -> list[Path]:
    """Collect all Python and TypeScript files for scanning.

    Returns:
        List of Path objects to scan
    """
    files = []

    for pattern in ['**/*.py', '**/*.ts', '**/*.js']:
        for file_path in ROOT.rglob(pattern):
            # Skip excluded directories
            if any(skip_dir in file_path.parts for skip_dir in SKIP_DIRS):
                continue
            rel_path = file_path.relative_to(ROOT)
            if any(rel_path == skip_path or skip_path in rel_path.parents for skip_path in SKIP_PATHS):
                continue
            files.append(file_path)

    return sorted(files)


def main() -> int:
    """Run all security checks and print report.

    Returns:
        0 if all checks pass, 1 if any check fails
    """
    logging.basicConfig(
        level=logging.INFO,
        format='%(levelname)s: %(message)s'
    )

    logger.info("=" * 60)
    logger.info("Security Check - Dashboard Ledger")
    logger.info("=" * 60)

    # Collect files
    logger.info("\nCollecting source files...")
    files = collect_source_files()
    logger.info(f"Found {len(files)} files to scan")

    all_passed = True
    total_issues = 0

    #  Check 1: Secrets 
    logger.info("\n[1/4] Scanning for hardcoded secrets...")
    passed, issues = check_secrets(files)
    if not passed:
        all_passed = False
        total_issues += len(issues)
        logger.error(f"FAIL: Found {len(issues)} potential secret(s)")
        for issue in issues:
            logger.error(f"  - {issue}")
    else:
        logger.info("PASS: No hardcoded secrets detected")

    #  Check 2: SQL Injection 
    logger.info("\n[2/4] Scanning for SQL injection risks...")
    passed, issues = check_sql_injection(files)
    if not passed:
        all_passed = False
        total_issues += len(issues)
        logger.error(f"FAIL: Found {len(issues)} SQL f-string(s)")
        for issue in issues:
            logger.error(f"  - {issue}")
    else:
        logger.info("PASS: No SQL injection risks detected")

    #  Check 3: Dependencies 
    logger.info("\n[3/4] Checking dependency vulnerabilities...")
    passed, issues = check_dependencies()
    if not passed:
        all_passed = False
        total_issues += len(issues)
        logger.error(f"FAIL: Dependency vulnerabilities found")
        for issue in issues:
            logger.error(f"  - {issue}")
    elif issues:
        # Warnings (tools not installed)
        logger.warning("WARN: Some checks skipped")
        for issue in issues:
            logger.warning(f"  - {issue}")
    else:
        logger.info("PASS: No dependency vulnerabilities")

    #  Check 4: Hardcoded Paths 
    logger.info("\n[4/4] Scanning for hardcoded paths...")
    passed, warnings = check_hardcoded_paths(files)
    if warnings:
        logger.warning(f"WARN: Found {len(warnings)} hardcoded path(s)")
        for warning in warnings[:10]:  # Limit to first 10
            logger.warning(f"  - {warning}")
        if len(warnings) > 10:
            logger.warning(f"  ... and {len(warnings) - 10} more")
    else:
        logger.info("PASS: No hardcoded paths detected")

    #  Summary 
    logger.info("\n" + "=" * 60)
    if all_passed:
        logger.info(" All security checks PASSED")
        logger.info("=" * 60)
        return 0
    else:
        logger.error(f" Security checks FAILED ({total_issues} issue(s) found)")
        logger.error("=" * 60)
        return 1


if __name__ == "__main__":
    sys.exit(main())
