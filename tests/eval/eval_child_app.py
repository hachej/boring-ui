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
import shutil
import signal
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.eval.agent_prompt import generate_prompt, save_prompt
from tests.eval.capabilities import (
    applicable_checks,
    enrich_manifest_with_preflight_results,
    skip_reasons_for_manifest,
    validate_profile_against_capabilities,
)
from tests.eval.check_catalog import CATALOG
from tests.eval.checks.deployment import DeploymentContext, run_deployment_checks
from tests.eval.checks.local_dev import LocalDevContext, run_local_dev_checks
from tests.eval.checks.preflight import run_preflight_checks
from tests.eval.checks.custom_pane import CustomPaneContext, run_custom_pane_checks
from tests.eval.checks.custom_tool import PROBE_INPUTS, CustomToolContext, run_custom_tool_checks
from tests.eval.checks.pane_tool_integration import (
    PaneToolIntegrationContext,
    run_pane_tool_integration_checks,
)
from tests.eval.checks.report_quality import run_report_quality_checks
from tests.eval.checks.scaffolding import run_scaffolding_checks
from tests.eval.checks.security import run_security_checks
from tests.eval.checks.workflow import run_workflow_checks
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
from tests.eval.parsing import extract_deployed_url, extract_neon_project_id, extract_report_json
from tests.eval.providers.fly import FlyAdapter
from tests.eval.reason_codes import CheckStatus
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


def _make_skip_result(
    check_id: str,
    detail: str,
    *,
    blocked_by: list[str] | None = None,
) -> CheckResult:
    """Build a canonical SKIP result for a catalog check."""
    spec = CATALOG[check_id]
    return CheckResult(
        id=check_id,
        category=spec.category,
        weight=spec.weight,
        status=CheckStatus.SKIP,
        detail=detail,
        skipped=True,
        blocked_by=list(blocked_by or []),
    )


def _order_check_results(
    check_order: list[str],
    generated_checks: list[CheckResult],
    skip_reasons: dict[str, str],
    logger: EvalLogger,
) -> list[CheckResult]:
    """Order generated check results and overlay harness-driven skips."""
    by_id = {check.id: check for check in generated_checks}
    ordered: list[CheckResult] = []

    for check_id in check_order:
        if check_id not in CATALOG:
            continue

        logger.check_start(check_id)
        if check_id in skip_reasons:
            result = _make_skip_result(check_id, skip_reasons[check_id])
        else:
            result = by_id.get(check_id) or _make_skip_result(
                check_id,
                "Harness did not return a result for this check",
            )

        ordered.append(result)
        logger.check_result(check_id, result.status, result.detail)

    return ordered


def _snapshot_workspace(projects_root: str, project_root: str) -> set[str]:
    """Capture a lightweight workspace snapshot for scope-hygiene checks."""
    snapshot: set[str] = set()
    projects_path = Path(projects_root)
    repo_root = Path(__file__).resolve().parents[2]
    target_root = Path(project_root)

    if projects_path.is_dir():
        for child in projects_path.iterdir():
            snapshot.add(str(child))

    for root in (repo_root, target_root):
        if not root.exists():
            continue
        snapshot.add(str(root))
        for path in root.rglob("*"):
            snapshot.add(str(path))

    return snapshot


