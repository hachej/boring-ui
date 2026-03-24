"""Extensible profile checks for custom tool/router verification (Phase X.T)."""

from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from tests.eval.check_catalog import CATALOG
from tests.eval.contracts import CheckResult, RunManifest
from tests.eval.reason_codes import Attribution, CheckStatus

try:
    import tomllib
except ImportError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]


PROBE_INPUTS: tuple[str, ...] = ("test", "alpha", "omega")


class CustomToolContext:
    """Shared state for custom tool checks."""

    def __init__(
        self,
        manifest: RunManifest,
        *,
        local_ctx: Any | None = None,
        deployment_ctx: Any | None = None,
        command_log: list[Any] | None = None,
        agent_text: str = "",
    ) -> None:
        self.manifest = manifest
        self.local_ctx = local_ctx
        self.deployment_ctx = deployment_ctx
        self.command_log = command_log or []
        self.agent_text = agent_text
        self.project_root = Path(manifest.project_root)
        self.router_path = (
            self.project_root
            / "src"
            / manifest.python_module
            / "routers"
            / "eval_tool.py"
        )
        self._live_probe_cache: dict[str, tuple[int | None, Any]] = {}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_custom_tool_checks(ctx: CustomToolContext) -> list[CheckResult]:
    """Run all custom tool/router checks for the extensible profile."""
    return [
        _check_router_file_exists(ctx),
        _check_toml_declared(ctx),
        _check_local_200(ctx),
        _check_local_correct(ctx),
        _check_local_schema(ctx),
        _check_input_varies(ctx),
        _check_live_200(ctx),
        _check_live_correct(ctx),
        _check_live_nonce(ctx),
        _check_in_capabilities(ctx),
        _check_agent_invocation(ctx),
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


def _evidence_ref_for_local_input(input_value: str) -> str:
    idx = PROBE_INPUTS.index(input_value) + 1 if input_value in PROBE_INPUTS else 1
    return f"http/local_eval_tool_compute_{idx}.json"


def _evidence_ref_for_live_input(input_value: str) -> str:
    idx = PROBE_INPUTS.index(input_value) + 1 if input_value in PROBE_INPUTS else 1
    return f"http/deploy_eval_tool_compute_{idx}.json"


def _read_toml(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with open(path, "rb") as handle:
            return tomllib.load(handle)
    except Exception:
        return None


def _local_probe(ctx: CustomToolContext, input_value: str) -> tuple[int | None, Any]:
    if ctx.local_ctx is None:
        return (None, None)
    probes = getattr(ctx.local_ctx, "eval_tool_probes", {}) or {}
    record = probes.get(input_value)
    if not isinstance(record, dict):
        return (None, None)
    status = record.get("status")
    body = record.get("body")
    return (status if isinstance(status, int) else None, body)


def _live_probe(ctx: CustomToolContext, input_value: str) -> tuple[int | None, Any]:
    if input_value in ctx._live_probe_cache:
        return ctx._live_probe_cache[input_value]

    if not ctx.deployment_ctx or not getattr(ctx.deployment_ctx, "deployed_url", None):
        ctx._live_probe_cache[input_value] = (None, None)
        return (None, None)

    path = f"/api/x/eval_tool/compute?input={urllib.parse.quote(input_value)}"
    status, body = ctx.deployment_ctx.get(path)
    result = (status if isinstance(status, int) else None, body)
    ctx._live_probe_cache[input_value] = result
    return result


def _has_required_tool_fields(body: Any) -> tuple[bool, list[str]]:
    if not isinstance(body, dict):
        return False, ["body_not_json"]

    required = {"result", "input", "eval_id", "verification_nonce"}
    missing = [name for name in required if name not in body]
    return len(missing) == 0, missing


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def _check_router_file_exists(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.router_file_exists"
    if ctx.router_path.is_file():
        return _pass(cid, f"Found {ctx.router_path}")
    return _fail(cid, "SCAFF_ROUTE_MISSING", f"Missing {ctx.router_path}")


def _check_toml_declared(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.toml_declared"
    toml_path = ctx.project_root / "boring.app.toml"
    config = _read_toml(toml_path)
    if config is None:
        return _skip(cid, "boring.app.toml unavailable", blocked_by=["scaff.toml_valid"])

    backend = config.get("backend", {}) if isinstance(config, dict) else {}
    routers = backend.get("routers") if isinstance(backend, dict) else None
    if not isinstance(routers, list):
        return _fail(cid, "SCAFF_ROUTE_MISSING", "[backend].routers missing or not a list")

    expected_module = f"{ctx.manifest.python_module}.routers.eval_tool"
    for router in routers:
        text = str(router)
        if expected_module in text or "eval_tool" in text:
            return _pass(cid, f"Declared router entry: {text}")

    return _fail(cid, "SCAFF_ROUTE_MISSING", "eval_tool router not declared in [backend].routers")


def _check_local_200(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.local_200"
    if not ctx.local_ctx or not getattr(ctx.local_ctx, "dev_started", False):
        return _skip(cid, "Local dev did not start", blocked_by=["local.clean_room_dev_starts"])

    status, _body = _local_probe(ctx, "test")
    if status == 200:
        return _pass(cid, "Local eval_tool endpoint returned 200", [_evidence_ref_for_local_input("test")])
    return _fail(
        cid,
        "LOCAL_ROUTE_MISSING",
        f"Local /api/x/eval_tool/compute returned {status}",
        [_evidence_ref_for_local_input("test")],
    )


def _check_local_correct(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.local_correct"
    status, body = _local_probe(ctx, "test")
    if status != 200:
        return _skip(
            cid,
            "Local endpoint unavailable",
            blocked_by=["tool.local_200"],
            evidence_refs=[_evidence_ref_for_local_input("test")],
        )

    ok, missing = _has_required_tool_fields(body)
    if not ok:
        return _fail(
            cid,
            "LOCAL_RESPONSE_INVALID",
            f"Missing required fields: {missing}",
            [_evidence_ref_for_local_input("test")],
        )

    if body.get("eval_id") != ctx.manifest.eval_id:
        return _fail(cid, "LOCAL_ROUTE_MISMATCH", "eval_id does not match manifest")
    if body.get("verification_nonce") != ctx.manifest.verification_nonce:
        return _fail(cid, "LOCAL_NONCE_MISMATCH", "verification_nonce does not match manifest")
    if body.get("input") != "test":
        return _fail(cid, "LOCAL_ROUTE_MISMATCH", "response input does not match request")

    result_value = str(body.get("result", ""))
    if not result_value:
        return _fail(cid, "LOCAL_RESPONSE_INVALID", "result is empty")
    if result_value == "test":
        return _fail(cid, "LOCAL_ROUTE_MISMATCH", "result appears trivial identity transform")

    return _pass(cid, "Local response includes correct identity + nonce + non-trivial result")


def _check_local_schema(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.local_schema"
    status, body = _local_probe(ctx, "test")
    if status != 200:
        return _skip(cid, "Local endpoint unavailable", blocked_by=["tool.local_200"])

    ok, missing = _has_required_tool_fields(body)
    if not ok:
        return _fail(cid, "LOCAL_RESPONSE_INVALID", f"Missing required fields: {missing}")
    return _pass(cid, "Local response schema contains required fields")


def _check_input_varies(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.input_varies"
    if not ctx.local_ctx or not getattr(ctx.local_ctx, "dev_started", False):
        return _skip(cid, "Local dev did not start", blocked_by=["tool.local_200"])

    outputs: list[str] = []
    for input_value in PROBE_INPUTS:
        status, body = _local_probe(ctx, input_value)
        if status != 200 or not isinstance(body, dict):
            return _fail(
                cid,
                "LOCAL_RESPONSE_INVALID",
                f"Probe {input_value!r} returned status {status}",
                [_evidence_ref_for_local_input(input_value)],
            )
        outputs.append(str(body.get("result", "")))

    if len(set(outputs)) < 2:
        return _fail(cid, "LOCAL_ROUTE_MISMATCH", "Different inputs produced identical outputs")

    return _pass(cid, "Different inputs produce varied deterministic outputs")


def _check_live_200(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.live_200"
    status, _body = _live_probe(ctx, "test")
    if status is None:
        return _skip(
            cid,
            "No deployed URL",
            blocked_by=["deploy.health_200"],
            evidence_refs=[_evidence_ref_for_live_input("test")],
        )
    if status == 200:
        return _pass(cid, "Live eval_tool endpoint returned 200", [_evidence_ref_for_live_input("test")])
    return _fail(
        cid,
        "DEPLOY_ROUTE_MISSING",
        f"Live /api/x/eval_tool/compute returned {status}",
        [_evidence_ref_for_live_input("test")],
    )


def _check_live_correct(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.live_correct"
    status, body = _live_probe(ctx, "test")
    if status != 200:
        return _skip(
            cid,
            "Live endpoint unavailable",
            blocked_by=["tool.live_200"],
            evidence_refs=[_evidence_ref_for_live_input("test")],
        )

    ok, missing = _has_required_tool_fields(body)
    if not ok:
        return _fail(cid, "DEPLOY_RESPONSE_INVALID", f"Missing required fields: {missing}")

    if body.get("eval_id") != ctx.manifest.eval_id:
        return _fail(cid, "DEPLOY_ROUTE_MISMATCH", "eval_id does not match manifest")
    if body.get("verification_nonce") != ctx.manifest.verification_nonce:
        return _fail(cid, "DEPLOY_NONCE_MISMATCH", "verification_nonce does not match manifest")
    if body.get("input") != "test":
        return _fail(cid, "DEPLOY_ROUTE_MISMATCH", "response input does not match request")

    return _pass(cid, "Live response includes expected identity and route contract")


def _check_live_nonce(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.live_nonce"
    status, body = _live_probe(ctx, "test")
    if status != 200:
        return _skip(cid, "Live endpoint unavailable", blocked_by=["tool.live_200"])

    if isinstance(body, dict) and body.get("verification_nonce") == ctx.manifest.verification_nonce:
        return _pass(cid, "Live response includes correct verification_nonce")
    return _fail(cid, "DEPLOY_NONCE_MISMATCH", "Live response missing/mismatched verification_nonce")


def _check_in_capabilities(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.in_capabilities"
    if not ctx.deployment_ctx or not getattr(ctx.deployment_ctx, "deployed_url", None):
        return _skip(
            cid,
            "No deployed URL",
            blocked_by=["deploy.capabilities_200"],
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

    routers = body.get("routers")
    features = body.get("features")

    if isinstance(features, dict):
        for key, enabled in features.items():
            if "eval_tool" in str(key) and bool(enabled):
                return _pass(cid, f"Feature {key!r} advertises eval_tool", ["http/deploy_capabilities_pane.json"])

    if isinstance(routers, list):
        for router in routers:
            if isinstance(router, dict):
                name = str(router.get("name") or "")
                prefix = str(router.get("prefix") or "")
                if "eval_tool" in name or "/api/x/eval_tool" in prefix:
                    return _pass(cid, "Router list includes eval_tool", ["http/deploy_capabilities_pane.json"])

    return _fail(
        cid,
        "DEPLOY_ROUTE_MISMATCH",
        "Capabilities do not advertise eval_tool router/feature",
        ["http/deploy_capabilities_pane.json"],
    )


def _check_agent_invocation(ctx: CustomToolContext) -> CheckResult:
    cid = "tool.agent_invocation"
    command_text = "\n".join(str(getattr(cmd, "command", "")) for cmd in ctx.command_log)
    transcript = f"{command_text}\n{ctx.agent_text}"

    if re.search(r"/api/x/eval_tool/compute", transcript):
        return _pass(cid, "Agent transcript shows eval_tool endpoint invocation")

    if "eval_tool" in transcript and "compute" in transcript:
        return _pass(cid, "Agent transcript references eval_tool compute operation")

    return _skip(cid, "No explicit eval_tool invocation observed in transcript")
