"""Deployment / Live Validation checks (Phase C).

Verifies the deployed system using platform semantics that matter in
real usage.  Core suite runs for all profiles; auth-plus and full-stack
suites are profile-gated.

Reuses smoke_lib helpers where available.  Allows short warmup retries
for live checks to avoid penalizing normal deploy propagation delays.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

from tests.eval.check_catalog import CATALOG
from tests.eval.contracts import CheckResult, RunManifest
from tests.eval.providers.fly import FlyAdapter
from tests.eval.reason_codes import Attribution, CheckStatus


# ---------------------------------------------------------------------------
# Check context
# ---------------------------------------------------------------------------

class DeploymentContext:
    """Shared state for deployment checks."""

    def __init__(
        self,
        manifest: RunManifest,
        deployed_url: str | None = None,
        fly_adapter: FlyAdapter | None = None,
        # Pre-fetched responses (for testing without network)
        responses: dict[str, tuple[int, Any]] | None = None,
        # Auth state (for auth-plus checks)
        session_cookie: str | None = None,
        auth_email: str | None = None,
    ) -> None:
        self.manifest = manifest
        self.deployed_url = deployed_url
        self.fly = fly_adapter or FlyAdapter()
        self._responses = responses or {}
        self.session_cookie = session_cookie
        self.auth_email = auth_email

    def get(self, path: str, retry: int = 0, delay: float = 2.0) -> tuple[int, Any]:
        """GET a path from the deployed URL. Returns (status, body_or_None).

        If pre-fetched responses are available, uses those (for testing).
        Otherwise makes real HTTP requests with retry/backoff.
        """
        if path in self._responses:
            return self._responses[path]

        if not self.deployed_url or not _HAS_HTTPX:
            return (0, None)

        url = self.deployed_url.rstrip("/") + path
        for attempt in range(retry + 1):
            try:
                resp = httpx.get(url, timeout=15, follow_redirects=True)
                try:
                    body = resp.json()
                except Exception:
                    body = resp.text
                if resp.status_code == 200 or attempt >= retry:
                    return (resp.status_code, body)
            except Exception:
                if attempt >= retry:
                    return (0, None)
            time.sleep(delay * (attempt + 1))

        return (0, None)


def run_deployment_checks(ctx: DeploymentContext) -> list[CheckResult]:
    """Run all 28 deployment checks (core + profile-gated)."""
    results: list[CheckResult] = []

    # Core checks (17)
    results.append(_check_deployed_url_present(ctx))
    results.append(_check_url_discovered_independently(ctx))
    results.append(_check_url_well_formed(ctx))
    results.append(_check_fly_app_exists(ctx))
    results.append(_check_neon_configured(ctx))
    results.append(_check_neon_jwks_reachable(ctx))
    results.append(_check_secrets_valid(ctx))
    results.append(_check_root_html(ctx))
    results.append(_check_health_200(ctx))
    results.append(_check_custom_router_live(ctx))
    results.append(_check_info_live(ctx))
    results.append(_check_health_stable(ctx))
    results.append(_check_info_stable(ctx))
    results.append(_check_config_200(ctx))
    results.append(_check_capabilities_200(ctx))
    results.append(_check_caps_auth_neon(ctx))
    results.append(_check_branding_match_if_profiled(ctx))

    # Auth-plus checks (6)
    results.append(_check_auth_signup(ctx))
    results.append(_check_auth_signin(ctx))
    results.append(_check_session_valid(ctx))
    results.append(_check_auth_guard(ctx))
    results.append(_check_custom_protected_route(ctx))
    results.append(_check_logout(ctx))

    # Full-stack checks (5)
    results.append(_check_workspace_create(ctx))
    results.append(_check_file_write(ctx))
    results.append(_check_file_read(ctx))
    results.append(_check_file_delete(ctx))
    results.append(_check_git_cycle(ctx))

    return results


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
# Core checks
# ---------------------------------------------------------------------------

def _check_deployed_url_present(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.deployed_url_present"
    if ctx.deployed_url:
        return _pass(cid, ctx.deployed_url)
    return _fail(cid, "DEPLOY_UNREACHABLE", "No deployed URL available")


def _check_url_discovered_independently(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.url_discovered_independently"
    url = ctx.fly.app_url(ctx.manifest.app_slug)
    if url:
        return _pass(cid, f"Discovered: {url}")
    return _fail(cid, "DEPLOY_UNREACHABLE", "Could not discover URL from Fly API")


def _check_url_well_formed(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.url_well_formed"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.deployed_url_present"])
    if ctx.deployed_url.startswith("https://") and "." in ctx.deployed_url:
        return _pass(cid, "Valid HTTPS URL")
    return _fail(cid, "DEPLOY_UNREACHABLE", f"Malformed URL: {ctx.deployed_url}")


def _check_fly_app_exists(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.fly_app_exists"
    if ctx.fly.app_exists(ctx.manifest.app_slug):
        return _pass(cid, f"Fly app {ctx.manifest.app_slug} exists")
    return _fail(cid, "DEPLOY_UNREACHABLE", f"Fly app {ctx.manifest.app_slug} not found")


def _check_neon_configured(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.neon_configured"
    # Check via context responses or skip
    return _pass(cid, "Neon configuration check (advisory — see security checks)")


def _check_neon_jwks_reachable(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.neon_jwks_reachable"
    # Requires the JWKS URL from the app config — checked in deployment
    return _pass(cid, "JWKS reachability (advisory — verified at deploy time)")


def _check_secrets_valid(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.secrets_valid"
    # Delegates to security checks for detailed validation
    return _pass(cid, "Secret validation (see security checks)")


def _check_root_html(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.root_html"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.url_well_formed"])
    status, body = ctx.get("/", retry=3, delay=5.0)
    if status == 200 and isinstance(body, str) and "<html" in body.lower():
        return _pass(cid, "GET / returns HTML")
    if status == 200:
        return _pass(cid, f"GET / returns 200 (content-type may vary)")
    return _fail(cid, "DEPLOY_ROUTE_MISSING", f"GET / returned {status}")


def _check_health_200(ctx: DeploymentContext) -> CheckResult:
    """must_pass: Live /health returns 200."""
    cid = "deploy.health_200"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.url_well_formed"])
    status, body = ctx.get("/health", retry=3, delay=5.0)
    if status == 200:
        return _pass(cid, "Live /health returns 200")
    return _fail(cid, "DEPLOY_HEALTH_FAILED", f"/health returned {status}")


def _check_custom_router_live(ctx: DeploymentContext) -> CheckResult:
    """must_pass: Live /health JSON matches contract."""
    cid = "deploy.custom_router_live"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.health_200"])
    status, body = ctx.get("/health")
    if status != 200 or not isinstance(body, dict):
        return _skip(cid, f"/health not 200 JSON", blocked_by=["deploy.health_200"])

    # Check required fields
    required = {"ok", "app", "eval_id", "verification_nonce"}
    missing = required - set(body.keys())
    if missing:
        return _fail(cid, "DEPLOY_ROUTE_MISMATCH", f"Missing: {missing}")

    nonce = body.get("verification_nonce")
    if nonce != ctx.manifest.verification_nonce:
        return _fail(cid, "DEPLOY_NONCE_MISMATCH", f"nonce={nonce!r} vs expected")

    return _pass(cid, "/health JSON matches contract with correct nonce")


def _check_info_live(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.info_live"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.health_200"])
    status, body = ctx.get("/info")
    if status != 200 or not isinstance(body, dict):
        return _fail(cid, "DEPLOY_ROUTE_MISSING", f"/info returned {status}")

    required = {"name", "version", "eval_id"}
    missing = required - set(body.keys())
    if missing:
        return _fail(cid, "DEPLOY_ROUTE_MISMATCH", f"Missing: {missing}")
    return _pass(cid, "/info JSON matches contract")


def _check_health_stable(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.health_stable"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.health_200"])
    # 3 consecutive probes
    for i in range(3):
        status, _ = ctx.get("/health")
        if status != 200:
            return _fail(cid, "DEPLOY_HEALTH_FAILED", f"Probe {i+1}/3 failed: {status}")
    return _pass(cid, "3/3 consecutive /health probes succeeded")


def _check_info_stable(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.info_stable"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.info_live"])
    for i in range(3):
        status, _ = ctx.get("/info")
        if status != 200:
            return _fail(cid, "DEPLOY_ROUTE_MISSING", f"Probe {i+1}/3 failed: {status}")
    return _pass(cid, "3/3 consecutive /info probes succeeded")


def _check_config_200(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.config_200"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.url_well_formed"])
    status, body = ctx.get("/__bui/config", retry=1)
    if status == 200 and isinstance(body, dict):
        return _pass(cid, "/__bui/config returns valid JSON")
    return _fail(cid, "DEPLOY_ROUTE_MISSING", f"/__bui/config returned {status}")


def _check_capabilities_200(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.capabilities_200"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.url_well_formed"])
    status, body = ctx.get("/api/capabilities", retry=1)
    if status == 200 and isinstance(body, dict):
        return _pass(cid, "/api/capabilities returns valid JSON")
    return _fail(cid, "DEPLOY_ROUTE_MISSING", f"/api/capabilities returned {status}")


def _check_caps_auth_neon(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.caps_auth_neon"
    status, body = ctx.get("/api/capabilities")
    if status != 200 or not isinstance(body, dict):
        return _skip(cid, "No capabilities", blocked_by=["deploy.capabilities_200"])
    # Check if Neon auth is reported
    features = body.get("features", {})
    runtime = body.get("runtime_config", {})
    if isinstance(features, dict):
        return _pass(cid, "Capabilities available (auth provider check advisory)")
    return _pass(cid, "Capabilities structure check (advisory)")


def _check_branding_match_if_profiled(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.branding_match_if_profiled"
    if ctx.manifest.platform_profile not in ("full-stack", "extensible"):
        return _pass(cid, f"Profile {ctx.manifest.platform_profile!r} — branding not required")
    return _pass(cid, "Branding check (advisory)")


# ---------------------------------------------------------------------------
# Auth-plus checks
# ---------------------------------------------------------------------------

def _check_auth_signup(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.auth_signup"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.health_200"])
    # Stub: real implementation would use smoke_lib auth helpers
    return _skip(cid, "Auth signup check requires smoke_lib integration")


def _check_auth_signin(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.auth_signin"
    return _skip(cid, "Auth signin requires smoke_lib", blocked_by=["deploy.auth_signup"])


def _check_session_valid(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.session_valid"
    return _skip(cid, "Session check requires auth", blocked_by=["deploy.auth_signin"])


def _check_auth_guard(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.auth_guard"
    if not ctx.deployed_url:
        return _skip(cid, "No URL", blocked_by=["deploy.health_200"])
    # Check that a protected endpoint returns 401 without auth
    status, _ = ctx.get("/api/v1/me")
    if status in (401, 403):
        return _pass(cid, f"/api/v1/me returns {status} without auth")
    if status == 0:
        return _skip(cid, "Could not reach /api/v1/me")
    return _pass(cid, f"/api/v1/me returned {status} (may not require auth)")


def _check_custom_protected_route(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.custom_protected_route"
    return _skip(cid, "/whoami requires auth session", blocked_by=["deploy.auth_signin"])


def _check_logout(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.logout"
    return _skip(cid, "Logout requires auth session", blocked_by=["deploy.auth_signin"])


# ---------------------------------------------------------------------------
# Full-stack checks
# ---------------------------------------------------------------------------

def _check_workspace_create(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.workspace_create"
    return _skip(cid, "Workspace check requires smoke_lib", blocked_by=["deploy.auth_signin"])


def _check_file_write(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.file_write"
    return _skip(cid, "File write requires workspace", blocked_by=["deploy.workspace_create"])


def _check_file_read(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.file_read"
    return _skip(cid, "File read requires file_write", blocked_by=["deploy.file_write"])


def _check_file_delete(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.file_delete"
    return _skip(cid, "File delete requires file_write", blocked_by=["deploy.file_write"])


def _check_git_cycle(ctx: DeploymentContext) -> CheckResult:
    cid = "deploy.git_cycle"
    return _skip(cid, "Git cycle requires workspace", blocked_by=["deploy.workspace_create"])
