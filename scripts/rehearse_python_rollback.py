#!/usr/bin/env python3
"""Rehearse the Python rollback path with the shared smoke runner.

This script turns the manual rollback-rehearsal runbook into a single entrypoint:

1. Sync Python deps (`uv sync --frozen --no-dev`)
2. Build the frontend (`npm run build`)
3. Boot the Python runtime app with local parity env enabled
4. Run the shared smoke matrix against that Python app

Use `--dry-run` to inspect the assembled commands without executing them.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence
from urllib.error import URLError
from urllib.request import urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKSPACE_ROOT = "/tmp/boring-ui-rollback-workspaces"
SENSITIVE_FLAGS = {"--password"}


@dataclass
class PhaseResult:
    name: str
    ok: bool
    elapsed_s: float
    command: list[str] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5176)
    parser.add_argument("--base-url", default="", help="Smoke target URL (defaults to http://<host>:<port>)")
    parser.add_argument(
        "--public-origin",
        default="",
        help="Trusted public origin for Neon callbacks (defaults to --base-url)",
    )
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--workspace-root", default=DEFAULT_WORKSPACE_ROOT)
    parser.add_argument("--static-dir", default=str(REPO_ROOT / "dist"))
    parser.add_argument("--app-toml", default=str(REPO_ROOT / "boring.app.toml"))
    parser.add_argument("--backend-timeout", type=int, default=30)
    parser.add_argument("--timeout", type=int, default=180, help="Smoke auth/email timeout")
    parser.add_argument("--suite-timeout", type=int, default=300)
    parser.add_argument("--suites", default="")
    parser.add_argument("--skip-suites", default="")
    parser.add_argument("--include-agent-ws", action="store_true")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email", default="")
    parser.add_argument("--password", default="")
    parser.add_argument("--recipient", default="")
    parser.add_argument("--evidence-dir", default="")
    parser.add_argument("--summary-out", default="")
    parser.add_argument("--skip-sync", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-smoke", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--print-hosted-commands",
        action="store_true",
        help="Print the matching hosted Fly deploy + smoke commands after the local sequence",
    )
    parser.add_argument("--fly-app", default="boring-ui-frontend-agent")
    parser.add_argument("--fly-config", default="deploy/fly/fly.frontend-agent.toml")
    parser.add_argument("--hosted-url", default="")
    return parser.parse_args()


def redact_command(parts: Sequence[str]) -> list[str]:
    redacted: list[str] = []
    redact_next = False
    for part in parts:
        if redact_next:
            redacted.append("<redacted>")
            redact_next = False
            continue
        redacted.append(part)
        if part in SENSITIVE_FLAGS:
            redact_next = True
    return redacted


def render_command(parts: Sequence[str]) -> str:
    return " ".join(shlex.quote(part) for part in redact_command(parts))


def resolve_base_url(args: argparse.Namespace) -> str:
    if args.base_url:
        return args.base_url.rstrip("/")
    host = args.host
    if host in {"0.0.0.0", "::"}:
        host = "127.0.0.1"
    return f"http://{host}:{args.port}"


def resolve_public_origin(args: argparse.Namespace, base_url: str) -> str:
    return (args.public_origin or base_url).rstrip("/")


def build_runtime_env(
    args: argparse.Namespace,
    *,
    public_origin: str,
) -> tuple[dict[str, str], dict[str, str]]:
    env = os.environ.copy()
    pythonpath_parts = [str(REPO_ROOT / "src" / "back")]
    existing_pythonpath = env.get("PYTHONPATH", "").strip()
    if existing_pythonpath:
        pythonpath_parts.append(existing_pythonpath)

    overrides = {
        "LOCAL_PARITY_MODE": "http",
        "AUTH_SESSION_SECURE_COOKIE": "false",
        "BORING_UI_PUBLIC_ORIGIN": public_origin,
        "BORING_UI_STATIC_DIR": str(Path(args.static_dir)),
        "BORING_UI_WORKSPACE_ROOT": str(Path(args.workspace_root)),
        "BUI_APP_TOML": str(Path(args.app_toml)),
        "PYTHONPATH": os.pathsep.join(pythonpath_parts),
    }
    env.update(overrides)
    return env, overrides


def build_server_command(args: argparse.Namespace) -> list[str]:
    return [
        "uv",
        "run",
        "python",
        "-m",
        "uvicorn",
        "boring_ui.runtime:app",
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]


def build_smoke_command(
    args: argparse.Namespace,
    *,
    base_url: str,
    public_origin: str,
) -> list[str]:
    command = [
        "uv",
        "run",
        "python",
        "tests/smoke/run_all.py",
        "--base-url",
        base_url,
        "--auth-mode",
        args.auth_mode,
        "--public-origin",
        public_origin,
        "--timeout",
        str(args.timeout),
        "--suite-timeout",
        str(args.suite_timeout),
    ]
    if args.neon_auth_url:
        command.extend(["--neon-auth-url", args.neon_auth_url])
    if args.skip_signup:
        command.append("--skip-signup")
    if args.email:
        command.extend(["--email", args.email])
    if args.password:
        command.extend(["--password", args.password])
    if args.recipient:
        command.extend(["--recipient", args.recipient])
    if args.suites:
        command.extend(["--suites", args.suites])
    if args.skip_suites:
        command.extend(["--skip-suites", args.skip_suites])
    if args.include_agent_ws:
        command.append("--include-agent-ws")
    if args.evidence_dir:
        command.extend(["--evidence-dir", args.evidence_dir])
    return command


def run_phase(
    name: str,
    command: Sequence[str],
    *,
    env: dict[str, str] | None = None,
    dry_run: bool = False,
) -> PhaseResult:
    print(f"[rollback] {name}: {render_command(command)}")
    if dry_run:
        return PhaseResult(name=name, ok=True, elapsed_s=0.0, command=redact_command(command))
    started = time.monotonic()
    result = subprocess.run(list(command), cwd=REPO_ROOT, env=env, check=False)
    elapsed = time.monotonic() - started
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    return PhaseResult(name=name, ok=True, elapsed_s=elapsed, command=redact_command(command))


def wait_for_health(base_url: str, timeout_s: int, server: subprocess.Popen[str]) -> PhaseResult:
    started = time.monotonic()
    health_url = f"{base_url.rstrip('/')}/health"
    last_error = "health check did not complete"
    while time.monotonic() - started < timeout_s:
        if server.poll() is not None:
            raise RuntimeError(f"backend exited before becoming healthy (code {server.returncode})")
        try:
            with urlopen(health_url, timeout=2) as response:  # noqa: S310 - fixed localhost/explicit URL from caller
                if 200 <= response.status < 300:
                    elapsed = time.monotonic() - started
                    print(f"[rollback] backend-ready: {health_url} ({elapsed:.1f}s)")
                    return PhaseResult(name="backend-ready", ok=True, elapsed_s=elapsed)
                last_error = f"unexpected status {response.status}"
        except URLError as exc:
            last_error = str(exc)
        time.sleep(0.5)
    raise RuntimeError(f"backend did not become healthy within {timeout_s}s ({last_error})")


def terminate_process(server: subprocess.Popen[str]) -> None:
    if server.poll() is not None:
        return
    server.send_signal(signal.SIGTERM)
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)


def write_summary(summary_out: str, payload: dict[str, object]) -> None:
    if not summary_out:
        return
    output_path = Path(summary_out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def print_overrides(overrides: dict[str, str]) -> None:
    print("[rollback] env overrides:")
    for key in sorted(overrides):
        print(f"  {key}={overrides[key]}")


def print_hosted_commands(
    args: argparse.Namespace,
    *,
    public_origin: str,
) -> list[str]:
    commands = [
        f"bash deploy/fly/fly.secrets.sh {shlex.quote(args.fly_app)}",
        f"fly deploy -c {shlex.quote(args.fly_config)} --remote-only",
    ]
    if args.hosted_url:
        hosted_smoke = build_smoke_command(
            args,
            base_url=args.hosted_url.rstrip("/"),
            public_origin=public_origin if args.public_origin else args.hosted_url.rstrip("/"),
        )
        commands.append(render_command(hosted_smoke))
    print("[rollback] hosted commands:")
    for command in commands:
        print(f"  {command}")
    return commands


def main() -> int:
    args = parse_args()
    base_url = resolve_base_url(args)
    public_origin = resolve_public_origin(args, base_url)
    env, overrides = build_runtime_env(args, public_origin=public_origin)

    summary: dict[str, object] = {
        "base_url": base_url,
        "public_origin": public_origin,
        "auth_mode": args.auth_mode,
        "dry_run": args.dry_run,
        "phases": [],
        "env_overrides": overrides,
    }

    print_overrides(overrides)

    if args.print_hosted_commands:
        summary["hosted_commands"] = print_hosted_commands(args, public_origin=public_origin)

    phases: list[PhaseResult] = []
    total_started = time.monotonic()

    if not args.skip_sync:
        phases.append(
            run_phase(
                "uv-sync",
                ["uv", "sync", "--frozen", "--no-dev"],
                env=env,
                dry_run=args.dry_run,
            )
        )

    if not args.skip_build:
        phases.append(
            run_phase(
                "frontend-build",
                ["npm", "run", "build"],
                env=env,
                dry_run=args.dry_run,
            )
        )

    server_command = build_server_command(args)
    print(f"[rollback] backend-start: {render_command(server_command)}")
    if args.dry_run:
        phases.append(
            PhaseResult(
                name="backend-start",
                ok=True,
                elapsed_s=0.0,
                command=redact_command(server_command),
            )
        )
        if not args.skip_smoke:
            phases.append(
                run_phase(
                    "shared-smoke",
                    build_smoke_command(args, base_url=base_url, public_origin=public_origin),
                    env=env,
                    dry_run=True,
                )
            )
    else:
        server = subprocess.Popen(
            server_command,
            cwd=REPO_ROOT,
            env=env,
            text=True,
        )
        try:
            phases.append(
                PhaseResult(
                    name="backend-start",
                    ok=True,
                    elapsed_s=0.0,
                    command=redact_command(server_command),
                )
            )
            phases.append(wait_for_health(base_url, args.backend_timeout, server))
            if not args.skip_smoke:
                phases.append(
                    run_phase(
                        "shared-smoke",
                        build_smoke_command(args, base_url=base_url, public_origin=public_origin),
                        env=env,
                        dry_run=False,
                    )
                )
        finally:
            terminate_process(server)

    total_elapsed = time.monotonic() - total_started
    summary["phases"] = [asdict(phase) for phase in phases]
    summary["total_elapsed_s"] = round(total_elapsed, 1)

    write_summary(args.summary_out, summary)
    print(f"[rollback] total elapsed: {total_elapsed:.1f}s")
    if args.summary_out:
        print(f"[rollback] summary written to {args.summary_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
