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
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib

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
from tests.eval.report_schema import BEGIN_MARKER, END_MARKER
from tests.eval.providers.fly import FlyAdapter
from tests.eval.reason_codes import CheckStatus
from tests.eval.redaction import SecretRegistry
from tests.eval.cleanup import run_cleanup
from tests.eval.runners.base import AgentRunner, MockRunner, RunResult, SubprocessRunner
from tests.eval.scoring import compute_scores


# ---------------------------------------------------------------------------
# Default budgets (seconds)
# ---------------------------------------------------------------------------

DEFAULT_AGENT_TIMEOUT = 1200      # 20 min
DEFAULT_VERIFY_TIMEOUT = 300      # 5 min
DEFAULT_CLEANUP_TIMEOUT = 180     # 3 min

TRUSTED_LOCAL_AUTH_PORTS = (5176, 5175, 5174, 5173, 3000)
SNAPSHOT_PRUNE_DIRS = {
    ".air",
    ".git",
    ".mypy_cache",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "dist",
    "node_modules",
}


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


def _load_report_output_text(manifest: RunManifest) -> str:
    path = Path(manifest.report_output_path)
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _persist_plain_report_output(
    manifest: RunManifest,
    report: dict[str, Any],
) -> None:
    path = Path(manifest.report_output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def _serialize_run_result_summary(run_result: Any) -> dict[str, Any]:
    """Serialize a lightweight run-result summary for run_state.json.

    Some tests inject run-result-like objects that do not implement ``to_dict``.
    The recovery state only needs stable summary fields, not the full payload.
    """
    to_dict = getattr(run_result, "to_dict", None)
    if callable(to_dict):
        try:
            data = to_dict()
        except Exception:
            data = None
        if isinstance(data, dict):
            return data

    stdout = getattr(run_result, "stdout", "") or ""
    stderr = getattr(run_result, "stderr", "") or ""
    final_response = getattr(run_result, "final_response", "") or ""
    command_log = getattr(run_result, "command_log", []) or []
    return {
        "exit_code": getattr(run_result, "exit_code", None),
        "timed_out": bool(getattr(run_result, "timed_out", False)),
        "stdout_length": len(stdout),
        "stderr_length": len(stderr),
        "final_response_length": len(final_response),
        "command_count": len(command_log) if hasattr(command_log, "__len__") else 0,
        "elapsed_s": float(getattr(run_result, "elapsed_s", 0.0) or 0.0),
    }


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
        for current_root, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current_root)
            dirnames[:] = [
                dirname
                for dirname in dirnames
                if dirname not in SNAPSHOT_PRUNE_DIRS
                and not (current_path / dirname).is_symlink()
            ]
            for dirname in dirnames:
                snapshot.add(str(current_path / dirname))
            for filename in filenames:
                path = current_path / filename
                if path.is_symlink():
                    continue
                snapshot.add(str(path))

    return snapshot


