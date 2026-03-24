"""Weighted scoring engine for the child app E2E eval.

Algorithm:
    1. Filter checks by profile applicability
    2. Group by category
    3. Per category: score = sum(passed weights) / sum(applicable weights)
    4. core_score = weighted average of core-required category scores
    5. Check must_pass flags and critical auto-fail conditions
    6. Determine overall status: PASS / PARTIAL / FAIL / INVALID / ERROR
"""

from __future__ import annotations

from typing import Any

from tests.eval.check_catalog import (
    CATEGORY_GATES,
    CATEGORY_WEIGHTS,
    CATALOG,
    EXTENSIBLE_CATEGORY_WEIGHTS,
    CheckSpec,
    check_applicable,
)
from tests.eval.contracts import CategoryScore, CheckResult, EvalResult
from tests.eval.reason_codes import CheckStatus


# ---------------------------------------------------------------------------
# Critical auto-fail check IDs
# ---------------------------------------------------------------------------

#: Checks that trigger auto-fail when they FAIL.
CRITICAL_AUTOFAIL: dict[str, str] = {
    "sec.no_secrets_in_toml": "Secrets in tracked files",
    "sec.no_secrets_in_source": "Secrets in tracked files",
    "sec.no_secrets_in_evidence": "Secrets in evidence/report",
    "sec.no_forbidden_repo_changes": "Forbidden path changes",
    "sec.only_project_dir_mutated": "Forbidden path changes",
    "deploy.deployed_url_present": "Deploy required but no URL",
    "deploy.health_200": "Deployment unreachable after warmup",
    "scaff.custom_router_impl": "Custom routes missing",
    "report.claims_match_evidence": "Agent claims disproved by harness",
    # Extensible profile auto-fail conditions
    "pane.file_exists": "Custom pane file missing",
    "pane.default_export": "Custom pane has no default export",
    "tool.toml_declared": "Custom router not declared in boring.app.toml",
    "tool.live_200": "Live eval_tool endpoint unreachable",
}


# ---------------------------------------------------------------------------
# Scoring functions
# ---------------------------------------------------------------------------

def compute_category_scores(
    checks: list[CheckResult],
    profile: str,
) -> list[CategoryScore]:
    """Compute per-category scores from check results."""
    # Group results by category
    by_category: dict[str, list[CheckResult]] = {}
    for cr in checks:
        spec = CATALOG.get(cr.id)
        if spec is None:
            continue
        if not check_applicable(spec, profile):
            continue
        by_category.setdefault(cr.category, []).append(cr)

    scores: list[CategoryScore] = []
    for category, gate in CATEGORY_GATES.items():
        if category == "preflight":
            continue  # unscored

        results = by_category.get(category, [])
        passed_weight = 0.0
        total_weight = 0.0

        for cr in results:
            spec = CATALOG.get(cr.id)
            if spec is None:
                continue
            # Exclude legitimate SKIPs and INVALIDs from denominator
            if cr.status in (CheckStatus.SKIP, CheckStatus.INVALID):
                continue
            total_weight += spec.weight
            if cr.status == CheckStatus.PASS:
                passed_weight += spec.weight

        score = passed_weight / total_weight if total_weight > 0 else 0.0

        scores.append(CategoryScore(
            name=category,
            score=score,
            gate=gate,
            gate_met=score >= gate,
            passed_weight=passed_weight,
            total_weight=total_weight,
        ))

    return scores


def compute_core_score(
    categories: list[CategoryScore],
    profile: str = "core",
) -> float:
    """Compute weighted average core score (0.0–1.0).

    When *profile* is ``"extensible"``, uses redistributed weights that
    allocate 20% to the extensible categories (custom_pane, custom_tool,
    pane_tool_integration) while proportionally reducing base weights.
    """
    weights = (
        EXTENSIBLE_CATEGORY_WEIGHTS if profile == "extensible"
        else CATEGORY_WEIGHTS
    )

    weighted_sum = 0.0
    weight_sum = 0.0

    for cs in categories:
        weight = weights.get(cs.name, 0.0)
        if weight <= 0 or cs.total_weight == 0:
            continue
        weighted_sum += cs.score * weight
        weight_sum += weight

    if weight_sum == 0:
        return 0.0

    # Redistribute weight from zero-applicable categories
    return weighted_sum / weight_sum


def check_gates(categories: list[CategoryScore]) -> list[str]:
    """Return list of categories that failed their gate."""
    return [cs.name for cs in categories if not cs.gate_met and cs.total_weight > 0]


