"""Child App E2E Eval Orchestrator.

Main entry point that orchestrates the entire eval lifecycle:
preflight -> agent run -> verification -> scoring -> evidence -> cleanup.

Usage::

    python tests/eval/eval_child_app.py --profile core
    python tests/eval/eval_child_app.py --profile auth-plus --skip-cleanup
    python tests/eval/eval_child_app.py --cleanup-only /path/to/run_state.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any

from tests.eval.agent_prompt import generate_prompt, save_prompt
from tests.eval.capabilities import (
    applicable_checks,
    skip_reasons_for_manifest,
    validate_profile_against_capabilities,
)
from tests.eval.check_catalog import CATALOG, get_prerequisites
from tests.eval.contracts import (
    CheckResult,
    EvalResult,
    NamingContract,
    OperationalMetrics,
    RunManifest,
)
from tests.eval.eval_logger import EvalLogger
from tests.eval.evidence import EvidenceWriter, write_evidence_bundle
from tests.eval.introspection import build_manifest_from_facts, discover_platform_facts
from tests.eval.parsing import extract_report_json
from tests.eval.reason_codes import Attribution, CheckStatus
from tests.eval.redaction import SecretRegistry
from tests.eval.cleanup import run_cleanup
from tests.eval.runners.base import AgentRunner, MockRunner, RunResult, SubprocessRunner
from tests.eval.scoring import compute_scores


# ---------------------------------------------------------------------------
# Default budgets (seconds)
# ---------------------------------------------------------------------------

DEFAULT_AGENT_TIMEOUT = 900       # 15 min
DEFAULT_VERIFY_TIMEOUT = 300      # 5 min
DEFAULT_CLEANUP_TIMEOUT = 180     # 3 min


# ---------------------------------------------------------------------------
# Run state (for crash recovery)
# ---------------------------------------------------------------------------

def _save_run_state(
    evidence_dir: str,
    state: dict[str, Any],
) -> None:
    """Persist run state for crash recovery."""
    path = Path(evidence_dir) / "run_state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


def _load_run_state(path: str) -> dict[str, Any]:
    """Load run state from a previous crash."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def run_cleanup_from_state(
    state_path: str,
    *,
    kill_local_processes: bool = False,
    delete_project_dir: bool = True,
):
    """Run cleanup from a persisted ``run_state.json`` snapshot."""
    state = _load_run_state(state_path)
    manifest_data = state.get("manifest")
    if not isinstance(manifest_data, dict):
        raise ValueError("run_state.json is missing manifest data")

    manifest = RunManifest.from_dict(manifest_data)
    return run_cleanup(
        manifest,
        kill_local_processes=kill_local_processes,
        delete_project_dir=delete_project_dir,
    )


# ---------------------------------------------------------------------------
# Check execution
# ---------------------------------------------------------------------------

def _resolve_check_order(profile: str) -> list[str]:
    """Resolve check execution order respecting prerequisites.

    Returns check IDs in topological order.
    """
    applicable = {s.id for s in applicable_checks(profile)}
    visited: set[str] = set()
    order: list[str] = []

    def _visit(check_id: str) -> None:
        if check_id in visited or check_id not in applicable:
            return
        visited.add(check_id)
        spec = CATALOG.get(check_id)
        if spec:
            for prereq in spec.prerequisites:
                _visit(prereq)
        order.append(check_id)

    for check_id in applicable:
        _visit(check_id)

    return order


