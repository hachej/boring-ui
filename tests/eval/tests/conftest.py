"""Shared pytest fixtures for eval harness tests.

Provides deterministic, predictable test data for contracts, manifests,
check results, and mocks.
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Generator
from unittest.mock import MagicMock, patch

import pytest

from tests.eval.contracts import (
    CategoryScore,
    CheckResult,
    NamingContract,
    RunManifest,
)
from tests.eval.eval_logger import EvalLogger
from tests.eval.reason_codes import Attribution, CheckStatus, Confidence


# ---------------------------------------------------------------------------
# Known test values (deterministic)
# ---------------------------------------------------------------------------

TEST_EVAL_ID = "child-eval-20260320T120000Z-t3stv4lu"
TEST_APP_SLUG = "ce-0320-t3stv4lu"
TEST_PYTHON_MODULE = "ce_0320_t3stv4lu"
TEST_PROJECTS_ROOT = "/tmp/eval-test-projects"
TEST_PROJECT_ROOT = f"{TEST_PROJECTS_ROOT}/{TEST_APP_SLUG}"
TEST_NONCE = "test-nonce-abc123"


# ---------------------------------------------------------------------------
# Directory fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_evidence_dir(tmp_path: Path) -> Path:
    """Temporary directory for evidence artifacts, cleaned up after test."""
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    return evidence


@pytest.fixture
def tmp_project_dir(tmp_path: Path) -> Path:
    """Temporary directory simulating a generated child app project."""
    proj = tmp_path / TEST_APP_SLUG
    proj.mkdir()
    return proj


# ---------------------------------------------------------------------------
# Contract fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_naming_contract() -> NamingContract:
    """NamingContract with known, predictable values."""
    return NamingContract(
        eval_id=TEST_EVAL_ID,
        app_slug=TEST_APP_SLUG,
        python_module=TEST_PYTHON_MODULE,
        project_root=TEST_PROJECT_ROOT,
        projects_root=TEST_PROJECTS_ROOT,
    )


@pytest.fixture
def sample_manifest(sample_naming_contract: NamingContract) -> RunManifest:
    """RunManifest with predictable values for testing."""
    return RunManifest(
        eval_id=TEST_EVAL_ID,
        eval_spec_version="0.1.0",
        report_schema_version="0.1.0",
        platform_profile="core",
        app_slug=TEST_APP_SLUG,
        python_module=TEST_PYTHON_MODULE,
        project_root=TEST_PROJECT_ROOT,
        verification_nonce=TEST_NONCE,
        required_routes=["/health", "/info"],
        report_output_path=f"{TEST_PROJECT_ROOT}/.eval-evidence/report.json",
        event_log_path=f"{TEST_PROJECT_ROOT}/.eval-evidence/events.jsonl",
        timeouts={
            "scaffold": 300,
            "local_validation": 120,
            "neon_setup": 180,
            "deploy": 600,
            "live_validation": 120,
            "cleanup": 120,
        },
        evidence_dir=f"{TEST_PROJECT_ROOT}/.eval-evidence",
        lease_id="lease-test-abc123",
    )


# ---------------------------------------------------------------------------
# Check result factory
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_check_result() -> _CheckResultFactory:
    """Factory fixture for creating CheckResult with sensible defaults."""
    return _CheckResultFactory()


class _CheckResultFactory:
    """Creates CheckResult instances with overridable defaults."""

    def __call__(
        self,
        check_id: str = "test.check",
        category: str = "scaffolding",
        weight: float = 2.0,
        status: CheckStatus = CheckStatus.PASS,
        reason_code: str = "",
        attribution: Attribution = Attribution.UNKNOWN,
        detail: str = "",
        **kwargs: Any,
    ) -> CheckResult:
        return CheckResult(
            id=check_id,
            category=category,
            weight=weight,
            status=status,
            reason_code=reason_code,
            attribution=attribution,
            detail=detail,
            **kwargs,
        )

    def passed(self, check_id: str, **kwargs: Any) -> CheckResult:
        return self(check_id=check_id, status=CheckStatus.PASS, **kwargs)

    def failed(
        self, check_id: str, reason_code: str = "TEST_FAIL", **kwargs: Any
    ) -> CheckResult:
        return self(
            check_id=check_id,
            status=CheckStatus.FAIL,
            reason_code=reason_code,
            attribution=Attribution.AGENT,
            **kwargs,
        )

    def skipped(self, check_id: str, **kwargs: Any) -> CheckResult:
        return self(
            check_id=check_id,
            status=CheckStatus.SKIP,
            skipped=True,
            **kwargs,
        )


# ---------------------------------------------------------------------------
# Mock fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_vault():
    """Patch Vault CLI calls to return known test secrets.

    Yields a dict mapping (path, field) -> value for assertions.
    """
    secrets_map: dict[tuple[str, str], str] = {
        ("secret/agent/anthropic", "api_key"): "sk-ant-test-key-REDACTED",
        ("secret/agent/boringdata-agent", "token"): "ghp-test-token-REDACTED",
        ("secret/agent/app/boring-ui/prod", "session_secret"): "test-session-secret",
        ("secret/agent/app/boring-ui/prod", "database_url"): "postgresql://test:test@localhost/test",
    }

    def _fake_vault(cmd: list[str], **kwargs: Any) -> MagicMock:
        result = MagicMock()
        result.returncode = 0
        result.stdout = ""
        result.stderr = ""

        # Parse: vault kv get -field=<field> <path>
        if len(cmd) >= 5 and cmd[0] == "vault" and cmd[2] == "get":
            field_arg = next(
                (a for a in cmd if a.startswith("-field=")), None
            )
            path = cmd[-1]
            if field_arg:
                field_name = field_arg.split("=", 1)[1]
                key = (path, field_name)
                if key in secrets_map:
                    result.stdout = secrets_map[key]
                else:
                    result.returncode = 2
                    result.stderr = f"No value found at {path} field={field_name}"

        return result

    with patch("subprocess.run", side_effect=_fake_vault) as mock_run:
        yield secrets_map, mock_run


@pytest.fixture
def mock_bui():
    """Patch bui CLI calls to return known output."""
    responses: dict[str, tuple[int, str]] = {
        "init": (0, "Created new app at /tmp/test-app"),
        "doctor": (0, "All checks passed"),
        "deploy": (0, "Deployed to https://test-app.fly.dev"),
    }

    def _fake_bui(cmd: list[str], **kwargs: Any) -> MagicMock:
        result = MagicMock()
        sub_cmd = cmd[1] if len(cmd) > 1 else ""
        rc, stdout = responses.get(sub_cmd, (1, f"Unknown command: {sub_cmd}"))
        result.returncode = rc
        result.stdout = stdout
        result.stderr = ""
        return result

    with patch("subprocess.run", side_effect=_fake_bui) as mock_run:
        yield responses, mock_run


# ---------------------------------------------------------------------------
# Logger fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def eval_logger(tmp_evidence_dir: Path) -> EvalLogger:
    """EvalLogger writing to the tmp evidence dir."""
    return EvalLogger(
        evidence_dir=str(tmp_evidence_dir),
        eval_id=TEST_EVAL_ID,
        verbose=True,
    )


@pytest.fixture
def capture_logs():
    """Context manager that captures EvalLogger output for assertions.

    Usage::

        def test_something(capture_logs):
            with capture_logs() as logs:
                logger.info("hello")
            assert "hello" in logs.text
    """
    return _CaptureLogsFactory


class _CaptureLogsFactory:
    """Context manager for capturing EvalLogger output."""

    def __init__(self, logger_name: str = ""):
        self._name = logger_name
        self.text = ""
        self._handler: logging.Handler | None = None

    def __enter__(self) -> _CaptureLogsFactory:
        self._handler = _CapturingHandler(self)
        self._handler.setLevel(logging.DEBUG)
        target = logging.getLogger(self._name) if self._name else logging.root
        target.addHandler(self._handler)
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._handler:
            target = logging.getLogger(self._name) if self._name else logging.root
            target.removeHandler(self._handler)


class _CapturingHandler(logging.Handler):
    def __init__(self, capture: _CaptureLogsFactory) -> None:
        super().__init__()
        self._capture = capture

    def emit(self, record: logging.LogRecord) -> None:
        self._capture.text += self.format(record) + "\n"


# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

def assert_check_passed(results: list[CheckResult], check_id: str) -> None:
    """Assert that *check_id* has status PASS in *results*."""
    for r in results:
        if r.id == check_id:
            assert r.status == CheckStatus.PASS, (
                f"Expected {check_id} PASS, got {r.status.value}: {r.detail}"
            )
            return
    raise AssertionError(f"Check {check_id} not found in results")


def assert_check_failed(
    results: list[CheckResult],
    check_id: str,
    reason_code: str | None = None,
) -> None:
    """Assert that *check_id* has status FAIL in *results*."""
    for r in results:
        if r.id == check_id:
            assert r.status == CheckStatus.FAIL, (
                f"Expected {check_id} FAIL, got {r.status.value}"
            )
            if reason_code:
                assert r.reason_code == reason_code, (
                    f"Expected reason {reason_code}, got {r.reason_code}"
                )
            return
    raise AssertionError(f"Check {check_id} not found in results")


def assert_no_secrets_in(
    text: str,
    secret_values: list[str],
) -> None:
    """Assert none of *secret_values* appear in *text*."""
    for secret in secret_values:
        if not secret:
            continue
        assert secret not in text, (
            f"Secret value found in text (first 20 chars: {secret[:20]}...)"
        )