def check_must_pass(checks: list[CheckResult]) -> list[str]:
    """Return IDs of must_pass checks that did not PASS."""
    failures: list[str] = []
    for cr in checks:
        spec = CATALOG.get(cr.id)
        if spec and spec.must_pass and cr.status != CheckStatus.PASS:
            failures.append(cr.id)
    return failures


def check_auto_fail(checks: list[CheckResult]) -> list[str]:
    """Return descriptions of triggered critical auto-fail conditions."""
    triggered: list[str] = []
    seen: set[str] = set()

    for cr in checks:
        if cr.id in CRITICAL_AUTOFAIL and cr.status == CheckStatus.FAIL:
            desc = CRITICAL_AUTOFAIL[cr.id]
            if desc not in seen:
                triggered.append(desc)
                seen.add(desc)

    return triggered


def determine_status(
    core_score: float,
    categories: list[CategoryScore],
    checks: list[CheckResult],
) -> tuple[CheckStatus, str]:
    """Determine overall eval status.

    Returns (status, detail) tuple.
    """
    # Check for ERROR first
    error_checks = [cr for cr in checks if cr.status == CheckStatus.ERROR]
    if error_checks:
        return CheckStatus.ERROR, f"Harness errors in: {', '.join(c.id for c in error_checks)}"

    # Check for majority INVALID (>50% of core checks)
    core_checks = [cr for cr in checks if CATALOG.get(cr.id, CheckSpec(
        id="", category="", weight=0
    )).core_required]
    invalid_count = sum(1 for cr in core_checks if cr.status == CheckStatus.INVALID)
    if core_checks and invalid_count / len(core_checks) > 0.5:
        return CheckStatus.INVALID, f"{invalid_count}/{len(core_checks)} core checks INVALID"

    # Critical auto-fail
    auto_fails = check_auto_fail(checks)
    must_pass_fails = check_must_pass(checks)
    gate_fails = check_gates(categories)

    # PASS: core >= 0.80, all gates met, all must_pass passed, no auto-fail
    if (
        core_score >= 0.80
        and not gate_fails
        and not must_pass_fails
        and not auto_fails
    ):
        return CheckStatus.PASS, "All criteria met"

    # PARTIAL: core >= 0.60, no critical security auto-fail
    security_auto_fails = [
        af for af in auto_fails
        if "secret" in af.lower() or "forbidden" in af.lower()
    ]
    if core_score >= 0.60 and not security_auto_fails:
        detail_parts = []
        if gate_fails:
            detail_parts.append(f"gate failures: {', '.join(gate_fails)}")
        if must_pass_fails:
            detail_parts.append(f"must_pass failures: {', '.join(must_pass_fails)}")
        return CheckStatus.FAIL, f"Partial (core={core_score:.0%}): {'; '.join(detail_parts)}"

    # FAIL
    detail_parts = [f"core={core_score:.0%}"]
    if auto_fails:
        detail_parts.append(f"auto-fail: {', '.join(auto_fails)}")
    if must_pass_fails:
        detail_parts.append(f"must_pass: {', '.join(must_pass_fails)}")
    if gate_fails:
        detail_parts.append(f"gates: {', '.join(gate_fails)}")
    return CheckStatus.FAIL, "; ".join(detail_parts)


# ---------------------------------------------------------------------------
# Top-level scoring
# ---------------------------------------------------------------------------

def compute_scores(
    checks: list[CheckResult],
    eval_id: str,
    profile: str = "core",
) -> EvalResult:
    """Compute the complete EvalResult from check results.

    This is the main entry point for scoring.
    """
    categories = compute_category_scores(checks, profile)
    core_score = compute_core_score(categories, profile)

    # Extension score (non-core checks)
    ext_checks = [
        cr for cr in checks
        if not CATALOG.get(cr.id, CheckSpec(id="", category="", weight=0)).core_required
    ]
    ext_passed = sum(
        CATALOG[cr.id].weight for cr in ext_checks
        if cr.status == CheckStatus.PASS and cr.id in CATALOG
    )
    ext_total = sum(
        CATALOG[cr.id].weight for cr in ext_checks
        if cr.status not in (CheckStatus.SKIP, CheckStatus.INVALID)
        and cr.id in CATALOG
    )
    extension_score = ext_passed / ext_total if ext_total > 0 else 0.0

    must_pass_fails = check_must_pass(checks)
    auto_fails = check_auto_fail(checks)
    status, detail = determine_status(core_score, categories, checks)

    return EvalResult(
        eval_id=eval_id,
        status=status,
        status_detail=detail,
        core_score=core_score,
        extension_score=extension_score,
        overall_score=core_score,  # overall = core for now
        critical_failures=auto_fails,
        must_pass_failures=must_pass_fails,
        categories=categories,
        checks=checks,
    )
