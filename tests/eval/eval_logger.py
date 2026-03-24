"""Phase-aware, check-aware structured logging for the eval harness.

Provides dual-output logging: colorized console (human-readable) and
plain-text file (machine-parseable). Every log message includes
timestamp, phase, check_id, and elapsed_ms.

Usage::

    logger = EvalLogger(evidence_dir="/tmp/evidence", eval_id="child-eval-...")
    logger.phase_start("scaffolding")
    logger.check_start("scaff.dir_exists")
    logger.check_result("scaff.dir_exists", CheckStatus.PASS, "Directory found")
    logger.phase_end("scaffolding", "13/13 checks passed")
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import IO, Any, Optional

from tests.eval.reason_codes import CheckStatus


# ---------------------------------------------------------------------------
# ANSI colours (console only)
# ---------------------------------------------------------------------------

class _Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"


_STATUS_COLORS = {
    "PASS": _Colors.GREEN,
    "FAIL": _Colors.RED,
    "SKIP": _Colors.YELLOW,
    "INVALID": _Colors.MAGENTA,
    "ERROR": _Colors.RED + _Colors.BOLD,
}


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

class _ConsoleFormatter(logging.Formatter):
    """Colourised console formatter with phase/check context."""

    LEVEL_COLORS = {
        "DEBUG": _Colors.DIM,
        "INFO": _Colors.CYAN,
        "WARNING": _Colors.YELLOW,
        "ERROR": _Colors.RED,
        "CRITICAL": _Colors.RED + _Colors.BOLD,
    }

    def format(self, record: logging.LogRecord) -> str:
        ts = self.formatTime(record, "%H:%M:%S")
        lvl = record.levelname
        color = self.LEVEL_COLORS.get(lvl, "")

        parts = [f"{_Colors.DIM}{ts}{_Colors.RESET}"]
        parts.append(f"{color}{lvl:>8s}{_Colors.RESET}")

        phase = getattr(record, "phase", "")
        check_id = getattr(record, "check_id", "")
        elapsed = getattr(record, "elapsed_ms", None)

        if phase:
            parts.append(f"{_Colors.BLUE}[{phase}]{_Colors.RESET}")
        if check_id:
            parts.append(f"{_Colors.MAGENTA}{check_id}{_Colors.RESET}")

        parts.append(str(record.getMessage()))

        if elapsed is not None:
            parts.append(f"{_Colors.DIM}({elapsed:.0f}ms){_Colors.RESET}")

        return " ".join(parts)


class _FileFormatter(logging.Formatter):
    """Plain-text file formatter (machine-parseable)."""

    def format(self, record: logging.LogRecord) -> str:
        ts = self.formatTime(record, "%Y-%m-%dT%H:%M:%S")
        lvl = record.levelname

        phase = getattr(record, "phase", "")
        check_id = getattr(record, "check_id", "")
        elapsed = getattr(record, "elapsed_ms", None)

        fields = [ts, lvl, phase, check_id, str(record.getMessage())]
        if elapsed is not None:
            fields.append(f"{elapsed:.0f}ms")

        return " | ".join(fields)


# ---------------------------------------------------------------------------
# EvalLogger
# ---------------------------------------------------------------------------

class EvalLogger:
    """Structured logger for the eval harness.

    Parameters
    ----------
    evidence_dir : str or None
        If provided, a log file is written to ``<evidence_dir>/eval.log``.
    eval_id : str
        Eval run identifier (included in file log header).
    verbose : bool
        If True, console shows DEBUG. If False, console shows INFO+.
    quiet : bool
        If True, console is suppressed entirely.
    """

    def __init__(
        self,
        evidence_dir: str | None = None,
        eval_id: str = "",
        verbose: bool = False,
        quiet: bool = False,
    ) -> None:
        self._eval_id = eval_id
        self._phase = ""
        self._phase_start: float | None = None
        self._check_timers: dict[str, float] = {}
        self._logger = logging.getLogger(f"eval.{eval_id or 'default'}")
        self._logger.setLevel(logging.DEBUG)
        self._logger.propagate = False

        # Remove any existing handlers (e.g. from re-init in tests)
        self._logger.handlers.clear()

        # Console handler
        if not quiet:
            console = logging.StreamHandler(sys.stderr)
            console.setLevel(logging.DEBUG if verbose else logging.INFO)
            console.setFormatter(_ConsoleFormatter())
            self._logger.addHandler(console)

        # File handler
        self._log_file: Optional[IO[str]] = None
        if evidence_dir:
            log_path = Path(evidence_dir) / "eval.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            fh = logging.FileHandler(str(log_path), mode="w", encoding="utf-8")
            fh.setLevel(logging.DEBUG)
            fh.setFormatter(_FileFormatter())
            self._logger.addHandler(fh)

    # -- Internal helpers -------------------------------------------------

    def _extra(
        self,
        check_id: str = "",
        elapsed_ms: float | None = None,
    ) -> dict[str, Any]:
        return {
            "phase": self._phase,
            "check_id": check_id,
            "elapsed_ms": elapsed_ms,
        }

    # -- Phase lifecycle --------------------------------------------------

    def phase_start(self, phase_name: str) -> None:
        """Mark the start of a verification phase."""
        self._phase = phase_name
        self._phase_start = time.monotonic()
        self._logger.info(
            "Phase started: %s", phase_name,
            extra=self._extra(),
        )

    def phase_end(self, phase_name: str, summary: str = "") -> None:
        """Mark the end of a verification phase."""
        elapsed = None
        if self._phase_start is not None:
            elapsed = (time.monotonic() - self._phase_start) * 1000

        self._logger.info(
            "Phase ended: %s — %s", phase_name, summary,
            extra=self._extra(elapsed_ms=elapsed),
        )
        self._phase = ""
        self._phase_start = None

    # -- Check lifecycle --------------------------------------------------

    def check_start(self, check_id: str) -> None:
        """Mark the start of a single check."""
        self._check_timers[check_id] = time.monotonic()
        self._logger.debug(
            "Check started",
            extra=self._extra(check_id=check_id),
        )

    def check_result(
        self,
        check_id: str,
        status: CheckStatus,
        detail: str = "",
    ) -> None:
        """Log the result of a single check."""
        elapsed = None
        start = self._check_timers.pop(check_id, None)
        if start is not None:
            elapsed = (time.monotonic() - start) * 1000

        color = _STATUS_COLORS.get(status.value, "")
        # For file output, the formatter ignores ANSI; for console, it's readable
        msg = f"{color}{status.value}{_Colors.RESET}"
        if detail:
            msg += f" — {detail}"

        self._logger.info(
            msg,
            extra=self._extra(check_id=check_id, elapsed_ms=elapsed),
        )

    # -- HTTP tracing -----------------------------------------------------

    def http_log(
        self,
        method: str,
        url: str,
        status: int,
        elapsed_ms: float,
        redacted_headers: dict[str, str] | None = None,
    ) -> None:
        """Log an HTTP request/response for tracing."""
        hdr_str = ""
        if redacted_headers:
            hdr_str = " " + " ".join(
                f"{k}={v}" for k, v in redacted_headers.items()
            )
        self._logger.debug(
            "HTTP %s %s -> %d%s",
            method, url, status, hdr_str,
            extra=self._extra(elapsed_ms=elapsed_ms),
        )

    # -- Process tracing --------------------------------------------------

    def process_log(
        self,
        cmd: str,
        pid: int | None = None,
        exit_code: int | None = None,
        elapsed_ms: float | None = None,
    ) -> None:
        """Log a subprocess lifecycle event."""
        parts = [f"Process: {cmd}"]
        if pid is not None:
            parts.append(f"pid={pid}")
        if exit_code is not None:
            parts.append(f"rc={exit_code}")
        self._logger.info(
            " ".join(parts),
            extra=self._extra(elapsed_ms=elapsed_ms),
        )

    # -- Convenience wrappers ---------------------------------------------

    def debug(self, msg: str, **kwargs: Any) -> None:
        self._logger.debug(msg, extra=self._extra(**kwargs))

    def info(self, msg: str, **kwargs: Any) -> None:
        self._logger.info(msg, extra=self._extra(**kwargs))

    def warning(self, msg: str, **kwargs: Any) -> None:
        self._logger.warning(msg, extra=self._extra(**kwargs))

    def error(self, msg: str, **kwargs: Any) -> None:
        self._logger.error(msg, extra=self._extra(**kwargs))
