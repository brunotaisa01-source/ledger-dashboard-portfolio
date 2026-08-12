#!/usr/bin/env python3
"""notify.py  Pipeline notification via Outlook email.

Sends email notifications using Outlook COM (no extra pip dependencies).
Falls back gracefully if Outlook is unavailable  never blocks the pipeline.

Usage:
    py scripts/notify.py --status failure --message "Ledger loader failed"
    py scripts/notify.py --status warning --message "SyntheticReview download timeout"
    py scripts/notify.py --status success --message "Pipeline complete"
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

#  Resolve project paths 
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
from .paths import LOGS_DIR  # noqa: E402

#  Constants 
STATUS_PREFIXES = {
    "success": "[OK]",
    "failure": "[FALHA]",
    "warning": "[AVISO]",
}

STATUS_PRIORITY = {
    "success": "Normal",
    "failure": "High",
    "warning": "Normal",
}


def _load_notify_email() -> str:
    """Load notification recipient email from local runtime .env."""
    from dotenv import load_dotenv

    local_env = Path(
        os.environ.get(
            "SYNTHETIC_REPORTING_ENV_FILE",
            str(PROJECT_ROOT / "runtime" / "config" / ".env"),
        )
    )
    legacy_env = PROJECT_ROOT.parent / ".env"
    for env_path in (local_env, legacy_env):
        if env_path.exists():
            load_dotenv(env_path)
            break

    # NOTIFY_EMAIL preferred, fallback to SYNTHETIC_REVIEW_EMAIL
    return os.getenv("NOTIFY_EMAIL", os.getenv("SYNTHETIC_REVIEW_EMAIL", "")).strip()


def send_email(subject: str, body: str, to: str | None = None,
               priority: str = "Normal") -> bool:
    """Send email via Outlook COM using PowerShell.

    Args:
        subject: Email subject line.
        body: Email body text.
        to: Recipient email (reads .env if None).
        priority: 'High' or 'Normal'  maps to Outlook Importance.

    Returns True on success, False on failure (never raises).
    """
    recipient = to or _load_notify_email()
    if not recipient:
        print("[NOTIFY] No email configured (set NOTIFY_EMAIL in local runtime .env)")
        return False

    # Escape single quotes for PowerShell string
    safe_subject = subject.replace("'", "''")
    safe_body = body.replace("'", "''")
    safe_to = recipient.replace("'", "''")

    importance = 2 if priority == "High" else 1

    ps_script = (
        "$ol = New-Object -ComObject Outlook.Application; "
        "$mail = $ol.CreateItem(0); "
        f"$mail.To = '{safe_to}'; "
        f"$mail.Subject = '{safe_subject}'; "
        f"$mail.Body = '{safe_body}'; "
        f"$mail.Importance = {importance}; "
        "$mail.Send()"
    )

    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            print(f"[NOTIFY] Email sent to {recipient}: {subject}")
            return True
        else:
            print(f"[NOTIFY] PowerShell error: {result.stderr.strip()[:200]}")
            return False
    except subprocess.TimeoutExpired:
        print("[NOTIFY] Timeout sending email (30s)")
        return False
    except Exception as e:
        print(f"[NOTIFY] Failed to send email: {e}")
        return False


def notify(status: str, message: str, to: str | None = None) -> bool:
    """Send a pipeline notification with appropriate formatting.

    Args:
        status: One of 'success', 'failure', 'warning'.
        message: The notification body text.
        to: Optional override recipient email.

    Returns:
        True if email was sent successfully.
    """
    prefix = STATUS_PREFIXES.get(status, "[INFO]")
    subject = f"Synthetic Reporting {prefix} {message[:80]}"
    body = (
        f"Status: {status.upper()}\n"
        f"Message: {message}\n"
        f"\n"
        f"---\n"
        f"Automated notification from Synthetic Reporting Pipeline.\n"
        f"Logs: {LOGS_DIR}\n"
    )
    priority = STATUS_PRIORITY.get(status, "Normal")
    return send_email(subject, body, to=to, priority=priority)


def main():
    parser = argparse.ArgumentParser(description="Synthetic Reporting  Pipeline Notifications")
    parser.add_argument("--status", required=True, choices=["success", "failure", "warning"],
                        help="Notification severity level")
    parser.add_argument("--message", required=True, help="Notification message text")
    parser.add_argument("--to", default=None, help="Override recipient email")
    args = parser.parse_args()

    ok = notify(args.status, args.message, to=args.to)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
