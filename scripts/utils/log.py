"""
Centralized logging for the AP Control Dashboard project.

Usage:
    from .log import get_logger
    log = get_logger(__name__)
    log.info("Data loaded: %d rows", count)
    log.warning("Column not found: %s", col)

Output goes to stdout (compatible with .bat file log capture via >>).
Format: [HH:MM:SS] [LEVEL] message
"""
import logging
import sys

_CONFIGURED = False


def get_logger(name: str) -> logging.Logger:
    """Return a logger configured for console output on stdout."""
    global _CONFIGURED
    if not _CONFIGURED:
        _configure_root()
        _CONFIGURED = True
    return logging.getLogger(name)


def _configure_root():
    """Configure root logger: stdout handler, concise format."""
    root = logging.getLogger()
    if root.handlers:
        return
    root.setLevel(logging.DEBUG)
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.DEBUG)
    fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    handler.setFormatter(fmt)
    root.addHandler(handler)