def _run_checks_stub(
    check_order: list[str],
    skip_reasons: dict[str, str],
    logger: EvalLogger,
) -> list[CheckResult]:
    """Stub check runner — marks all checks as SKIP with a note.

    Real check execution will be wired when check modules are implemented.
    Each check module (preflight, scaffolding, workflow, local_dev,
    deployment, security, report_quality) will be called here.
    """
    results: list[CheckResult] = []
    passed: set[str] = set()

    for check_id in check_order:
        spec = CATALOG.get(check_id)
        if spec is None:
            continue

        # Check if skip reason exists
        if check_id in skip_reasons:
            logger.check_start(check_id)
            results.append(CheckResult(
                id=check_id,
                category=spec.category,
                weight=spec.weight,
                status=CheckStatus.SKIP,
                detail=skip_reasons[check_id],
                skipped=True,
            ))
            logger.check_result(check_id, CheckStatus.SKIP, skip_reasons[check_id])
            continue

        # Check if prerequisites are met
        unmet = [
            p for p in spec.prerequisites
            if p not in passed and p in {s.id for s in applicable_checks("full-stack")}
        ]
        if unmet:
            logger.check_start(check_id)
            results.append(CheckResult(
                id=check_id,
                category=spec.category,
                weight=spec.weight,
                status=CheckStatus.SKIP,
                detail=f"Blocked by: {', '.join(unmet)}",
                blocked_by=list(unmet),
                skipped=True,
            ))
            logger.check_result(check_id, CheckStatus.SKIP, f"blocked by {unmet}")
            continue

        # Stub: mark as SKIP (to be replaced with real check execution)
        logger.check_start(check_id)
        results.append(CheckResult(
            id=check_id,
            category=spec.category,
            weight=spec.weight,
            status=CheckStatus.SKIP,
            detail="Check module not yet wired",
            skipped=True,
        ))
        logger.check_result(check_id, CheckStatus.SKIP, "not yet wired")
        # Mark as passed for dependency purposes (stubs don't block)
        passed.add(check_id)

    return results


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def run_eval(
    profile: str = "core",
    eval_id: str | None = None,
    evidence_dir: str | None = None,
    projects_root: str = "/home/ubuntu/projects",
    agent_timeout: int = DEFAULT_AGENT_TIMEOUT,
    verify_timeout: int = DEFAULT_VERIFY_TIMEOUT,
    cleanup_timeout: int = DEFAULT_CLEANUP_TIMEOUT,
    skip_deploy: bool = False,
    skip_cleanup: bool = False,
    runner: AgentRunner | None = None,
    verbose: bool = False,
    quiet: bool = False,
) -> EvalResult:
    """Run the complete eval lifecycle.

    Returns the EvalResult with all scores computed.
    """
    start_time = time.monotonic()

    # 1. Generate naming contract and manifest
    naming = NamingContract.from_eval_id(eval_id, projects_root=projects_root)
    if evidence_dir is None:
        evidence_dir = str(
            Path(projects_root) / ".eval-evidence" / naming.app_slug
        )

    manifest = RunManifest.from_naming(
        naming,
        platform_profile=profile,
    )
    manifest.evidence_dir = evidence_dir

    # Initialize logger
    logger = EvalLogger(
        evidence_dir=evidence_dir,
        eval_id=naming.eval_id,
        verbose=verbose,
        quiet=quiet,
    )
    logger.info(f"Eval started: {naming.eval_id} (profile={profile})")

    # Initialize secret registry
    registry = SecretRegistry()

    # Save initial run state
    _save_run_state(evidence_dir, {
        "phase": "init",
        "eval_id": naming.eval_id,
        "profile": profile,
        "completed_phases": [],
        "manifest": manifest.to_dict(),
    })

    # 2. Preflight / introspection
    logger.phase_start("preflight")
    facts = discover_platform_facts()
    cap_manifest = build_manifest_from_facts(facts)
    cap_issues = validate_profile_against_capabilities(profile, cap_manifest)

    if any(i.severity == "error" for i in cap_issues):
        logger.warning(
            f"Capability issues: {[i.detail for i in cap_issues if i.severity == 'error']}"
        )

    skip_reasons = skip_reasons_for_manifest(profile, cap_manifest)
    logger.phase_end("preflight", f"{len(cap_issues)} issues, {len(skip_reasons)} skips")

    _save_run_state(evidence_dir, {
        "phase": "preflight_done",
        "eval_id": naming.eval_id,
        "completed_phases": ["preflight"],
        "capability_issues": [i.to_dict() for i in cap_issues],
        "manifest": manifest.to_dict(),
    })

    # 3. Generate prompt
    logger.phase_start("prompt_generation")
    prompt = generate_prompt(manifest, profile)
    save_prompt(manifest, prompt)
    logger.phase_end("prompt_generation", f"{len(prompt)} chars")

    # Save manifest
    writer = EvidenceWriter(evidence_dir, registry)
    writer.write_json("run_manifest.json", manifest.to_dict(), redact=False)

    # 4. Run agent
    logger.phase_start("agent_execution")
    if runner is None:
        runner = SubprocessRunner()

    run_result = await runner.run(manifest, prompt, timeout_s=agent_timeout)
    logger.phase_end(
        "agent_execution",
        f"exit={run_result.exit_code} timed_out={run_result.timed_out} "
        f"elapsed={run_result.elapsed_s:.1f}s"
    )

    _save_run_state(evidence_dir, {
        "phase": "agent_done",
        "eval_id": naming.eval_id,
        "completed_phases": ["preflight", "agent_execution"],
        "exit_code": run_result.exit_code,
        "timed_out": run_result.timed_out,
        "manifest": manifest.to_dict(),
    })

    # 5. Parse response
    logger.phase_start("parsing")
    parsed_report = extract_report_json(run_result.final_response)
    logger.phase_end("parsing", f"report={'found' if parsed_report else 'missing'}")

    # 6. Run verification checks
    logger.phase_start("verification")
    check_order = _resolve_check_order(profile)
    checks = _run_checks_stub(check_order, skip_reasons, logger)
    logger.phase_end("verification", f"{len(checks)} checks executed")

    # 7. Score
    logger.phase_start("scoring")
    eval_result = compute_scores(checks, naming.eval_id, profile)
    eval_result.operational_metrics = OperationalMetrics(
        time_to_local_health_seconds=None,
        time_to_live_health_seconds=None,
    )
    logger.phase_end(
        "scoring",
        f"status={eval_result.status.value} core={eval_result.core_score:.0%}"
    )

    # 8. Write evidence bundle
    logger.phase_start("evidence")
    write_evidence_bundle(manifest, eval_result, run_result, registry)
    logger.phase_end("evidence", "bundle written")

    # 9. Cleanup (stub)
    if not skip_cleanup:
        logger.phase_start("cleanup")
        # Real cleanup will call provider adapters
        logger.phase_end("cleanup", "stub — no resources to clean")

    elapsed = time.monotonic() - start_time
    logger.info(
        f"Eval complete: {eval_result.status.value} "
        f"(core={eval_result.core_score:.0%}, elapsed={elapsed:.1f}s)"
    )

    return eval_result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="eval_child_app",
        description="Child App E2E Eval — measures autonomous app creation capability",
    )
    parser.add_argument(
        "--profile",
        choices=["core", "auth-plus", "full-stack", "extensible"],
        default="core",
        help="Benchmark profile (default: core)",
    )
    parser.add_argument(
        "--skip-deploy",
        action="store_true",
        help="Skip deployment and live validation",
    )
    parser.add_argument(
        "--skip-cleanup",
        action="store_true",
        help="Skip resource cleanup after eval",
    )
    parser.add_argument(
        "--eval-id",
        help="Use a specific eval ID (default: auto-generated)",
    )
    parser.add_argument(
        "--evidence-dir",
        help="Evidence output directory (default: auto-generated)",
    )
    parser.add_argument(
        "--projects-root",
        default="/home/ubuntu/projects",
        help="Root directory for generated projects",
    )
    parser.add_argument(
        "--agent-timeout",
        type=int,
        default=DEFAULT_AGENT_TIMEOUT,
        help=f"Agent execution timeout in seconds (default: {DEFAULT_AGENT_TIMEOUT})",
    )
    parser.add_argument(
        "--verification-timeout",
        type=int,
        default=DEFAULT_VERIFY_TIMEOUT,
        help=f"Verification timeout in seconds (default: {DEFAULT_VERIFY_TIMEOUT})",
    )
    parser.add_argument(
        "--cleanup-timeout",
        type=int,
        default=DEFAULT_CLEANUP_TIMEOUT,
        help=f"Cleanup timeout in seconds (default: {DEFAULT_CLEANUP_TIMEOUT})",
    )
    parser.add_argument(
        "--resume",
        metavar="STATE_PATH",
        help="Resume from a previous run_state.json",
    )
    parser.add_argument(
        "--cleanup-only",
        metavar="STATE_PATH",
        help="Only run cleanup from a previous run_state.json",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose logging (DEBUG level)",
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suppress console output",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.cleanup_only:
        cleanup = run_cleanup_from_state(args.cleanup_only)
        return 0 if cleanup.completed else 1

    result = asyncio.run(run_eval(
        profile=args.profile,
        eval_id=args.eval_id,
        evidence_dir=args.evidence_dir,
        projects_root=args.projects_root,
        agent_timeout=args.agent_timeout,
        verify_timeout=args.verification_timeout,
        cleanup_timeout=args.cleanup_timeout,
        skip_deploy=args.skip_deploy,
        skip_cleanup=args.skip_cleanup,
        verbose=args.verbose,
        quiet=args.quiet,
    ))

    # Exit codes: 0=PASS, 1=FAIL/PARTIAL, 2=INVALID, 3=ERROR
    exit_codes = {
        CheckStatus.PASS: 0,
        CheckStatus.FAIL: 1,
        CheckStatus.INVALID: 2,
        CheckStatus.ERROR: 3,
    }
    return exit_codes.get(result.status, 1)


if __name__ == "__main__":
    sys.exit(main())
