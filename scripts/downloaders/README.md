# Downloaders

**Purpose:** Automated downloaders for external data sources (SyntheticReview, Statement).

## Files

### SyntheticReview Downloader
- `synthetic_review_downloader.py`  Playwright automation: headless browser, persistent SSO session, downloads Invoice Errors + Duplicate Invoices from ap.synthetic_review.com

### Statement Downloader
- `statement_downloader.py`  Statement file downloader (Reconciliation History weekly export)

## Usage

```bash
# Setup (one-time): login via Microsoft SSO
python -m scripts.downloaders.synthetic_review_downloader --setup

# Daily download (headless, no login needed)
python -m scripts.downloaders.synthetic_review_downloader

# Statement download
python -m scripts.downloaders.statement_downloader
```

## Dependencies

Imports from:
- `../utils/` (paths, notify)

## Requirements

- playwright >= 1.40
- After install: `playwright install chromium`
- Browser profile stored in: `runtime\browser\synthetic_review`

## Output Files

- `data/SyntheticReview/Invoice_Errors_*.xlsx`  SyntheticReview errors
- `data/SyntheticReview/Duplicate_Invoices_*.xlsx`  SyntheticReview duplicates
- `data/SyntheticReview/Reconciliation_History_*.csv`  Statement export