def _pick_free_port() -> int:
    """Reserve an ephemeral local TCP port for clean-room validation."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _http_probe(url: str, timeout_s: float = 5.0) -> tuple[int | None, Any | None]:
    """Fetch a URL and decode JSON when possible."""
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            payload = response.read().decode("utf-8", errors="replace")
            try:
                return response.status, json.loads(payload)
            except json.JSONDecodeError:
                return response.status, payload
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        try:
            body: Any = json.loads(payload)
        except json.JSONDecodeError:
            body = payload
        return exc.code, body
    except Exception:
        return None, None


async def _run_command_capture(
    command: list[str],
    *,
    cwd: str,
    timeout_s: int,
    env: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    """Run a short-lived subprocess and capture its output."""
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return -1, "", f"Command not found: {command[0]}"

    timed_out = False
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        timed_out = True
        process.kill()
        stdout_bytes, stderr_bytes = await process.communicate()

    exit_code = process.returncode if process.returncode is not None else -1
    if timed_out and exit_code == 0:
        exit_code = -1

    return (
        exit_code,
        stdout_bytes.decode(errors="replace"),
        stderr_bytes.decode(errors="replace"),
    )


async def _run_local_dev_validation(
    manifest: RunManifest,
    timeout_s: int,
) -> tuple[LocalDevContext, float | None]:
    """Run clean-room local validation via ``bui doctor`` + ``bui dev``."""
    project_root = Path(manifest.project_root)
    if not project_root.is_dir():
        return LocalDevContext(manifest), None

    doctor_exit, doctor_stdout, doctor_stderr = await _run_command_capture(
        ["bui", "doctor"],
        cwd=str(project_root),
        timeout_s=max(30, min(timeout_s, 120)),
        env=os.environ.copy(),
    )

    port = _pick_free_port()
    dev_env = os.environ.copy()
    dev_env["CONTROL_PLANE_PROVIDER"] = "local"

    try:
        process = await asyncio.create_subprocess_exec(
            "bui",
            "dev",
            "--backend-only",
            "--port",
            str(port),
            cwd=str(project_root),
            env=dev_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return (
            LocalDevContext(
                manifest,
                doctor_exit_code=doctor_exit,
                doctor_stdout=doctor_stdout,
                doctor_stderr=doctor_stderr,
                dev_started=False,
                dev_port=port,
                dev_stderr="Command not found: bui",
            ),
            None,
        )

    base_url = f"http://127.0.0.1:{port}"
    started = False
    time_to_health: float | None = None
    health_status: int | None = None
    health_response: dict[str, Any] | None = None
    info_status: int | None = None
    info_response: dict[str, Any] | None = None
    config_status: int | None = None
    config_response: dict[str, Any] | None = None
    capabilities_status: int | None = None
    capabilities_response: dict[str, Any] | None = None
    eval_tool_probes: dict[str, dict[str, Any]] = {}
    probe_started = time.monotonic()

    while time.monotonic() - probe_started < timeout_s:
        if process.returncode is not None:
            break

        status, body = _http_probe(f"{base_url}/health", timeout_s=3.0)
        if status == 200:
            started = True
            time_to_health = time.monotonic() - probe_started
            health_status = status
            if isinstance(body, dict):
                health_response = body
            break

        await asyncio.sleep(1.0)

    if started:
        info_status, info_body = _http_probe(f"{base_url}/info", timeout_s=3.0)
        if isinstance(info_body, dict):
            info_response = info_body

        config_status, config_body = _http_probe(f"{base_url}/__bui/config", timeout_s=3.0)
        if isinstance(config_body, dict):
            config_response = config_body

        capabilities_status, capabilities_body = _http_probe(
            f"{base_url}/api/capabilities",
            timeout_s=3.0,
        )
        if isinstance(capabilities_body, dict):
            capabilities_response = capabilities_body

        for input_value in PROBE_INPUTS:
            status, body = _http_probe(
                f"{base_url}/api/x/eval_tool/compute?input={urllib.parse.quote(input_value)}",
                timeout_s=3.0,
            )
            eval_tool_probes[input_value] = {
                "status": status,
                "body": body,
            }

    clean_shutdown = False
    if process.returncode is None:
        process.send_signal(signal.SIGTERM)
        try:
            await asyncio.wait_for(process.wait(), timeout=15)
            clean_shutdown = True
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    stdout_bytes, stderr_bytes = await process.communicate()
    dev_stdout = stdout_bytes.decode(errors="replace")
    dev_stderr = stderr_bytes.decode(errors="replace")

    return (
        LocalDevContext(
            manifest,
            doctor_exit_code=doctor_exit,
            doctor_stdout=doctor_stdout,
            doctor_stderr=doctor_stderr,
            dev_started=started,
            dev_port=port,
            dev_stdout=dev_stdout,
            dev_stderr=dev_stderr,
            health_response=health_response,
            health_status=health_status,
            info_response=info_response,
            info_status=info_status,
            config_response=config_response,
            config_status=config_status,
            capabilities_response=capabilities_response,
            capabilities_status=capabilities_status,
            eval_tool_probes=eval_tool_probes,
            clean_shutdown=clean_shutdown,
        ),
        time_to_health,
    )


def _write_extensible_evidence(
    manifest: RunManifest,
    writer: EvidenceWriter,
    local_ctx: LocalDevContext,
    deployment_ctx: DeploymentContext,
) -> None:
    """Persist extensible-profile probe artifacts in stable evidence paths."""
    if manifest.platform_profile != "extensible":
        return

    pane_path = (
        Path(manifest.project_root)
        / "kurt"
        / "panels"
        / "eval-status"
        / "Panel.jsx"
    )
    pane_source = ""
    if pane_path.is_file():
        try:
            pane_source = pane_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            pane_source = ""

    writer.write_json(
        "static_analysis/pane_exports.json",
        {
            "path": str(pane_path),
            "exists": pane_path.is_file(),
            "has_default_export": "export default" in pane_source,
        },
        redact=False,
    )
    writer.write_json(
        "static_analysis/pane_backend_call.json",
        {
            "path": str(pane_path),
            "calls_eval_tool_endpoint": "/api/x/eval_tool/compute" in pane_source,
            "references_eval_id": "eval_id" in pane_source,
            "references_verification_nonce": "verification_nonce" in pane_source,
        },
        redact=False,
    )

    writer.write_json(
        "http/local_capabilities_pane.json",
        {
            "status": local_ctx.capabilities_status,
            "body": local_ctx.capabilities_response,
        },
        redact=False,
    )

    deploy_caps_status, deploy_caps_body = deployment_ctx.get("/api/capabilities")
    writer.write_json(
        "http/deploy_capabilities_pane.json",
        {
            "status": deploy_caps_status,
            "body": deploy_caps_body,
        },
        redact=False,
    )

    for index, input_value in enumerate(PROBE_INPUTS, start=1):
        local_probe = (local_ctx.eval_tool_probes or {}).get(input_value, {})
        writer.write_json(
            f"http/local_eval_tool_compute_{index}.json",
            {
                "input": input_value,
                "status": local_probe.get("status"),
                "body": local_probe.get("body"),
            },
            redact=False,
        )

        live_status, live_body = deployment_ctx.get(
            f"/api/x/eval_tool/compute?input={urllib.parse.quote(input_value)}"
        )
        writer.write_json(
            f"http/deploy_eval_tool_compute_{index}.json",
            {
                "input": input_value,
                "status": live_status,
                "body": live_body,
            },
            redact=False,
        )


def _default_agent_runner(manifest: RunManifest) -> AgentRunner:
    """Build the default real-agent runner with a resolved Claude binary."""
    claude_cmd = shutil.which("claude") or "claude"
    return SubprocessRunner(command=[
        claude_cmd,
        "--print",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        manifest.project_root,
    ], cwd=manifest.project_root)


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
    pre_snapshot = _snapshot_workspace(projects_root, manifest.project_root)

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
    preflight_checks = run_preflight_checks(manifest)
    cap_manifest = enrich_manifest_with_preflight_results(cap_manifest, preflight_checks)
    cap_issues = validate_profile_against_capabilities(profile, cap_manifest)

    if any(i.severity == "error" for i in cap_issues):
        logger.warning(
            f"Capability issues: {[i.detail for i in cap_issues if i.severity == 'error']}"
        )

    skip_reasons = skip_reasons_for_manifest(profile, cap_manifest)
    preflight_invalid = sum(1 for check in preflight_checks if check.status == CheckStatus.INVALID)
    logger.phase_end(
        "preflight",
        f"{len(cap_issues)} issues, {len(skip_reasons)} skips, {preflight_invalid} invalid",
    )

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
        runner = _default_agent_runner(manifest)

    run_result = await runner.run(manifest, prompt, timeout_s=agent_timeout)
    await runner.cleanup()
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
    effective_skip_reasons = dict(skip_reasons)
    if skip_deploy:
        for check_id in check_order:
            spec = CATALOG.get(check_id)
            if spec and spec.category == "deployment":
                effective_skip_reasons[check_id] = "Skipped by --skip-deploy"

    local_ctx, time_to_local_health = await _run_local_dev_validation(
        manifest,
        timeout_s=verify_timeout,
    )

    fly_adapter = FlyAdapter()
    reported_url = extract_deployed_url(run_result.final_response, manifest)
    discovered_url = fly_adapter.app_url(manifest.app_slug)
    deployment_ctx = DeploymentContext(
        manifest,
        deployed_url=discovered_url or reported_url,
        fly_adapter=fly_adapter,
    )

    generated_checks: list[CheckResult] = []
    generated_checks.extend(preflight_checks)
    generated_checks.extend(run_scaffolding_checks(manifest))
    generated_checks.extend(run_workflow_checks(
        manifest,
        run_result.command_log,
        run_result.final_response,
    ))
    generated_checks.extend(run_local_dev_checks(local_ctx))
    generated_checks.extend(run_deployment_checks(deployment_ctx))
    if profile == "extensible":
        generated_checks.extend(run_custom_pane_checks(CustomPaneContext(
            manifest,
            local_ctx=local_ctx,
            deployment_ctx=deployment_ctx,
        )))
        generated_checks.extend(run_custom_tool_checks(CustomToolContext(
            manifest,
            local_ctx=local_ctx,
            deployment_ctx=deployment_ctx,
            command_log=run_result.command_log,
            agent_text=run_result.final_response,
        )))
        generated_checks.extend(run_pane_tool_integration_checks(PaneToolIntegrationContext(
            manifest,
        )))
        _write_extensible_evidence(manifest, writer, local_ctx, deployment_ctx)

    post_snapshot = _snapshot_workspace(projects_root, manifest.project_root)
    generated_checks.extend(run_security_checks(
        manifest,
        registry,
        agent_stdout=run_result.stdout,
        agent_stderr=run_result.stderr,
        evidence_text=run_result.final_response,
        pre_snapshot=pre_snapshot,
        post_snapshot=post_snapshot,
    ))

    scaffolding_by_id = {check.id: check for check in generated_checks if check.category == "scaffolding"}
    observations = {
        "step_scaffold_succeeded": (
            scaffolding_by_id.get("scaff.custom_router_impl") is not None
            and scaffolding_by_id["scaff.custom_router_impl"].status == CheckStatus.PASS
        ),
        "step_local_validate_succeeded": (
            local_ctx.dev_started and local_ctx.health_status == 200
        ),
        "step_local_validation_succeeded": (
            local_ctx.dev_started and local_ctx.health_status == 200
        ),
        "step_neon_setup_succeeded": bool(
            extract_neon_project_id(manifest.project_root, run_result.final_response)
        ),
        "step_deploy_succeeded": bool(deployment_ctx.deployed_url),
    }
    generated_checks.extend(run_report_quality_checks(
        manifest,
        run_result.final_response,
        command_log=run_result.command_log,
        harness_observations=observations,
    ))

    checks = _order_check_results(
        check_order,
        generated_checks,
        effective_skip_reasons,
        logger,
    )
    logger.phase_end("verification", f"{len(checks)} checks executed")

    # 7. Score
    logger.phase_start("scoring")
    eval_result = compute_scores(checks, naming.eval_id, profile)
    eval_result.operational_metrics = OperationalMetrics(
        time_to_local_health_seconds=time_to_local_health,
        time_to_live_health_seconds=None,
    )
    eval_result.deployed_url = deployment_ctx.deployed_url or ""
    eval_result.fly_app_name = manifest.app_slug
    eval_result.neon_project_id = extract_neon_project_id(
        manifest.project_root,
        run_result.final_response,
    ) or ""
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
        cleanup_manifest = run_cleanup(manifest)
        eval_result.cleanup_errors = [r for r in cleanup_manifest.results if not r.success]
        logger.phase_end(
            "cleanup",
            (
                f"{len(cleanup_manifest.results)} actions, "
                f"{sum(1 for r in cleanup_manifest.results if r.success)} succeeded"
            ),
        )

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
