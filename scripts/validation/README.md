# Validation

**Purpose:** Data validation and quality checks for pre-deploy verification.

## Files

### Data Validation

- `validate_data.py`  18 validation checks: DB schema, row counts, aging columns, owner consistency, week coverage, orphan detection

### Security Validation

- `security_check.py`  4 security checks: hardcoded secrets, SQL injection, dependency vulnerabilities, hardcoded paths

## Usage

```bash
# Run data validation checks
python -m scripts.validation.validate_data

# Pre-deploy stage (used by deploy.py)
python -m scripts.validation.validate_data --stage predeploy

# Run security checks
python -m scripts.validation.security_check

# Or run standalone
python scripts/validation/security_check.py
```

## Data Validation Checks

1. Database schema (tables, columns)
2. Ledger row counts (min 10K rows per snapshot)
3. Key row counts (min 5K rows)
4. Aging column presence (0-30, 31-60, etc.)
5. Owner field consistency (no NULLs in Detail rows)
6. Week coverage (SQLite vs Excel snapshots)
7. Orphan detection (snapshots without DB data)
8. SyntheticReview daily summary (snapshot date range)
9-18. Additional data quality checks

## Security Checks

1. **Hardcoded Secrets**  Scans for API keys, passwords, tokens (AWS, GCP, Azure, OpenAI, GitHub, etc.)
2. **SQL Injection**  Detects unsafe f-strings in `cursor.execute()` calls
3. **Dependency Vulnerabilities**  Runs `npm audit` and `pip-audit` (if installed)
4. **Hardcoded Paths**  Warns about drive-root and home-directory paths not using `paths.py`

### Suppressing False Positives

Add `# nosec` comment to suppress security warnings on a specific line:

```python
# Example: intentional test data
password = "test123"  # nosec
```

## Dependencies

Imports from:
- `../utils/` (paths, dashboard_config, masterdata_core, sql_loader, synthetic_review_helpers)

## Exit Codes

- `0`  All checks passed
- `1`  One or more checks failed
