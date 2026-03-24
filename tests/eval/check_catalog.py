"""Central registry of every check in the child app E2E eval.

Each entry defines: id, category, weight, profile applicability,
prerequisites, must_pass flag, core_required vs extension, and retry policy.
The orchestrator and scoring engine consume this catalog.

Anti-Brittleness Rules (apply to all check implementations):
    1. Prefer semantic success over exact file layout (extra JSON fields OK).
    2. Do not require .env to exist.
    3. Do not overfit to one config encoding.
    4. Use strictness where it matters most (secrets, scope, routes, deploy).
    5. Normalize platform variants into typed descriptors before checking.

Category Weights and Gates:
    Scaffolding / Build correctness   10%  gate 75%
    Workflow compliance               10%  gate 70%
    Local dev / Runtime validation    15%  gate 70%
    Deployment / Live validation      30%  gate 65%
    Security / Scope hygiene          25%  gate 80%
    Report quality / Observability    10%  gate 70%
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Category gates (score threshold 0.0–1.0)
# ---------------------------------------------------------------------------

CATEGORY_GATES: dict[str, float] = {
    "preflight": 0.0,        # unscored, required
    "scaffolding": 0.75,
    "workflow": 0.70,
    "local_dev": 0.70,
    "deployment": 0.65,
    "security": 0.80,
    "report_quality": 0.70,
    # Extensible profile categories
    "custom_pane": 0.70,
    "custom_tool": 0.70,
    "pane_tool_integration": 0.65,
}

CATEGORY_WEIGHTS: dict[str, float] = {
    "preflight": 0.0,
    "scaffolding": 0.10,
    "workflow": 0.10,
    "local_dev": 0.15,
    "deployment": 0.30,
    "security": 0.25,
    "report_quality": 0.10,
    # Extensible profile categories (0 in base; scoring.py applies profile weights)
    "custom_pane": 0.0,
    "custom_tool": 0.0,
    "pane_tool_integration": 0.0,
}

# Extensible profile redistributes weights: base categories scaled to 80%,
# extensible categories get the remaining 20%.
EXTENSIBLE_CATEGORY_WEIGHTS: dict[str, float] = {
    "preflight": 0.0,
    "scaffolding": 0.08,
    "workflow": 0.08,
    "local_dev": 0.12,
    "deployment": 0.24,
    "security": 0.20,
    "report_quality": 0.08,
    "custom_pane": 0.08,
    "custom_tool": 0.08,
    "pane_tool_integration": 0.04,
}


# ---------------------------------------------------------------------------
# Retry policy
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RetryPolicy:
    """Retry policy for transient failures."""

    max_retries: int = 0
    backoff_base_s: float = 2.0

    def to_dict(self) -> dict[str, Any]:
        return {"max_retries": self.max_retries, "backoff_base_s": self.backoff_base_s}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RetryPolicy:
        return cls(
            max_retries=int(data.get("max_retries", 0)),
            backoff_base_s=float(data.get("backoff_base_s", 2.0)),
        )


NO_RETRY = RetryPolicy()
DEPLOY_RETRY = RetryPolicy(max_retries=3, backoff_base_s=5.0)
NETWORK_RETRY = RetryPolicy(max_retries=2, backoff_base_s=3.0)


# ---------------------------------------------------------------------------
# CheckSpec
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CheckSpec:
    """Specification for a single eval check."""

    id: str
    category: str                              # preflight|scaffolding|workflow|local_dev|deployment|security|report_quality
    weight: float                              # scoring weight (0 for unscored preflight)
    profile: str = "core"                      # core|auth-plus|full-stack|extensible
    prerequisites: tuple[str, ...] = ()        # check IDs that must pass first
    must_pass: bool = False                    # maps to Success Criteria
    core_required: bool = True                 # True=core_required, False=extension
    retry_policy: RetryPolicy = field(default_factory=lambda: NO_RETRY)
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "category": self.category,
            "weight": self.weight,
            "profile": self.profile,
            "prerequisites": list(self.prerequisites),
            "must_pass": self.must_pass,
            "core_required": self.core_required,
            "retry_policy": self.retry_policy.to_dict(),
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CheckSpec:
        return cls(
            id=data["id"],
            category=data["category"],
            weight=float(data["weight"]),
            profile=data.get("profile", "core"),
            prerequisites=tuple(data.get("prerequisites", ())),
            must_pass=bool(data.get("must_pass", False)),
            core_required=bool(data.get("core_required", True)),
            retry_policy=RetryPolicy.from_dict(data.get("retry_policy", {})),
            description=data.get("description", ""),
        )


# ---------------------------------------------------------------------------
# Profile hierarchy — which profiles include which
# ---------------------------------------------------------------------------

PROFILE_HIERARCHY: dict[str, frozenset[str]] = {
    "core": frozenset({"core"}),
    "auth-plus": frozenset({"core", "auth-plus"}),
    "full-stack": frozenset({"core", "auth-plus", "full-stack"}),
    "extensible": frozenset({"core", "auth-plus", "full-stack", "extensible"}),
}


def check_applicable(spec: CheckSpec, profile: str) -> bool:
    """Return True if *spec* is applicable under *profile*."""
    included = PROFILE_HIERARCHY.get(profile, frozenset({"core"}))
    return spec.profile in included


# ===================================================================
# CATALOG — every check registered at import time
# ===================================================================

CATALOG: dict[str, CheckSpec] = {}


def _reg(spec: CheckSpec) -> CheckSpec:
    """Register a CheckSpec and return it (for chaining)."""
    if spec.id in CATALOG:
        raise ValueError(f"Duplicate check ID: {spec.id}")
    CATALOG[spec.id] = spec
    return spec


# -------------------------------------------------------------------
# Phase 0: Preflight (unscored, weight=0)
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="preflight.bui_available",
    category="preflight", weight=0,
    description="bui CLI exists and is runnable",
))
_reg(CheckSpec(
    id="preflight.fly_available",
    category="preflight", weight=0,
    description="Fly CLI exists and FLY_API_TOKEN is set or fly auth whoami succeeds",
))
_reg(CheckSpec(
    id="preflight.vault_read_access",
    category="preflight", weight=0,
    description="Can read from secret/agent/anthropic (basic credential access)",
))
_reg(CheckSpec(
    id="preflight.vault_write_access",
    category="preflight", weight=0,
    description="Can write to secret/agent/app/ (required by bui neon setup)",
))
_reg(CheckSpec(
    id="preflight.network_reachable",
    category="preflight", weight=0,
    retry_policy=NETWORK_RETRY,
    description="Required network/DNS access exists",
))
_reg(CheckSpec(
    id="preflight.project_root_writable",
    category="preflight", weight=0,
    description="/home/ubuntu/projects/ is writable",
))
_reg(CheckSpec(
    id="preflight.smoke_lib_imports",
    category="preflight", weight=0,
    description="Smoke helper modules import successfully",
))
_reg(CheckSpec(
    id="preflight.timeouts_configured",
    category="preflight", weight=0,
    description="Harness timeout/retry settings are sane",
))
_reg(CheckSpec(
    id="preflight.fresh_target_unused",
    category="preflight", weight=0,
    description="Generated project path and provider resource names do not already exist",
))
_reg(CheckSpec(
    id="preflight.scope_guard_available",
    category="preflight", weight=0,
    description="Sandbox / read-only mount / worktree isolation is available if enabled",
))
_reg(CheckSpec(
    id="preflight.provider_api_access",
    category="preflight", weight=0,
    retry_policy=NETWORK_RETRY,
    description="Fly / Neon / Vault APIs can be called with current credentials",
))
_reg(CheckSpec(
    id="preflight.provider_quota_headroom",
    category="preflight", weight=0,
    description="Provider quotas/headroom appear sufficient for one more eval run",
))
_reg(CheckSpec(
    id="preflight.cleanup_permissions",
    category="preflight", weight=0,
    description="Harness can enumerate and delete tagged resources it creates",
))

# -------------------------------------------------------------------
# Phase A: Scaffolding / Build Correctness
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="scaff.dir_exists",
    category="scaffolding", weight=3,
    description="Project directory exists at the expected path",
))
_reg(CheckSpec(
    id="scaff.toml_exists",
    category="scaffolding", weight=3,
    prerequisites=("scaff.dir_exists",),
    description="boring.app.toml exists",
))
_reg(CheckSpec(
    id="scaff.toml_valid",
    category="scaffolding", weight=3,
    prerequisites=("scaff.toml_exists",),
    description="TOML parses successfully",
))
_reg(CheckSpec(
    id="scaff.name_matches",
    category="scaffolding", weight=2,
    prerequisites=("scaff.toml_valid",),
    description="[app].name and/or equivalent config match the naming contract",
))
_reg(CheckSpec(
    id="scaff.id_matches",
    category="scaffolding", weight=2,
    prerequisites=("scaff.toml_valid",),
    description="[app].id or equivalent app identifier matches when applicable",
))
_reg(CheckSpec(
    id="scaff.pyproject_valid",
    category="scaffolding", weight=2,
    prerequisites=("scaff.dir_exists",),
    description="pyproject.toml parses successfully",
))
_reg(CheckSpec(
    id="scaff.backend_entry_exists",
    category="scaffolding", weight=3,
    prerequisites=("scaff.toml_valid",),
    description="Backend entry resolves to a real file/module",
))
_reg(CheckSpec(
    id="scaff.app_factory_or_entrypoint",
    category="scaffolding", weight=2,
    prerequisites=("scaff.backend_entry_exists",),
    description="Backend factory/entrypoint exists (create_app or equivalent)",
))
_reg(CheckSpec(
    id="scaff.routers_dir_or_equivalent",
    category="scaffolding", weight=1,
    prerequisites=("scaff.dir_exists",),
    description="Routing location exists or equivalent structure is present",
))
_reg(CheckSpec(
    id="scaff.custom_router_impl",
    category="scaffolding", weight=4,
    must_pass=True,
    prerequisites=("scaff.routers_dir_or_equivalent",),
    description="must_pass: Required /health and /info routes are implemented",
))
_reg(CheckSpec(
    id="scaff.custom_router_mounted",
    category="scaffolding", weight=3,
    prerequisites=("scaff.custom_router_impl",),
    description="Routes are wired into the app via TOML or Python",
))
_reg(CheckSpec(
    id="scaff.frontend_present_if_profiled",
    category="scaffolding", weight=1,
    description="Only applicable when the profile explicitly requires a frontend artifact",
))
_reg(CheckSpec(
    id="scaff.deploy_platform_fly",
    category="scaffolding", weight=2,
    prerequisites=("scaff.toml_valid",),
    description="Deployment target is set to Fly",
))

# -------------------------------------------------------------------
# Phase W: Workflow Compliance
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="workflow.scaffold_supported",
    category="workflow", weight=4,
    description="Scaffold performed via a supported bui flow or repo-declared equivalent",
))
_reg(CheckSpec(
    id="workflow.doctor_supported",
    category="workflow", weight=3,
    prerequisites=("workflow.scaffold_supported",),
    description="bui doctor executed and exited with an observed result",
))
_reg(CheckSpec(
    id="workflow.neon_supported",
    category="workflow", weight=3,
    prerequisites=("workflow.scaffold_supported",),
    description="bui neon setup executed when required by the profile contract",
))
_reg(CheckSpec(
    id="workflow.deploy_supported",
    category="workflow", weight=3,
    prerequisites=("workflow.scaffold_supported",),
    description="bui deploy executed when deploy is required",
))
_reg(CheckSpec(
    id="workflow.no_unsupported_bypass",
    category="workflow", weight=2,
    description="No unsupported manual/provider-specific bypass is used for core-required steps",
))

# -------------------------------------------------------------------
# Phase B: Local Dev / Runtime Validation
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="local.doctor_exit_0",
    category="local_dev", weight=4,
    description="bui doctor exits 0",
))
_reg(CheckSpec(
    id="local.doctor_no_errors",
    category="local_dev", weight=2,
    prerequisites=("local.doctor_exit_0",),
    description="No ERROR lines in doctor output",
))
_reg(CheckSpec(
    id="local.clean_room_dev_starts",
    category="local_dev", weight=4,
    must_pass=True,
    retry_policy=RetryPolicy(max_retries=1, backoff_base_s=5.0),
    description="must_pass: Harness relaunches bui dev --backend-only from clean-room and it starts",
))
_reg(CheckSpec(
    id="local.no_agent_process_dependency",
    category="local_dev", weight=2,
    prerequisites=("local.clean_room_dev_starts",),
    description="Local validation still passes after agent-owned background processes are terminated",
))
_reg(CheckSpec(
    id="local.port_assigned",
    category="local_dev", weight=1,
    prerequisites=("local.clean_room_dev_starts",),
    description="Local dev used an ephemeral/known-safe port without collision",
))
_reg(CheckSpec(
    id="local.custom_health",
    category="local_dev", weight=4,
    must_pass=True,
    prerequisites=("local.clean_room_dev_starts",),
    description="must_pass: Local /health returns valid JSON with required fields matching manifest",
))
_reg(CheckSpec(
    id="local.custom_info",
    category="local_dev", weight=3,
    prerequisites=("local.clean_room_dev_starts",),
    description="Local /info returns valid JSON with required fields matching manifest",
))
_reg(CheckSpec(
    id="local.config_200",
    category="local_dev", weight=2,
    prerequisites=("local.clean_room_dev_starts",),
    description="/__bui/config returns valid JSON (runtime config from boring.app.toml)",
))
_reg(CheckSpec(
    id="local.capabilities_200",
    category="local_dev", weight=2,
    prerequisites=("local.clean_room_dev_starts",),
    description="/api/capabilities returns valid JSON",
))
_reg(CheckSpec(
    id="local.capabilities_shape",
    category="local_dev", weight=2,
    prerequisites=("local.capabilities_200",),
    description="Capabilities payload has expected structure",
))
_reg(CheckSpec(
    id="local.no_startup_import_errors",
    category="local_dev", weight=2,
    prerequisites=("local.clean_room_dev_starts",),
    description="No import errors or missing-module tracebacks during startup",
))
_reg(CheckSpec(
    id="local.clean_shutdown",
    category="local_dev", weight=2,
    prerequisites=("local.clean_room_dev_starts",),
    description="Dev server exits cleanly on termination",
))
_reg(CheckSpec(
    id="local.no_tracebacks",
    category="local_dev", weight=2,
    prerequisites=("local.clean_room_dev_starts",),
    description="No Python tracebacks or fatal stderr errors during run",
))

# -------------------------------------------------------------------
# Phase C: Deployment / Live Validation — core
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="deploy.deployed_url_present",
    category="deployment", weight=2,
    description="A deployed URL was reported or independently discovered",
))
_reg(CheckSpec(
    id="deploy.url_discovered_independently",
    category="deployment", weight=1,
    description="Harness could derive the deployed URL from provider state/logs",
))
_reg(CheckSpec(
    id="deploy.url_well_formed",
    category="deployment", weight=1,
    prerequisites=("deploy.deployed_url_present",),
    description="Deployed URL parses as a valid URL",
))
_reg(CheckSpec(
    id="deploy.fly_app_exists",
    category="deployment", weight=4,
    retry_policy=DEPLOY_RETRY,
    description="Fly lists the deployed app",
))
_reg(CheckSpec(
    id="deploy.neon_configured",
    category="deployment", weight=2,
    description="Neon config is present in app config or equivalent generated state",
))
_reg(CheckSpec(
    id="deploy.neon_jwks_reachable",
    category="deployment", weight=2,
    retry_policy=NETWORK_RETRY,
    description="JWKS/auth endpoint is reachable",
))
_reg(CheckSpec(
    id="deploy.secrets_valid",
    category="deployment", weight=3,
    description="Deploy secrets use valid Vault ref structure",
))
_reg(CheckSpec(
    id="deploy.root_html",
    category="deployment", weight=2,
    prerequisites=("deploy.url_well_formed",),
    retry_policy=DEPLOY_RETRY,
    description="GET / returns HTML containing the expected app shell",
))
_reg(CheckSpec(
    id="deploy.health_200",
    category="deployment", weight=4,
    must_pass=True,
    prerequisites=("deploy.url_well_formed",),
    retry_policy=DEPLOY_RETRY,
    description="must_pass: Live /health returns 200",
))
_reg(CheckSpec(
    id="deploy.custom_router_live",
    category="deployment", weight=4,
    must_pass=True,
    prerequisites=("deploy.health_200",),
    description="must_pass: Live /health JSON matches the required contract",
))
_reg(CheckSpec(
    id="deploy.info_live",
    category="deployment", weight=3,
    prerequisites=("deploy.health_200",),
    description="Live /info JSON matches the required contract",
))
_reg(CheckSpec(
    id="deploy.health_stable",
    category="deployment", weight=3,
    prerequisites=("deploy.health_200",),
    retry_policy=DEPLOY_RETRY,
    description="/health succeeds for N consecutive probes after warmup",
))
_reg(CheckSpec(
    id="deploy.info_stable",
    category="deployment", weight=2,
    prerequisites=("deploy.info_live",),
    retry_policy=DEPLOY_RETRY,
    description="/info succeeds for N consecutive probes after warmup",
))
_reg(CheckSpec(
    id="deploy.config_200",
    category="deployment", weight=2,
    prerequisites=("deploy.url_well_formed",),
    retry_policy=DEPLOY_RETRY,
    description="GET /__bui/config returns valid JSON",
))
_reg(CheckSpec(
    id="deploy.capabilities_200",
    category="deployment", weight=2,
    prerequisites=("deploy.url_well_formed",),
    retry_policy=DEPLOY_RETRY,
    description="GET /api/capabilities returns valid JSON",
))
_reg(CheckSpec(
    id="deploy.caps_auth_neon",
    category="deployment", weight=2,
    prerequisites=("deploy.capabilities_200",),
    description="Live capabilities report Neon auth",
))
_reg(CheckSpec(
    id="deploy.branding_match_if_profiled",
    category="deployment", weight=1,
    description="Only applicable when profile explicitly includes frontend branding verification",
))

# -------------------------------------------------------------------
# Phase C: Deployment / Live Validation — auth-plus
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="deploy.auth_signup",
    category="deployment", weight=4,
    profile="auth-plus",
    prerequisites=("deploy.health_200",),
    retry_policy=DEPLOY_RETRY,
    description="Signup succeeds using smoke auth helpers",
))
_reg(CheckSpec(
    id="deploy.auth_signin",
    category="deployment", weight=4,
    profile="auth-plus",
    prerequisites=("deploy.auth_signup",),
    retry_policy=DEPLOY_RETRY,
    description="Signin succeeds and returns session cookie/token as expected",
))
_reg(CheckSpec(
    id="deploy.session_valid",
    category="deployment", weight=3,
    profile="auth-plus",
    prerequisites=("deploy.auth_signin",),
    description="Authenticated identity endpoint works",
))
_reg(CheckSpec(
    id="deploy.auth_guard",
    category="deployment", weight=2,
    profile="auth-plus",
    prerequisites=("deploy.health_200",),
    description="Unauthenticated protected endpoint returns 401/expected denial",
))
_reg(CheckSpec(
    id="deploy.custom_protected_route",
    category="deployment", weight=3,
    profile="auth-plus",
    prerequisites=("deploy.auth_signin",),
    description="Custom authenticated route (/whoami) behaves correctly",
))
_reg(CheckSpec(
    id="deploy.logout",
    category="deployment", weight=2,
    profile="auth-plus",
    prerequisites=("deploy.auth_signin",),
    description="Logout invalidates session as expected",
))

# -------------------------------------------------------------------
# Phase C: Deployment / Live Validation — full-stack
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="deploy.workspace_create",
    category="deployment", weight=3,
    profile="full-stack",
    prerequisites=("deploy.auth_signin",),
    retry_policy=DEPLOY_RETRY,
    description="Workspace creation succeeds",
))
_reg(CheckSpec(
    id="deploy.file_write",
    category="deployment", weight=2,
    profile="full-stack",
    prerequisites=("deploy.workspace_create",),
    description="File write succeeds",
))
_reg(CheckSpec(
    id="deploy.file_read",
    category="deployment", weight=2,
    profile="full-stack",
    prerequisites=("deploy.file_write",),
    description="File read-back matches expected content",
))
_reg(CheckSpec(
    id="deploy.file_delete",
    category="deployment", weight=2,
    profile="full-stack",
    prerequisites=("deploy.file_write",),
    description="File delete succeeds",
))
_reg(CheckSpec(
    id="deploy.git_cycle",
    category="deployment", weight=3,
    profile="full-stack",
    prerequisites=("deploy.workspace_create",),
    description="Init/add/commit cycle succeeds",
))

# -------------------------------------------------------------------
# Phase D: Security & Scope Hygiene
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="sec.no_secrets_in_toml",
    category="security", weight=4,
    must_pass=True,
    description="must_pass: No literal credentials in boring.app.toml",
))
_reg(CheckSpec(
    id="sec.no_secrets_in_source",
    category="security", weight=4,
    must_pass=True,
    description="must_pass: No hardcoded keys/tokens/passwords in source files",
))
_reg(CheckSpec(
    id="sec.no_secrets_in_evidence",
    category="security", weight=3,
    description="Evidence bundle and agent report do not contain raw secret values",
))
_reg(CheckSpec(
    id="sec.no_secrets_in_transcript",
    category="security", weight=4,
    description="Raw secrets do not appear in agent stdout/stderr, progress events, or final response",
))
_reg(CheckSpec(
    id="sec.no_secrets_in_git_metadata",
    category="security", weight=3,
    description="Raw secrets do not appear in staged diffs, local git metadata, or generated commit messages",
))
_reg(CheckSpec(
    id="sec.high_entropy_scan_clean",
    category="security", weight=2,
    description="No suspicious high-entropy credential-like strings in persisted artifacts after redaction",
))
_reg(CheckSpec(
    id="sec.no_tokens_in_http_captures",
    category="security", weight=3,
    description="Persisted HTTP captures omit cookies, bearer tokens, CSRF tokens, and signed URLs",
))
_reg(CheckSpec(
    id="sec.vault_refs_complete",
    category="security", weight=3,
    description="All deploy secrets use complete Vault refs (vault + field)",
))
_reg(CheckSpec(
    id="sec.session_secret_vault_ref",
    category="security", weight=4,
    description="Session secret is Vault-backed rather than literal",
))
_reg(CheckSpec(
    id="sec.env_safe_if_present",
    category="security", weight=3,
    description=".env handling is safe if the file exists",
))
_reg(CheckSpec(
    id="sec.env_not_tracked",
    category="security", weight=3,
    description=".env is not committed or staged",
))
_reg(CheckSpec(
    id="sec.gitignore_hygiene",
    category="security", weight=2,
    description=".env and .boring/ are ignored",
))
_reg(CheckSpec(
    id="sec.command_args_safe",
    category="security", weight=2,
    description="Secrets are not passed via visible command-line arguments where avoidable",
))
_reg(CheckSpec(
    id="sec.redaction_prewrite",
    category="security", weight=3,
    description="Redaction occurs before data is persisted to disk, not only in post-processing",
))
_reg(CheckSpec(
    id="sec.auth_provider_neon",
    category="security", weight=3,
    description="Deployed auth provider is Neon rather than insecure local auth",
))
_reg(CheckSpec(
    id="sec.no_forbidden_repo_changes",
    category="security", weight=4,
    description="Forbidden paths such as ../boring-ui/ are unchanged",
))
_reg(CheckSpec(
    id="sec.only_project_dir_mutated",
    category="security", weight=4,
    description="Changes are isolated to the generated child app directory",
))
_reg(CheckSpec(
    id="sec.no_symlink_escape",
    category="security", weight=3,
    description="Project tree contains no symlink/path escapes outside allowed roots",
))
_reg(CheckSpec(
    id="sec.scope_guard_enforced",
    category="security", weight=2,
    description="Runner applied the configured filesystem scope guard when supported",
))

# -------------------------------------------------------------------
# Phase E: Report Quality & Agent Behavior
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="report.human_summary_present",
    category="report_quality", weight=2,
    description="Final response includes an operator-readable summary",
))
_reg(CheckSpec(
    id="report.machine_json_present",
    category="report_quality", weight=3,
    description="JSON block with explicit markers is present",
))
_reg(CheckSpec(
    id="report.json_parseable",
    category="report_quality", weight=3,
    prerequisites=("report.machine_json_present",),
    description="Structured report parses cleanly",
))
_reg(CheckSpec(
    id="report.includes_identifiers",
    category="report_quality", weight=2,
    prerequisites=("report.json_parseable",),
    description="Includes app name, project root, deployed URL, and provider identifiers",
))
_reg(CheckSpec(
    id="report.includes_commands_run",
    category="report_quality", weight=2,
    prerequisites=("report.json_parseable",),
    description="Lists commands actually run",
))
_reg(CheckSpec(
    id="report.includes_local_results",
    category="report_quality", weight=2,
    prerequisites=("report.json_parseable",),
    description="Lists local verification outcomes",
))
_reg(CheckSpec(
    id="report.includes_live_results",
    category="report_quality", weight=2,
    prerequisites=("report.json_parseable",),
    description="Lists live verification outcomes",
))
_reg(CheckSpec(
    id="report.includes_known_issues",
    category="report_quality", weight=2,
    prerequisites=("report.json_parseable",),
    description="Explicitly lists residual issues or states none",
))
_reg(CheckSpec(
    id="report.claims_match_evidence",
    category="report_quality", weight=4,
    must_pass=True,
    prerequisites=("report.json_parseable",),
    description="must_pass: Claims are consistent with harness-observed evidence",
))
_reg(CheckSpec(
    id="report.commands_match_observed",
    category="report_quality", weight=3,
    prerequisites=("report.json_parseable",),
    description="Self-reported commands are consistent with the observed command log",
))
_reg(CheckSpec(
    id="report.scope_statement_truthful",
    category="report_quality", weight=2,
    prerequisites=("report.json_parseable",),
    description="Any scope/isolation statement is accurate",
))


# -------------------------------------------------------------------
# Phase X.P: Custom Pane Verification (extensible profile)
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="pane.file_exists",
    category="custom_pane", weight=3,
    profile="extensible",
    prerequisites=("scaff.dir_exists",),
    core_required=False,
    description="kurt/panels/eval-status/Panel.jsx exists",
))
_reg(CheckSpec(
    id="pane.default_export",
    category="custom_pane", weight=3,
    profile="extensible",
    prerequisites=("pane.file_exists",),
    core_required=False,
    description="Pane file has a default export (static analysis)",
))
_reg(CheckSpec(
    id="pane.in_capabilities",
    category="custom_pane", weight=4,
    profile="extensible",
    must_pass=True,
    prerequisites=("local.capabilities_200",),
    core_required=False,
    description="must_pass: /api/capabilities workspace_panes includes eval-status pane",
))
_reg(CheckSpec(
    id="pane.renders_eval_id",
    category="custom_pane", weight=3,
    profile="extensible",
    prerequisites=("pane.file_exists",),
    core_required=False,
    description="Component source references eval_id and verification_nonce (static check)",
))
_reg(CheckSpec(
    id="pane.calls_backend",
    category="custom_pane", weight=3,
    profile="extensible",
    prerequisites=("pane.file_exists",),
    core_required=False,
    description="Component source contains a fetch/call to the custom router endpoint",
))
_reg(CheckSpec(
    id="pane.no_import_errors",
    category="custom_pane", weight=2,
    profile="extensible",
    prerequisites=("local.clean_room_dev_starts",),
    core_required=False,
    description="Local dev server logs show no import errors for the pane module",
))
_reg(CheckSpec(
    id="pane.live_capabilities",
    category="custom_pane", weight=3,
    profile="extensible",
    prerequisites=("deploy.capabilities_200",),
    core_required=False,
    retry_policy=DEPLOY_RETRY,
    description="Live /api/capabilities includes the custom pane after deployment",
))

# -------------------------------------------------------------------
# Phase X.T: Custom Tool / Router Verification (extensible profile)
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="tool.router_file_exists",
    category="custom_tool", weight=3,
    profile="extensible",
    prerequisites=("scaff.dir_exists",),
    core_required=False,
    description="Router module file exists at the expected path",
))
_reg(CheckSpec(
    id="tool.toml_declared",
    category="custom_tool", weight=4,
    profile="extensible",
    must_pass=True,
    prerequisites=("scaff.toml_valid",),
    core_required=False,
    description="must_pass: boring.app.toml [backend].routers includes the eval_tool router",
))
_reg(CheckSpec(
    id="tool.local_200",
    category="custom_tool", weight=4,
    profile="extensible",
    must_pass=True,
    prerequisites=("local.clean_room_dev_starts",),
    core_required=False,
    description="must_pass: Local GET /api/x/eval_tool/compute?input=test returns 200",
))
_reg(CheckSpec(
    id="tool.local_correct",
    category="custom_tool", weight=4,
    profile="extensible",
    prerequisites=("tool.local_200",),
    core_required=False,
    description="Local response contains correct deterministic transformation + eval_id + nonce",
))
_reg(CheckSpec(
    id="tool.local_schema",
    category="custom_tool", weight=2,
    profile="extensible",
    prerequisites=("tool.local_200",),
    core_required=False,
    description="Local response is valid JSON with required fields (result, input, eval_id, verification_nonce)",
))
_reg(CheckSpec(
    id="tool.input_varies",
    category="custom_tool", weight=3,
    profile="extensible",
    prerequisites=("tool.local_200",),
    core_required=False,
    description="Different inputs produce different (but deterministic) outputs",
))
_reg(CheckSpec(
    id="tool.live_200",
    category="custom_tool", weight=4,
    profile="extensible",
    must_pass=True,
    prerequisites=("deploy.health_200",),
    core_required=False,
    retry_policy=DEPLOY_RETRY,
    description="must_pass: Live eval_tool endpoint returns 200",
))
_reg(CheckSpec(
    id="tool.live_correct",
    category="custom_tool", weight=4,
    profile="extensible",
    prerequisites=("tool.live_200",),
    core_required=False,
    description="Live response matches the same transformation contract",
))
_reg(CheckSpec(
    id="tool.live_nonce",
    category="custom_tool", weight=3,
    profile="extensible",
    prerequisites=("tool.live_200",),
    core_required=False,
    description="Live response includes correct verification_nonce",
))
_reg(CheckSpec(
    id="tool.in_capabilities",
    category="custom_tool", weight=2,
    profile="extensible",
    prerequisites=("local.capabilities_200",),
    core_required=False,
    description="Router appears in capabilities as an enabled router/feature",
))
_reg(CheckSpec(
    id="tool.agent_invocation",
    category="custom_tool", weight=3,
    profile="extensible",
    core_required=False,
    description="(Stretch) Agent demonstrated calling the tool during a chat session",
))

# -------------------------------------------------------------------
# Phase X.I: Pane–Tool Integration (extensible profile)
# -------------------------------------------------------------------

_reg(CheckSpec(
    id="integ.pane_calls_tool",
    category="pane_tool_integration", weight=4,
    profile="extensible",
    must_pass=True,
    prerequisites=("pane.file_exists", "tool.router_file_exists"),
    core_required=False,
    description="must_pass: Pane component source makes a request to the tool router endpoint",
))
_reg(CheckSpec(
    id="integ.tool_contract_matches",
    category="pane_tool_integration", weight=3,
    profile="extensible",
    prerequisites=("pane.file_exists", "tool.router_file_exists"),
    core_required=False,
    description="The URL and response shape the pane expects matches what the tool produces",
))
_reg(CheckSpec(
    id="integ.both_share_nonce",
    category="pane_tool_integration", weight=3,
    profile="extensible",
    prerequisites=("pane.file_exists", "tool.router_file_exists"),
    core_required=False,
    description="Both pane and router reference the same verification_nonce",
))


# ===================================================================
# Query helpers
# ===================================================================

def get_must_pass_checks() -> list[CheckSpec]:
    """Return all checks flagged as must_pass."""
    return [s for s in CATALOG.values() if s.must_pass]


def get_checks_for_profile(profile: str) -> list[CheckSpec]:
    """Return all checks applicable for *profile*."""
    return [s for s in CATALOG.values() if check_applicable(s, profile)]


def get_checks_by_category(category: str) -> list[CheckSpec]:
    """Return all checks in *category*."""
    return [s for s in CATALOG.values() if s.category == category]


def get_scored_checks() -> list[CheckSpec]:
    """Return all checks that carry a scoring weight > 0."""
    return [s for s in CATALOG.values() if s.weight > 0]


def get_prerequisites(check_id: str) -> list[CheckSpec]:
    """Return CheckSpecs that *check_id* depends on."""
    spec = CATALOG.get(check_id)
    if spec is None:
        return []
    return [CATALOG[pid] for pid in spec.prerequisites if pid in CATALOG]


def validate_catalog() -> list[str]:
    """Validate internal consistency. Returns a list of error messages (empty = OK)."""
    errors: list[str] = []
    for spec in CATALOG.values():
        # Check category is known
        if spec.category not in CATEGORY_GATES:
            errors.append(f"{spec.id}: unknown category {spec.category!r}")
        # Check prerequisites exist
        for prereq in spec.prerequisites:
            if prereq not in CATALOG:
                errors.append(f"{spec.id}: prerequisite {prereq!r} not in catalog")
        # Check profile is valid
        if spec.profile not in PROFILE_HIERARCHY:
            errors.append(f"{spec.id}: unknown profile {spec.profile!r}")
        # Preflight checks must be weight 0
        if spec.category == "preflight" and spec.weight != 0:
            errors.append(f"{spec.id}: preflight check must have weight=0")
    return errors