def _pick_free_port() -> int:
    """Reserve an ephemeral local TCP port for clean-room validation."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _port_is_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _pick_trusted_local_auth_port() -> int | None:
    for port in TRUSTED_LOCAL_AUTH_PORTS:
        if _port_is_available(port):
            return port
    return None


def _load_boring_app_toml(project_root: Path) -> dict[str, Any]:
    toml_path = project_root / "boring.app.toml"
    if not toml_path.is_file():
        raise FileNotFoundError(f"Missing boring.app.toml at {toml_path}")
    with toml_path.open("rb") as handle:
        return tomllib.load(handle)


def _vault_kv_get_field(path: str, field: str) -> str:
    result = subprocess.run(
        ["vault", "kv", "get", f"-field={field}", path],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "unknown error").strip()
        raise RuntimeError(f"Cannot read Vault field {field} from {path}: {detail}")
    value = result.stdout.strip()
    if not value:
        raise RuntimeError(f"Vault field {field} at {path} was empty")
    return value


def _build_neon_local_dev_env(project_root: Path, port: int) -> dict[str, str]:
    config = _load_boring_app_toml(project_root)

    auth_cfg = config.get("auth")
    if not isinstance(auth_cfg, dict) or str(auth_cfg.get("provider", "")).strip().lower() != "neon":
        raise RuntimeError('Local validation requires [auth].provider = "neon"')

    deploy_cfg = config.get("deploy")
    if not isinstance(deploy_cfg, dict):
        raise RuntimeError("Local validation requires a [deploy] section")

    neon_cfg = deploy_cfg.get("neon")
    if not isinstance(neon_cfg, dict):
        raise RuntimeError("Local validation requires a [deploy.neon] section")

    auth_url = str(neon_cfg.get("auth_url", "")).strip()
    jwks_url = str(neon_cfg.get("jwks_url", "")).strip()
    if not auth_url or not jwks_url:
        raise RuntimeError("Local validation requires [deploy.neon].auth_url and jwks_url")

    deploy_secrets = deploy_cfg.get("secrets")
    if not isinstance(deploy_secrets, dict):
        raise RuntimeError("Local validation requires [deploy.secrets] Vault refs")

    resolved: dict[str, str] = {}
    for env_name in ("DATABASE_URL", "BORING_UI_SESSION_SECRET", "BORING_SETTINGS_KEY"):
        secret_ref = deploy_secrets.get(env_name)
        if not isinstance(secret_ref, dict):
            raise RuntimeError(f"Missing Vault ref for deploy secret {env_name}")
        vault_path = str(secret_ref.get("vault", "")).strip()
        field = str(secret_ref.get("field", "")).strip()
        if not vault_path or not field:
            raise RuntimeError(f"Deploy secret {env_name} must declare vault + field")
        resolved[env_name] = _vault_kv_get_field(vault_path, field)

    public_origin = f"http://127.0.0.1:{port}"
    resolved["NEON_AUTH_BASE_URL"] = auth_url
    resolved["NEON_AUTH_JWKS_URL"] = jwks_url
    resolved["BORING_UI_PUBLIC_ORIGIN"] = public_origin
    resolved["AUTH_SESSION_SECURE_COOKIE"] = "false"
    return resolved


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


def _http_json_request(
    url: str,
    *,
    method: str,
    payload: dict[str, Any] | None = None,
    timeout_s: float = 5.0,
) -> tuple[int | None, Any | None]:
    headers = {}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            body = response.read().decode("utf-8", errors="replace")
            try:
                return response.status, json.loads(body)
            except json.JSONDecodeError:
                return response.status, body
    except urllib.error.HTTPError as exc:
        payload_text = exc.read().decode("utf-8", errors="replace")
        try:
            body: Any = json.loads(payload_text)
        except json.JSONDecodeError:
            body = payload_text
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

    port = _pick_trusted_local_auth_port()
    if port is None:
        return (
            LocalDevContext(
                manifest,
                doctor_exit_code=doctor_exit,
                doctor_stdout=doctor_stdout,
                doctor_stderr=doctor_stderr,
                dev_started=False,
                dev_stderr=(
                    "No trusted local auth port available; checked "
                    + ", ".join(str(candidate) for candidate in TRUSTED_LOCAL_AUTH_PORTS)
                ),
            ),
            None,
        )

    dev_env = os.environ.copy()
    try:
        dev_env.update(_build_neon_local_dev_env(project_root, port))
    except Exception as exc:
        return (
            LocalDevContext(
                manifest,
                doctor_exit_code=doctor_exit,
                doctor_stdout=doctor_stdout,
                doctor_stderr=doctor_stderr,
                dev_started=False,
                dev_port=port,
                dev_stderr=str(exc),
            ),
            None,
        )

    with tempfile.TemporaryFile() as stdout_capture, tempfile.TemporaryFile() as stderr_capture:
        try:
            process = await asyncio.create_subprocess_exec(
                "bui",
                "dev",
                "--backend-only",
                "--port",
                str(port),
                cwd=str(project_root),
                env=dev_env,
                stdout=stdout_capture,
                stderr=stderr_capture,
                start_new_session=True,
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
        notes_create_status: int | None = None
        notes_create_response: dict[str, Any] | None = None
        notes_list_status: int | None = None
        notes_list_response: list[dict[str, Any]] | None = None
        notes_delete_status: int | None = None
        notes_delete_response: dict[str, Any] | None = None
        notes_after_delete_status: int | None = None
        notes_after_delete_response: list[dict[str, Any]] | None = None
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

            create_status, create_body = _http_json_request(
                f"{base_url}/notes",
                method="POST",
                payload={"text": f"local-eval-note-{manifest.eval_id}"},
                timeout_s=3.0,
            )
            notes_create_status = create_status
            if isinstance(create_body, dict):
                notes_create_response = create_body

            list_status, list_body = _http_probe(f"{base_url}/notes", timeout_s=3.0)
            notes_list_status = list_status
            if isinstance(list_body, list):
                notes_list_response = [item for item in list_body if isinstance(item, dict)]

            created_note_id = ""
            if isinstance(notes_create_response, dict):
                created_note_id = str(notes_create_response.get("id", "")).strip()
            if created_note_id:
                delete_status, delete_body = _http_json_request(
                    f"{base_url}/notes/{urllib.parse.quote(created_note_id)}",
                    method="DELETE",
                    timeout_s=3.0,
                )
                notes_delete_status = delete_status
                if isinstance(delete_body, dict):
                    notes_delete_response = delete_body

                after_delete_status, after_delete_body = _http_probe(f"{base_url}/notes", timeout_s=3.0)
                notes_after_delete_status = after_delete_status
                if isinstance(after_delete_body, list):
                    notes_after_delete_response = [item for item in after_delete_body if isinstance(item, dict)]

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
            _signal_subprocess_group(process, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=15)
                clean_shutdown = True
            except asyncio.TimeoutError:
                _signal_subprocess_group(process, signal.SIGKILL)
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass

        stdout_capture.seek(0)
        stderr_capture.seek(0)
        dev_stdout = stdout_capture.read().decode(errors="replace")
        dev_stderr = stderr_capture.read().decode(errors="replace")

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
            notes_create_response=notes_create_response,
            notes_create_status=notes_create_status,
            notes_list_response=notes_list_response,
            notes_list_status=notes_list_status,
            notes_delete_response=notes_delete_response,
            notes_delete_status=notes_delete_status,
            notes_after_delete_response=notes_after_delete_response,
            notes_after_delete_status=notes_after_delete_status,
            config_response=config_response,
            config_status=config_status,
            capabilities_response=capabilities_response,
            capabilities_status=capabilities_status,
            eval_tool_probes=eval_tool_probes,
            clean_shutdown=clean_shutdown,
        ),
        time_to_health,
    )


def _signal_subprocess_group(
    process: asyncio.subprocess.Process,
    sig: signal.Signals,
) -> None:
    pid = getattr(process, "pid", None)
    if pid:
        try:
            os.killpg(pid, sig)
            return
        except (ProcessLookupError, PermissionError):
            pass

    try:
        if sig == signal.SIGKILL:
            process.kill()
        else:
            process.send_signal(sig)
    except ProcessLookupError:
        pass


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

    completed_phases: list[str] = []

    def save_state(phase: str, **extra: Any) -> None:
        _save_run_state(evidence_dir, {
            "phase": phase,
            "eval_id": naming.eval_id,
            "profile": profile,
            "completed_phases": list(completed_phases),
            "manifest": manifest.to_dict(),
            **extra,
        })

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
    save_state("init")

    try:
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
        completed_phases.append("preflight")
        save_state("preflight_done", capability_issues=[i.to_dict() for i in cap_issues])

        # 3. Generate prompt
        logger.phase_start("prompt_generation")
        prompt = generate_prompt(manifest, profile)
        save_prompt(manifest, prompt)
        logger.phase_end("prompt_generation", f"{len(prompt)} chars")
        completed_phases.append("prompt_generation")
        save_state("prompt_generation_done")

        # Save manifest
        writer = EvidenceWriter(evidence_dir, registry)
        writer.write_json("run_manifest.json", manifest.to_dict(), redact=False)

        # 4. Run agent
        logger.phase_start("agent_execution")
        if runner is None:
            runner = _default_agent_runner(manifest)

        run_result = await runner.run(manifest, prompt, timeout_s=agent_timeout)
        await runner.cleanup()
        writer.write_run_result(run_result)
        logger.phase_end(
            "agent_execution",
            f"exit={run_result.exit_code} timed_out={run_result.timed_out} "
            f"elapsed={run_result.elapsed_s:.1f}s"
        )
        completed_phases.append("agent_execution")
        save_state(
            "agent_done",
            exit_code=run_result.exit_code,
            timed_out=run_result.timed_out,
            run_result=_serialize_run_result_summary(run_result),
        )

        # 5. Parse response
        report_output_text = _load_report_output_text(manifest)
        parsed_report_output = extract_report_json(report_output_text) if report_output_text else None
        if parsed_report_output:
            _persist_plain_report_output(manifest, parsed_report_output)
        if report_output_text and report_output_text not in run_result.final_response:
            report_block = report_output_text
            if BEGIN_MARKER not in report_output_text:
                report_block = f"{BEGIN_MARKER}\n{report_output_text.strip()}\n{END_MARKER}"
            combined = run_result.final_response.rstrip()
            if combined:
                combined = f"{combined}\n\n{report_block}"
            else:
                combined = report_block
            run_result.final_response = combined
            writer.write_text(
                "agent_final_response.txt",
                run_result.final_response,
                producer="agent",
            )

        logger.phase_start("parsing")
        parsed_report = extract_report_json(run_result.final_response)
        logger.phase_end("parsing", f"report={'found' if parsed_report else 'missing'}")
        completed_phases.append("parsing")
        save_state("parsing_done", report_found=parsed_report is not None)

        # 6. Run verification checks
        logger.phase_start("verification")
        check_order = _resolve_check_order(profile)
        effective_skip_reasons = dict(skip_reasons)
        if skip_deploy:
            for check_id in check_order:
                spec = CATALOG.get(check_id)
                if spec and spec.category == "deployment":
                    effective_skip_reasons[check_id] = "Skipped by --skip-deploy"

        try:
            local_ctx, time_to_local_health = await asyncio.wait_for(
                _run_local_dev_validation(
                    manifest,
                    timeout_s=verify_timeout,
                ),
                timeout=verify_timeout + 30,
            )
        except asyncio.TimeoutError:
            local_ctx = LocalDevContext(
                manifest,
                dev_started=False,
                dev_stderr=(
                    f"Local validation exceeded verification budget after {verify_timeout}s"
                ),
            )
            time_to_local_health = None

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
        completed_phases.append("verification")
        save_state("verification_done", check_count=len(checks))

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
        completed_phases.append("scoring")
        save_state(
            "scoring_done",
            status=eval_result.status.value,
            core_score=eval_result.core_score,
            overall_score=eval_result.overall_score,
        )

        # 8. Write evidence bundle
        logger.phase_start("evidence")
        write_evidence_bundle(manifest, eval_result, run_result, registry)
        logger.phase_end("evidence", "bundle written")
        completed_phases.append("evidence")
        save_state(
            "evidence_done",
            eval_result_path=str(Path(manifest.evidence_dir) / "eval_result.json"),
        )

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
            completed_phases.append("cleanup")
            save_state(
                "cleanup_done",
                cleanup_errors=[r.to_dict() for r in eval_result.cleanup_errors],
            )

        elapsed = time.monotonic() - start_time
        logger.info(
            f"Eval complete: {eval_result.status.value} "
            f"(core={eval_result.core_score:.0%}, elapsed={elapsed:.1f}s)"
        )
        completed_phases.append("complete")
        save_state(
            "complete",
            elapsed_s=elapsed,
            status=eval_result.status.value,
            core_score=eval_result.core_score,
            overall_score=eval_result.overall_score,
        )

        return eval_result
    except Exception as exc:
        logger.error(f"Eval failed: {exc}")
        save_state(
            "error",
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        raise


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
