"""Local Dev / Runtime Validation checks (Phase B).

Verifies the generated app starts and behaves correctly before deploy.
The harness launches ``bui dev --backend-only`` in a clean-room environment
with ``CONTROL_PLANE_PROVIDER=local`` to bypass database dependencies.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from tests.eval.check_catalog import CATALOG
from tests.eval.contracts import CheckResult, RunManifest
from tests.eval.reason_codes import Attribution, CheckStatus


# ---------------------------------------------------------------------------
# Check context
# ---------------------------------------------------------------------------

class LocalDevContext:
    """Shared state for local dev checks."""

    def __init__(
        self,
        manifest: RunManifest,
        *,
        doctor_exit_code: int | None = None,
        doctor_stdout: str = "",
        doctor_stderr: str = "",
        dev_started: bool = False,
        dev_port: int | None = None,
        dev_stdout: str = "",
        dev_stderr: str = "",
        health_response: dict[str, Any] | None = None,
        health_status: int | None = None,
        info_response: dict[str, Any] | None = None,
        info_status: int | None = None,
        config_response: dict[str, Any] | None = None,
        config_status: int | None = None,
        capabilities_response: dict[str, Any] | None = None,
        capabilities_status: int | None = None,
        eval_tool_probes: dict[str, dict[str, Any]] | None = None,
        clean_shutdown: bool = False,
    ) -> None:
        self.manifest = manifest
        self.doctor_exit_code = doctor_exit_code
        self.doctor_stdout = doctor_stdout
        self.doctor_stderr = doctor_stderr
        self.dev_started = dev_started
        self.dev_port = dev_port
        self.dev_stdout = dev_stdout
        self.dev_stderr = dev_stderr
        self.health_response = health_response
        self.health_status = health_status
        self.info_response = info_response
        self.info_status = info_status
        self.config_response = config_response
        self.config_status = config_status
        self.capabilities_response = capabilities_response
        self.capabilities_status = capabilities_status
        self.eval_tool_probes = eval_tool_probes or {}
        self.clean_shutdown = clean_shutdown


def run_local_dev_checks(ctx: LocalDevContext) -> list[CheckResult]:
    """Run all 13 local dev checks."""
    return [
        _check_doctor_exit_0(ctx),
        _check_doctor_no_errors(ctx),
        _check_clean_room_dev_starts(ctx),
        _check_no_agent_process_dependency(ctx),
        _check_port_assigned(ctx),
        _check_custom_health(ctx),
        _check_custom_info(ctx),
        _check_config_200(ctx),
        _check_capabilities_200(ctx),
        _check_capabilities_shape(ctx),
        _check_no_startup_import_errors(ctx),
        _check_clean_shutdown(ctx),
        _check_no_tracebacks(ctx),
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _spec(check_id: str) -> dict[str, Any]:
    s = CATALOG[check_id]
    return {"id": check_id, "category": s.category, "weight": s.weight}


def _pass(check_id: str, detail: str = "") -> CheckResult:
    return CheckResult(**_spec(check_id), status=CheckStatus.PASS, detail=detail)


def _fail(check_id: str, reason_code: str, detail: str = "") -> CheckResult:
    return CheckResult(
        **_spec(check_id),
        status=CheckStatus.FAIL,
        reason_code=reason_code,
        attribution=Attribution.AGENT,
        detail=detail,
    )


def _skip(check_id: str, detail: str, blocked_by: list[str] | None = None) -> CheckResult:
    return CheckResult(
        **_spec(check_id),
        status=CheckStatus.SKIP,
        detail=detail,
        skipped=True,
        blocked_by=blocked_by or [],
    )


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def _check_doctor_exit_0(ctx: LocalDevContext) -> CheckResult:
    cid = "local.doctor_exit_0"
    if ctx.doctor_exit_code is None:
        return _skip(cid, "bui doctor not run")
    if ctx.doctor_exit_code == 0:
        return _pass(cid, "bui doctor exited 0")
    return _fail(cid, "LOCAL_HEALTH_FAILED", f"bui doctor exit code: {ctx.doctor_exit_code}")


def _check_doctor_no_errors(ctx: LocalDevContext) -> CheckResult:
    cid = "local.doctor_no_errors"
    if ctx.doctor_exit_code is None:
        return _skip(cid, "bui doctor not run", blocked_by=["local.doctor_exit_0"])
    combined = ctx.doctor_stdout + "\n" + ctx.doctor_stderr
    error_lines = [
        line for line in combined.splitlines()
        if re.search(r"\bERROR\b", line, re.IGNORECASE)
    ]
    if error_lines:
        return _fail(
            cid, "LOCAL_HEALTH_FAILED",
            f"{len(error_lines)} ERROR lines in doctor output",
        )
    return _pass(cid, "No ERROR lines in doctor output")


def _check_clean_room_dev_starts(ctx: LocalDevContext) -> CheckResult:
    """must_pass: Dev server starts in clean-room environment."""
    cid = "local.clean_room_dev_starts"
    if ctx.dev_started:
        return _pass(cid, "Dev server started in clean-room")
    return _fail(cid, "LOCAL_STARTUP_FAILED", "Dev server did not start")


def _check_no_agent_process_dependency(ctx: LocalDevContext) -> CheckResult:
    cid = "local.no_agent_process_dependency"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    # If the dev server started in clean-room (agent processes killed), it passes
    return _pass(cid, "Dev server runs independently of agent processes")


def _check_port_assigned(ctx: LocalDevContext) -> CheckResult:
    cid = "local.port_assigned"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    if ctx.dev_port and 1024 <= ctx.dev_port <= 65535:
        return _pass(cid, f"Port: {ctx.dev_port}")
    return _fail(cid, "LOCAL_STARTUP_FAILED", f"Invalid port: {ctx.dev_port}")


def _check_custom_health(ctx: LocalDevContext) -> CheckResult:
    """must_pass: Local /health returns valid JSON with required fields."""
    cid = "local.custom_health"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    if ctx.health_status != 200:
        return _fail(
            cid, "LOCAL_ROUTE_MISSING",
            f"/health returned status {ctx.health_status}",
        )
    if ctx.health_response is None:
        return _fail(cid, "LOCAL_RESPONSE_INVALID", "/health did not return JSON")

    # Check required fields (extra fields allowed)
    required = {"ok", "app", "eval_id", "verification_nonce"}
    missing = required - set(ctx.health_response.keys())
    if missing:
        return _fail(cid, "LOCAL_RESPONSE_INVALID", f"/health missing fields: {missing}")

    # Verify nonce matches
    nonce = ctx.health_response.get("verification_nonce")
    if nonce != ctx.manifest.verification_nonce:
        return _fail(
            cid, "LOCAL_NONCE_MISMATCH",
            f"nonce={nonce!r} vs expected={ctx.manifest.verification_nonce!r}",
        )

    return _pass(cid, "/health returns valid JSON with correct nonce")


def _check_custom_info(ctx: LocalDevContext) -> CheckResult:
    cid = "local.custom_info"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    if ctx.info_status != 200:
        return _fail(cid, "LOCAL_ROUTE_MISSING", f"/info status {ctx.info_status}")
    if ctx.info_response is None:
        return _fail(cid, "LOCAL_RESPONSE_INVALID", "/info did not return JSON")

    required = {"name", "version", "eval_id"}
    missing = required - set(ctx.info_response.keys())
    if missing:
        return _fail(cid, "LOCAL_RESPONSE_INVALID", f"/info missing: {missing}")
    return _pass(cid, "/info returns valid JSON with required fields")


def _check_config_200(ctx: LocalDevContext) -> CheckResult:
    cid = "local.config_200"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    if ctx.config_status == 200 and ctx.config_response is not None:
        return _pass(cid, "/__bui/config returns valid JSON")
    if ctx.config_status is not None:
        return _fail(cid, "LOCAL_ROUTE_MISSING", f"/__bui/config status {ctx.config_status}")
    return _skip(cid, "/__bui/config not probed")


def _check_capabilities_200(ctx: LocalDevContext) -> CheckResult:
    cid = "local.capabilities_200"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    if ctx.capabilities_status == 200 and ctx.capabilities_response is not None:
        return _pass(cid, "/api/capabilities returns valid JSON")
    if ctx.capabilities_status is not None:
        return _fail(cid, "LOCAL_ROUTE_MISSING", f"/api/capabilities status {ctx.capabilities_status}")
    return _skip(cid, "/api/capabilities not probed")


def _check_capabilities_shape(ctx: LocalDevContext) -> CheckResult:
    cid = "local.capabilities_shape"
    if ctx.capabilities_response is None:
        return _skip(cid, "No capabilities response", blocked_by=["local.capabilities_200"])
    cap = ctx.capabilities_response
    if "features" in cap or "routers" in cap or "version" in cap:
        return _pass(cid, "Capabilities has expected structure")
    return _fail(cid, "LOCAL_RESPONSE_INVALID", "Capabilities missing features/routers/version")


def _check_no_startup_import_errors(ctx: LocalDevContext) -> CheckResult:
    cid = "local.no_startup_import_errors"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    combined = ctx.dev_stdout + "\n" + ctx.dev_stderr
    import_errors = [
        line for line in combined.splitlines()
        if "ImportError" in line or "ModuleNotFoundError" in line
    ]
    if import_errors:
        return _fail(
            cid, "LOCAL_STARTUP_FAILED",
            f"{len(import_errors)} import errors during startup",
        )
    return _pass(cid, "No import errors during startup")


def _check_clean_shutdown(ctx: LocalDevContext) -> CheckResult:
    cid = "local.clean_shutdown"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    if ctx.clean_shutdown:
        return _pass(cid, "Dev server exited cleanly")
    return _fail(cid, "LOCAL_HEALTH_FAILED", "Dev server did not exit cleanly")


def _check_no_tracebacks(ctx: LocalDevContext) -> CheckResult:
    cid = "local.no_tracebacks"
    if not ctx.dev_started:
        return _skip(cid, "Dev server not started", blocked_by=["local.clean_room_dev_starts"])
    combined = ctx.dev_stdout + "\n" + ctx.dev_stderr
    traceback_count = combined.count("Traceback (most recent call last)")
    if traceback_count > 0:
        return _fail(
            cid, "LOCAL_STARTUP_FAILED",
            f"{traceback_count} Python traceback(s) during run",
        )
    return _pass(cid, "No tracebacks during run")
