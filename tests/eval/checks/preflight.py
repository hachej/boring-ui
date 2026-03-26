"""Preflight / Harness Validation checks (Phase 0).

Verifies the environment can run a valid eval before the agent launches.
All checks are unscored (weight=0). Failure produces INVALID, not FAIL.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from tests.eval.check_catalog import CATALOG
from tests.eval.contracts import CheckResult, RunManifest
from tests.eval.reason_codes import Attribution, CheckStatus


# ---------------------------------------------------------------------------
# Check context
# ---------------------------------------------------------------------------

class PreflightContext:
    """Shared state for preflight checks."""

    def __init__(self, manifest: RunManifest) -> None:
        self.manifest = manifest
        self.projects_root = Path(manifest.project_root).parent
        self.app_vault_data_path = f"secret/data/agent/app/{manifest.app_slug}/prod"


def run_preflight_checks(manifest: RunManifest) -> list[CheckResult]:
    """Run all 13 preflight checks."""
    ctx = PreflightContext(manifest)
    return [
        _check_bui_available(ctx),
        _check_fly_available(ctx),
        _check_vault_read_access(ctx),
        _check_vault_write_access(ctx),
        _check_network_reachable(ctx),
        _check_project_root_writable(ctx),
        _check_smoke_lib_imports(ctx),
        _check_timeouts_configured(ctx),
        _check_fresh_target_unused(ctx),
        _check_scope_guard_available(ctx),
        _check_provider_api_access(ctx),
        _check_provider_quota_headroom(ctx),
        _check_cleanup_permissions(ctx),
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _spec(check_id: str) -> dict[str, Any]:
    s = CATALOG[check_id]
    return {"id": check_id, "category": s.category, "weight": s.weight}


def _pass(check_id: str, detail: str = "") -> CheckResult:
    return CheckResult(**_spec(check_id), status=CheckStatus.PASS, detail=detail)


def _invalid(check_id: str, reason_code: str, detail: str = "") -> CheckResult:
    """Preflight failures produce INVALID, not FAIL."""
    return CheckResult(
        **_spec(check_id),
        status=CheckStatus.INVALID,
        reason_code=reason_code,
        attribution=Attribution.HARNESS,
        detail=detail,
    )


def _run_cmd(cmd: list[str], timeout: int = 10) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except FileNotFoundError:
        return -1, "", f"not found: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return -2, "", f"timeout: {' '.join(cmd)}"


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def _check_bui_available(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.bui_available"
    if shutil.which("bui"):
        rc, out, _ = _run_cmd(["bui", "version"])
        if rc == 0:
            return _pass(cid, f"bui version: {out[:40]}")
        return _pass(cid, "bui found on PATH")
    return _invalid(cid, "ENV_BUI_MISSING", "bui CLI not found on PATH")


def _check_fly_available(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.fly_available"
    fly = shutil.which("fly") or shutil.which("flyctl")
    if not fly:
        return _invalid(cid, "ENV_FLY_AUTH", "fly/flyctl CLI not found")
    if os.environ.get("FLY_API_TOKEN"):
        return _pass(cid, "Fly CLI + FLY_API_TOKEN set")
    rc, _, _ = _run_cmd([fly, "auth", "whoami"])
    if rc == 0:
        return _pass(cid, "Fly CLI + authenticated")
    return _invalid(cid, "ENV_FLY_AUTH", "Fly CLI found but not authenticated")


def _check_vault_read_access(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.vault_read_access"
    if not shutil.which("vault"):
        return _invalid(cid, "ENV_VAULT_READ_DENIED", "vault CLI not found")
    rc, out, _ = _run_cmd(["vault", "kv", "get", "-field=api_key", "secret/agent/anthropic"])
    if rc == 0 and out:
        return _pass(cid, "Vault read: secret/agent/anthropic accessible")
    return _invalid(cid, "ENV_VAULT_READ_DENIED", "Cannot read secret/agent/anthropic")


def _check_vault_write_access(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.vault_write_access"
    if not shutil.which("vault"):
        return _invalid(cid, "ENV_VAULT_WRITE_DENIED", "vault CLI not found")
    rc, out, err = _run_cmd(["vault", "token", "capabilities", ctx.app_vault_data_path])
    if rc != 0:
        detail = (
            f"Cannot inspect token capabilities for {ctx.app_vault_data_path}: "
            f"{err or out or 'unknown error'}"
        )
        return _invalid(cid, "ENV_VAULT_WRITE_DENIED", detail)

    capabilities = {
        token.strip().lower()
        for token in out.replace(",", " ").split()
        if token.strip()
    }
    if {"create", "update", "patch", "sudo", "root"} & capabilities:
        return _pass(cid, f"Vault write available at {ctx.app_vault_data_path}")

    return _invalid(
        cid,
        "ENV_VAULT_WRITE_DENIED",
        f"No app-scoped Vault write access at {ctx.app_vault_data_path} (capabilities: {sorted(capabilities)})",
    )


def _check_network_reachable(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.network_reachable"
    # Quick DNS check
    rc, _, _ = _run_cmd(["python3", "-c", "import socket; socket.getaddrinfo('fly.io', 443)"])
    if rc == 0:
        return _pass(cid, "Network: fly.io DNS resolves")
    return _invalid(cid, "ENV_PROVIDER_OUTAGE", "Cannot resolve fly.io DNS")


def _check_project_root_writable(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.project_root_writable"
    if ctx.projects_root.is_dir() and os.access(str(ctx.projects_root), os.W_OK):
        return _pass(cid, f"Writable: {ctx.projects_root}")
    return _invalid(cid, "ENV_DEPENDENCY_MISSING", f"Not writable: {ctx.projects_root}")


def _check_smoke_lib_imports(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.smoke_lib_imports"
    try:
        from tests.eval import contracts, check_catalog, reason_codes  # noqa: F401
        return _pass(cid, "Eval harness modules import successfully")
    except ImportError as e:
        return _invalid(cid, "ENV_DEPENDENCY_MISSING", f"Import error: {e}")


def _check_timeouts_configured(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.timeouts_configured"
    timeouts = ctx.manifest.timeouts
    if not timeouts:
        return _invalid(cid, "HARNESS_CONFIG_ERROR", "No timeouts configured")
    if all(v > 0 for v in timeouts.values()):
        return _pass(cid, f"Timeouts: {timeouts}")
    return _invalid(cid, "HARNESS_CONFIG_ERROR", f"Invalid timeouts: {timeouts}")


def _check_fresh_target_unused(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.fresh_target_unused"
    project_path = Path(ctx.manifest.project_root)
    if project_path.exists():
        return _invalid(
            cid, "ENV_DEPENDENCY_MISSING",
            f"Target already exists: {project_path}",
        )
    return _pass(cid, f"Fresh target: {project_path}")


def _check_scope_guard_available(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.scope_guard_available"
    # Scope guard is optional — bubblewrap, namespace, or worktree isolation
    if shutil.which("bwrap"):
        return _pass(cid, "bubblewrap available")
    if shutil.which("unshare"):
        return _pass(cid, "unshare available")
    return _pass(cid, "No scope guard available (optional)")


def _check_provider_api_access(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.provider_api_access"
    # Quick check that provider APIs are reachable
    issues: list[str] = []
    if shutil.which("fly") or shutil.which("flyctl"):
        fly = shutil.which("fly") or shutil.which("flyctl")
        rc, _, _ = _run_cmd([fly, "apps", "list", "--json"])  # type: ignore
        if rc != 0:
            issues.append("Fly API not accessible")
    else:
        issues.append("Fly CLI not available")

    if issues:
        return _invalid(cid, "ENV_PROVIDER_OUTAGE", "; ".join(issues))
    return _pass(cid, "Provider APIs accessible")


def _check_provider_quota_headroom(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.provider_quota_headroom"
    # Lightweight check — actual quota verification is expensive
    return _pass(cid, "Quota headroom check: advisory (not verified)")


def _check_cleanup_permissions(ctx: PreflightContext) -> CheckResult:
    cid = "preflight.cleanup_permissions"
    # Verify harness can list and delete resources it creates
    # In practice, this means Fly delete access and Neon delete access
    if os.environ.get("FLY_API_TOKEN"):
        return _pass(cid, "FLY_API_TOKEN set — cleanup should work")
    return _invalid(
        cid, "ENV_FLY_AUTH",
        "No FLY_API_TOKEN — cleanup may fail",
    )
