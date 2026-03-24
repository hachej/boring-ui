"""Extensible profile checks for pane/tool integration (Phase X.I)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from tests.eval.check_catalog import CATALOG
from tests.eval.contracts import CheckResult, RunManifest
from tests.eval.reason_codes import Attribution, CheckStatus


class PaneToolIntegrationContext:
    """Shared state for pane/tool integration checks."""

    def __init__(self, manifest: RunManifest) -> None:
        self.manifest = manifest
        self.project_root = Path(manifest.project_root)
        self.pane_path = self.project_root / "kurt" / "panels" / "eval-status" / "Panel.jsx"
        self.router_path = (
            self.project_root
            / "src"
            / manifest.python_module
            / "routers"
            / "eval_tool.py"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_pane_tool_integration_checks(ctx: PaneToolIntegrationContext) -> list[CheckResult]:
    return [
        _check_pane_calls_tool(ctx),
        _check_tool_contract_matches(ctx),
        _check_both_share_nonce(ctx),
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


def _read(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def _check_pane_calls_tool(ctx: PaneToolIntegrationContext) -> CheckResult:
    cid = "integ.pane_calls_tool"
    pane_source = _read(ctx.pane_path)
    if pane_source is None:
        return _skip(cid, "Pane file missing", blocked_by=["pane.file_exists", "tool.router_file_exists"])

    if "/api/x/eval_tool/compute" in pane_source or "eval_tool/compute" in pane_source:
        return _pass(
            cid,
            "Pane source calls the eval_tool endpoint",
            evidence_refs=["static_analysis/pane_backend_call.json"],
        )

    return _fail(cid, "LOCAL_ROUTE_MISSING", "Pane does not call /api/x/eval_tool/compute")


def _check_tool_contract_matches(ctx: PaneToolIntegrationContext) -> CheckResult:
    cid = "integ.tool_contract_matches"
    pane_source = _read(ctx.pane_path)
    if pane_source is None:
        return _skip(cid, "Pane file missing", blocked_by=["integ.pane_calls_tool"])

    router_source = _read(ctx.router_path)
    if router_source is None:
        return _skip(cid, "Tool router missing", blocked_by=["tool.router_file_exists"])

    pane_uses_expected_keys = all(
        token in pane_source for token in ("result", "eval_id", "verification_nonce")
    )
    router_emits_expected_keys = all(
        token in router_source for token in ("result", "eval_id", "verification_nonce")
    )

    if pane_uses_expected_keys and router_emits_expected_keys:
        return _pass(cid, "Pane expectations align with eval_tool response contract")

    return _fail(
        cid,
        "LOCAL_ROUTE_MISMATCH",
        "Pane response expectations do not align with eval_tool router contract",
    )


def _check_both_share_nonce(ctx: PaneToolIntegrationContext) -> CheckResult:
    cid = "integ.both_share_nonce"
    pane_source = _read(ctx.pane_path)
    if pane_source is None:
        return _skip(cid, "Pane file missing", blocked_by=["pane.file_exists"])

    router_source = _read(ctx.router_path)
    if router_source is None:
        return _skip(cid, "Tool router missing", blocked_by=["tool.router_file_exists"])

    pane_has_nonce = "verification_nonce" in pane_source
    router_has_nonce = "verification_nonce" in router_source

    if pane_has_nonce and router_has_nonce:
        return _pass(cid, "Pane and tool router both reference verification_nonce")

    missing: list[str] = []
    if not pane_has_nonce:
        missing.append("pane")
    if not router_has_nonce:
        missing.append("router")
    return _fail(cid, "LOCAL_NONCE_MISMATCH", f"verification_nonce missing in: {', '.join(missing)}")
