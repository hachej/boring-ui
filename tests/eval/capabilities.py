"""Versioned capability manifests and profile contracts.

Each benchmark profile declares what platform capabilities it requires.
Runtime introspection populates observed facts; this module validates
whether the platform can satisfy the profile and filters the check catalog
accordingly.

Versioning:
    ``capability_manifest_version`` is separate from ``eval_spec_version``.
    It changes when platform capabilities change (e.g., bui init adds a
    new default feature).
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any

from tests.eval.check_catalog import CATALOG, CheckSpec, check_applicable
from tests.eval.contracts import CheckResult, PlatformFacts
from tests.eval.reason_codes import CheckStatus


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CAPABILITY_MANIFEST_VERSION = "0.1.0"


# ---------------------------------------------------------------------------
# ProfileContract
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProfileContract:
    """Boolean capability requirements for a benchmark profile."""

    name: str
    requires_deploy: bool = True
    requires_auth: bool = False
    requires_neon: bool = True
    requires_workspace: bool = False
    requires_files: bool = False
    requires_git: bool = False
    requires_frontend_shell: bool = False
    requires_custom_pane: bool = False
    requires_custom_tool: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProfileContract:
        return cls(**{
            f.name: data[f.name]
            for f in fields(cls)
            if f.name in data
        })


# ---------------------------------------------------------------------------
# Profile registry
# ---------------------------------------------------------------------------

PROFILES: dict[str, ProfileContract] = {
    "core": ProfileContract(
        name="core",
        requires_deploy=True,
        requires_auth=False,
        requires_neon=True,
        requires_workspace=False,
        requires_files=False,
        requires_git=False,
    ),
    "auth-plus": ProfileContract(
        name="auth-plus",
        requires_deploy=True,
        requires_auth=True,
        requires_neon=True,
        requires_workspace=False,
        requires_files=False,
        requires_git=False,
    ),
    "full-stack": ProfileContract(
        name="full-stack",
        requires_deploy=True,
        requires_auth=True,
        requires_neon=True,
        requires_workspace=True,
        requires_files=True,
        requires_git=True,
        requires_frontend_shell=True,
    ),
    "extensible": ProfileContract(
        name="extensible",
        requires_deploy=True,
        requires_auth=True,
        requires_neon=True,
        requires_workspace=True,
        requires_files=True,
        requires_git=True,
        requires_frontend_shell=True,
        requires_custom_pane=True,
        requires_custom_tool=True,
    ),
}


def get_profile_contract(profile_name: str) -> ProfileContract:
    """Return the ProfileContract for *profile_name*.

    Raises ``KeyError`` if the profile is unknown.
    """
    return PROFILES[profile_name]


# ---------------------------------------------------------------------------
# CapabilityManifest
# ---------------------------------------------------------------------------

@dataclass
class CapabilityManifest:
    """What the current eval_spec_version expects from the platform.

    Populated from runtime introspection (PlatformFacts) and used to
    determine whether checks should run, skip, or be INVALID.
    """

    version: str = CAPABILITY_MANIFEST_VERSION

    # Tool availability
    bui_available: bool = False
    fly_available: bool = False
    vault_read: bool = False
    vault_write: bool = False
    neon_cli_available: bool = False
    network_ok: bool = False

    # Platform features (populated from bui/repo introspection)
    scaffold_support: bool = False
    doctor_support: bool = False
    deploy_support: bool = False
    neon_setup_support: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CapabilityManifest:
        return cls(**{
            f.name: data[f.name]
            for f in fields(cls)
            if f.name in data
        })

    @classmethod
    def from_platform_facts(cls, facts: PlatformFacts) -> CapabilityManifest:
        """Build a manifest from observed platform facts.

        This is a best-effort mapping; not all capabilities can be
        inferred from PlatformFacts alone (e.g., Vault write access
        requires a live test).
        """
        return cls(
            bui_available=bool(facts.bui_version),
            fly_available=bool(facts.fly_cli_version),
            vault_read=facts.vault_available,
            vault_write=False,  # resolved from preflight against the app-scoped Vault path
            neon_cli_available=bool(facts.neon_cli_version),
            network_ok=False,  # resolved from preflight
            scaffold_support=bool(facts.bui_version),
            doctor_support=bool(facts.bui_version),
            deploy_support=bool(facts.bui_version and facts.fly_cli_version),
            neon_setup_support=bool(facts.bui_version),
        )


def enrich_manifest_with_preflight_results(
    manifest: CapabilityManifest,
    preflight_checks: list[CheckResult],
) -> CapabilityManifest:
    """Fold live preflight results into the capability manifest."""
    check_by_id = {check.id: check for check in preflight_checks}

    if check_by_id.get("preflight.vault_read_access", None) and check_by_id["preflight.vault_read_access"].status == CheckStatus.PASS:
        manifest.vault_read = True
    if check_by_id.get("preflight.vault_write_access", None) and check_by_id["preflight.vault_write_access"].status == CheckStatus.PASS:
        manifest.vault_write = True
    if check_by_id.get("preflight.network_reachable", None) and check_by_id["preflight.network_reachable"].status == CheckStatus.PASS:
        manifest.network_ok = True
    if check_by_id.get("preflight.fly_available", None) and check_by_id["preflight.fly_available"].status == CheckStatus.PASS:
        manifest.fly_available = True
        manifest.deploy_support = manifest.deploy_support or manifest.bui_available

    return manifest


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

@dataclass
class CapabilityIssue:
    """A mismatch between profile requirements and observed capabilities."""

    requirement: str
    detail: str
    severity: str = "error"  # error | warning

    def to_dict(self) -> dict[str, Any]:
        return {
            "requirement": self.requirement,
            "detail": self.detail,
            "severity": self.severity,
        }


def validate_profile_against_capabilities(
    profile: str,
    manifest: CapabilityManifest,
) -> list[CapabilityIssue]:
    """Check if *manifest* satisfies the requirements for *profile*.

    Returns a list of issues (empty = all requirements met).
    """
    contract = get_profile_contract(profile)
    issues: list[CapabilityIssue] = []

    # Core requirements (all profiles)
    if not manifest.bui_available:
        issues.append(CapabilityIssue(
            requirement="bui_available",
            detail="bui CLI is not available — cannot scaffold or validate",
        ))

    if contract.requires_deploy:
        if not manifest.fly_available:
            issues.append(CapabilityIssue(
                requirement="fly_available",
                detail="Fly CLI not available — deploy checks will be INVALID",
            ))
        if not manifest.deploy_support:
            issues.append(CapabilityIssue(
                requirement="deploy_support",
                detail="Deploy support not detected — deploy checks will be INVALID",
            ))

    if contract.requires_neon:
        if not manifest.neon_setup_support:
            issues.append(CapabilityIssue(
                requirement="neon_setup_support",
                detail="Neon setup support not detected",
                severity="warning",
            ))

    if not manifest.vault_read:
        issues.append(CapabilityIssue(
            requirement="vault_read",
            detail="Vault read access not available — secret checks may fail",
        ))

    if contract.requires_neon and not manifest.vault_write:
        issues.append(CapabilityIssue(
            requirement="vault_write",
            detail="App-scoped Vault write access not available — bui neon setup needs secret/data/agent/app/<app>/prod",
        ))

    if not manifest.network_ok:
        issues.append(CapabilityIssue(
            requirement="network_ok",
            detail="Network access not verified",
            severity="warning",
        ))

    # Extensible profile requirements
    if contract.requires_custom_pane:
        if not manifest.bui_available:
            issues.append(CapabilityIssue(
                requirement="requires_custom_pane",
                detail=(
                    "Custom pane checks require bui CLI for workspace plugin "
                    "discovery — pane checks will be SKIP"
                ),
                severity="warning",
            ))

    if contract.requires_custom_tool:
        if not manifest.bui_available:
            issues.append(CapabilityIssue(
                requirement="requires_custom_tool",
                detail=(
                    "Custom tool checks require bui CLI for router mounting "
                    "— tool checks will be SKIP"
                ),
                severity="warning",
            ))

    return issues


# ---------------------------------------------------------------------------
# Check filtering
# ---------------------------------------------------------------------------

def applicable_checks(
    profile: str,
    catalog: dict[str, CheckSpec] | None = None,
) -> list[CheckSpec]:
    """Return checks from *catalog* that apply to *profile*.

    Uses the check_applicable() function from check_catalog.
    """
    if catalog is None:
        catalog = CATALOG
    return [spec for spec in catalog.values() if check_applicable(spec, profile)]


def skip_reasons_for_manifest(
    profile: str,
    manifest: CapabilityManifest,
    catalog: dict[str, CheckSpec] | None = None,
) -> dict[str, str]:
    """Return check_id -> skip_reason for checks that should be SKIPped.

    Determines which applicable checks cannot run given the current
    manifest state.
    """
    if catalog is None:
        catalog = CATALOG
    contract = get_profile_contract(profile)
    skips: dict[str, str] = {}

    checks = applicable_checks(profile, catalog)
    for spec in checks:
        # Preflight checks are never skipped (they produce INVALID instead)
        if spec.category == "preflight":
            continue

        # Deploy checks need Fly
        if spec.category == "deployment" and spec.id.startswith("deploy."):
            if not manifest.fly_available:
                skips[spec.id] = "ENV_FLY_AUTH: Fly CLI not available"
            elif not manifest.deploy_support:
                skips[spec.id] = "ENV_DEPENDENCY_MISSING: deploy support not detected"

        # Workflow checks for neon need neon setup support
        if spec.id == "workflow.neon_supported" and not manifest.neon_setup_support:
            skips[spec.id] = "ENV_DEPENDENCY_MISSING: Neon setup not available"

        # Extensible checks: live pane/tool checks need deploy support
        if spec.category in ("custom_pane", "custom_tool", "pane_tool_integration"):
            # Live checks need Fly
            if "live" in spec.id and not manifest.fly_available:
                skips[spec.id] = "ENV_FLY_AUTH: Fly CLI not available for live checks"
            elif "live" in spec.id and not manifest.deploy_support:
                skips[spec.id] = "ENV_DEPENDENCY_MISSING: deploy support not detected"

            # All extensible checks need bui
            if not manifest.bui_available:
                skips[spec.id] = "ENV_BUI_MISSING: bui CLI not available for extensible checks"

    return skips
