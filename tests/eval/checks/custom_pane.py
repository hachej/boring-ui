"""Extensible profile checks for custom workspace pane verification (Phase X.P)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from tests.eval.check_catalog import CATALOG
from tests.eval.contracts import CheckResult, RunManifest
from tests.eval.reason_codes import Attribution, CheckStatus


class CustomPaneContext:
    """Shared state for custom pane checks."""

    def __init__(
        self,
        manifest: RunManifest,
        *,
        local_ctx: Any | None = None,
        deployment_ctx: Any | None = None,
    ) -> None:
        self.manifest = manifest
        self.local_ctx = local_ctx
        self.deployment_ctx = deployment_ctx
        self.project_root = Path(manifest.project_root)
        self.pane_path = self.project_root / "kurt" / "panels" / "eval-status" / "Panel.jsx"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_custom_pane_checks(ctx: CustomPaneContext) -> list[CheckResult]:
    """Run all custom pane checks for the extensible profile."""
    return [
        _check_file_exists(ctx),
        _check_default_export(ctx),
        _check_in_capabilities(ctx),
        _check_renders_eval_id(ctx),
        _check_calls_backend(ctx),
        _check_no_import_errors(ctx),
        _check_live_capabilities(ctx),
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _spec(check_id: str) -> dict[str, Any]:
    spec = CATALOG[check_id]
    return {"id": check_id, "category": spec.category, "weight": spec.weight}


def _pass(check_id: str, detail: str = "", evidence_refs: list[str] | None = None) -> CheckResult:
    return CheckResult(
        **_spec(check_id),
        status=CheckStatus.PASS,
        detail=detail,
        evidence_refs=evidence_refs or [],
    )


def _fail(
    check_id: str,
    reason_code: str,
    detail: str = "",
    evidence_refs: list[str] | None = None,
) -> CheckResult:
    return CheckResult(
        **_spec(check_id),
        status=CheckStatus.FAIL,
        reason_code=reason_code,
        attribution=Attribution.AGENT,
        detail=detail,
        evidence_refs=evidence_refs or [],
    )


def _skip(
    check_id: str,
    detail: str,
    *,
    blocked_by: list[str] | None = None,
    evidence_refs: list[str] | None = None,
) -> CheckResult:
    return CheckResult(
        **_spec(check_id),
        status=CheckStatus.SKIP,
        detail=detail,
        skipped=True,
        blocked_by=blocked_by or [],
        evidence_refs=evidence_refs or [],
    )


def _read_pane_source(ctx: CustomPaneContext) -> str | None:
    if not ctx.pane_path.is_file():
        return None
    try:
        return ctx.pane_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _pane_in_capabilities(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    panes = payload.get("workspace_panes")
    if not isinstance(panes, list):
        return False

    for pane in panes:
        if isinstance(pane, dict):
            pane_id = str(pane.get("id") or "").strip()
            if pane_id == "ws-eval-status":
                return True
            if "eval-status" in pane_id:
                return True
        elif isinstance(pane, str) and "eval-status" in pane:
            return True
    return False


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def _check_file_exists(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.file_exists"
    if ctx.pane_path.is_file():
        return _pass(cid, f"Found {ctx.pane_path}", ["static_analysis/pane_exports.json"])
    return _fail(cid, "SCAFF_DIR_MISSING", f"Missing {ctx.pane_path}")


def _check_default_export(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.default_export"
    source = _read_pane_source(ctx)
    if source is None:
        return _skip(cid, "Pane file missing", blocked_by=["pane.file_exists"])

    if re.search(r"\bexport\s+default\b", source):
        return _pass(cid, "Panel has default export", ["static_analysis/pane_exports.json"])
    return _fail(cid, "SCAFF_ROUTER_MISSING", "Panel.jsx has no default export")


def _check_in_capabilities(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.in_capabilities"
    cap_payload = getattr(ctx.local_ctx, "capabilities_response", None) if ctx.local_ctx else None
    if cap_payload is None:
        return _skip(
            cid,
            "Local capabilities payload unavailable",
            blocked_by=["local.capabilities_200"],
            evidence_refs=["http/local_capabilities_pane.json"],
        )

    if _pane_in_capabilities(cap_payload):
        return _pass(
            cid,
            "workspace_panes includes ws-eval-status",
            ["http/local_capabilities_pane.json"],
        )
    return _fail(
        cid,
        "LOCAL_ROUTE_MISMATCH",
        "workspace_panes does not include ws-eval-status",
        ["http/local_capabilities_pane.json"],
    )


def _check_renders_eval_id(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.renders_eval_id"
    source = _read_pane_source(ctx)
    if source is None:
        return _skip(cid, "Pane file missing", blocked_by=["pane.file_exists"])

    has_eval = "eval_id" in source
    has_nonce = "verification_nonce" in source
    if has_eval and has_nonce:
        return _pass(cid, "Pane references eval_id and verification_nonce")

    missing: list[str] = []
    if not has_eval:
        missing.append("eval_id")
    if not has_nonce:
        missing.append("verification_nonce")
    return _fail(cid, "SCAFF_ROUTE_MISSING", f"Pane missing references: {', '.join(missing)}")


def _check_calls_backend(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.calls_backend"
    source = _read_pane_source(ctx)
    if source is None:
        return _skip(
            cid,
            "Pane file missing",
            blocked_by=["pane.file_exists"],
            evidence_refs=["static_analysis/pane_backend_call.json"],
        )

    has_fetch = "fetch(" in source or "axios" in source or "apiFetch" in source
    has_endpoint = "/api/x/eval_tool/compute" in source or "eval_tool/compute" in source
    if has_fetch and has_endpoint:
        return _pass(
            cid,
            "Pane calls /api/x/eval_tool/compute",
            ["static_analysis/pane_backend_call.json"],
        )

    return _fail(
        cid,
        "LOCAL_ROUTE_MISSING",
        "Pane does not call the custom eval_tool endpoint",
        ["static_analysis/pane_backend_call.json"],
    )


def _check_no_import_errors(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.no_import_errors"
    if not ctx.local_ctx or not getattr(ctx.local_ctx, "dev_started", False):
        return _skip(cid, "Local dev did not start", blocked_by=["local.clean_room_dev_starts"])

    combined = f"{getattr(ctx.local_ctx, 'dev_stdout', '')}\n{getattr(ctx.local_ctx, 'dev_stderr', '')}"
    suspect = re.search(
        r"(ImportError|ModuleNotFoundError|Cannot\s+find\s+module|Failed to fetch dynamically imported module)",
        combined,
        flags=re.IGNORECASE,
    )
    pane_marker = "eval-status" in combined or "Panel.jsx" in combined
    if suspect and pane_marker:
        return _fail(cid, "LOCAL_STARTUP_FAILED", "Import error references eval-status pane")

    return _pass(cid, "No pane import errors detected")


def _check_live_capabilities(ctx: CustomPaneContext) -> CheckResult:
    cid = "pane.live_capabilities"
    if not ctx.deployment_ctx or not getattr(ctx.deployment_ctx, "deployed_url", None):
        return _skip(
            cid,
            "No deployed URL",
            blocked_by=["deploy.health_200"],
            evidence_refs=["http/deploy_capabilities_pane.json"],
        )

    status, body = ctx.deployment_ctx.get("/api/capabilities")
    if status != 200 or not isinstance(body, dict):
        return _fail(
            cid,
            "DEPLOY_ROUTE_MISSING",
            f"/api/capabilities returned {status}",
            ["http/deploy_capabilities_pane.json"],
        )

    if _pane_in_capabilities(body):
        return _pass(
            cid,
            "Live workspace_panes includes ws-eval-status",
            ["http/deploy_capabilities_pane.json"],
        )

    return _fail(
        cid,
        "DEPLOY_ROUTE_MISMATCH",
        "Live workspace_panes missing ws-eval-status",
        ["http/deploy_capabilities_pane.json"],
    )
