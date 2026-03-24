"""Test helper utilities for eval harness tests.

Provides synthetic project trees, config generation, fake HTTP servers,
and convenience functions for building test scenarios.
"""

from __future__ import annotations

import json
import socket
import textwrap
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from tests.eval.contracts import NamingContract, ObservedCommand, RunManifest
from tests.eval.report_schema import BEGIN_MARKER, END_MARKER


# ---------------------------------------------------------------------------
# Project tree builder
# ---------------------------------------------------------------------------

def make_project_tree(root: Path, files: dict[str, str]) -> None:
    """Create a fake project directory with *files*.

    *files* maps relative paths to content strings::

        make_project_tree(tmp, {
            "boring.app.toml": "[app]\\nname = \\"test\\"",
            "src/my_app/__init__.py": "",
            "src/my_app/routers/status.py": "...",
        })
    """
    for rel_path, content in files.items():
        full = root / rel_path
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")


def make_toml(
    root: Path,
    *,
    app_name: str = "test-app",
    app_id: str = "test-app",
    app_slug: str = "test-app",
    backend_entry: str = "test_app.api.app:create_app",
    deploy_platform: str = "fly",
    overrides: dict[str, Any] | None = None,
) -> str:
    """Generate a boring.app.toml and write it to *root*.

    Returns the TOML content string.
    """
    toml_content = textwrap.dedent(f"""\
        [app]
        name = "{app_name}"
        id = "{app_id}"
        logo = "T"

        [backend]
        entry = "{backend_entry}"

        [frontend.branding]
        name = "{app_name}"

        [deploy]
        platform = "{deploy_platform}"
    """)

    if overrides:
        for key, value in overrides.items():
            if isinstance(value, str):
                toml_content += f'\n{key} = "{value}"'
            elif isinstance(value, bool):
                toml_content += f"\n{key} = {'true' if value else 'false'}"
            elif isinstance(value, (int, float)):
                toml_content += f"\n{key} = {value}"

    toml_path = root / "boring.app.toml"
    toml_path.write_text(toml_content, encoding="utf-8")
    return toml_content


# ---------------------------------------------------------------------------
# Agent output builder
# ---------------------------------------------------------------------------

def make_agent_output(
    manifest: RunManifest,
    *,
    include_markers: bool = True,
    deployed_url: str = "",
    fly_app_name: str = "",
    neon_project_id: str = "",
    steps: dict[str, dict[str, Any]] | None = None,
    overrides: dict[str, Any] | None = None,
) -> str:
    """Generate synthetic agent stdout with embedded eval report.

    Returns a string containing human-readable summary + JSON block
    (optionally wrapped in BEGIN/END markers).
    """
    report: dict[str, Any] = {
        "eval_id": manifest.eval_id,
        "eval_spec_version": manifest.eval_spec_version,
        "report_schema_version": manifest.report_schema_version,
        "platform_profile": manifest.platform_profile,
        "verification_nonce": manifest.verification_nonce,
        "app_slug": manifest.app_slug,
        "project_root": manifest.project_root,
        "python_module": manifest.python_module,
        "deployed_url": deployed_url or f"https://{manifest.app_slug}.fly.dev",
        "fly_app_name": fly_app_name or manifest.app_slug,
        "neon_project_id": neon_project_id or "",
        "vault_secret_refs": [],
        "commands_run": ["bui init", "bui doctor", "bui deploy"],
        "steps": steps or {
            "scaffold": {"status": "succeeded", "attempted": True},
            "local_validate": {"status": "succeeded", "attempted": True},
            "neon_setup": {"status": "succeeded", "attempted": True},
            "deploy": {"status": "succeeded", "attempted": True},
        },
        "local_checks": [
            {"path": "/health", "status": 200},
            {"path": "/info", "status": 200},
        ],
        "live_checks": [
            {"path": "/health", "status": 200},
            {"path": "/info", "status": 200},
        ],
        "unverified_steps": [],
        "failures": [],
        "resource_inventory": {
            "fly_app_name": fly_app_name or manifest.app_slug,
            "neon_project_id": neon_project_id or "",
        },
        "timings_s": {"agent": 300.0},
        "known_issues": [],
    }

    if overrides:
        report.update(overrides)

    parts = [
        f"## Eval Report for {manifest.app_slug}\n",
        f"App deployed to https://{manifest.app_slug}.fly.dev\n",
    ]

    if include_markers:
        parts.append(f"\n{BEGIN_MARKER}")
        parts.append(json.dumps(report, indent=2))
        parts.append(f"{END_MARKER}\n")
    else:
        parts.append(f"\n```json\n{json.dumps(report, indent=2)}\n```\n")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Command log builder
# ---------------------------------------------------------------------------

def make_command_log(
    commands: list[dict[str, Any]] | None = None,
) -> list[ObservedCommand]:
    """Generate a list of ObservedCommand for testing.

    If *commands* is None, returns a default successful workflow.
    """
    if commands is None:
        commands = [
            {"command": "bui init test-app", "exit_code": 0, "phase": "scaffold"},
            {"command": "bui doctor", "exit_code": 0, "phase": "local_validation"},
            {"command": "bui dev --backend-only", "exit_code": 0, "phase": "local_validation"},
            {"command": "bui neon setup --region aws-eu-central-1 --email-provider none",
             "exit_code": 0, "phase": "neon_setup"},
            {"command": "bui deploy", "exit_code": 0, "phase": "deploy"},
        ]

    return [ObservedCommand(**c) for c in commands]


# ---------------------------------------------------------------------------
# FakeHTTPServer
# ---------------------------------------------------------------------------

class FakeHTTPServer:
    """Simple HTTP server that returns configured responses.

    Usage::

        server = FakeHTTPServer({
            "/health": (200, {"ok": True, "app": "test"}),
            "/info": (200, {"name": "test", "version": "0.1.0"}),
        })
        server.start()
        # ... run checks against server.url ...
        server.stop()

    Also usable as a context manager::

        with FakeHTTPServer({"/health": (200, {"ok": True})}) as server:
            resp = httpx.get(f"{server.url}/health")
    """

    def __init__(
        self,
        routes: dict[str, tuple[int, Any]],
        host: str = "127.0.0.1",
    ) -> None:
        self._routes = routes
        self._host = host
        self._port = _find_free_port()
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://{self._host}:{self._port}"

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> None:
        routes = self._routes

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                path = self.path.split("?")[0]
                if path in routes:
                    status, body = routes[path]
                    if isinstance(body, (dict, list)):
                        content = json.dumps(body).encode()
                        content_type = "application/json"
                    elif isinstance(body, str):
                        content = body.encode()
                        content_type = "text/html"
                    else:
                        content = str(body).encode()
                        content_type = "text/plain"
                    self.send_response(status)
                    self.send_header("Content-Type", content_type)
                    self.end_headers()
                    self.write = None  # type: ignore[assignment]
                    self.wfile.write(content)
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"Not Found")

            def log_message(self, *args: Any) -> None:
                pass  # suppress stderr

        self._server = HTTPServer((self._host, self._port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server = None
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> FakeHTTPServer:
        self.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.stop()


def _find_free_port() -> int:
    """Find an available TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
