"""Runtime boot and deployment guardrails."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_FULL_APP = REPO_ROOT / "scripts" / "run_full_app.py"
RUN_FULL_APP_SH = REPO_ROOT / "scripts" / "run_full_app.sh"
RUN_BACKEND = REPO_ROOT / "scripts" / "run_backend.py"
REHEARSE_PYTHON_ROLLBACK = REPO_ROOT / "scripts" / "rehearse_python_rollback.py"


def test_run_full_app_entrypoints_are_removed() -> None:
    assert not RUN_FULL_APP.exists()
    assert not RUN_FULL_APP_SH.exists()


def test_run_backend_help_includes_deploy_mode() -> None:
    result = subprocess.run(
        [sys.executable, str(RUN_BACKEND), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--deploy-mode" in result.stdout


def test_rehearse_python_rollback_help_mentions_dry_run() -> None:
    result = subprocess.run(
        [sys.executable, str(REHEARSE_PYTHON_ROLLBACK), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "--dry-run" in result.stdout
    assert "--print-hosted-commands" in result.stdout


def test_rehearse_python_rollback_dry_run_redacts_password_and_records_smoke(
    tmp_path: Path,
) -> None:
    summary_path = tmp_path / "rollback-summary.json"
    result = subprocess.run(
        [
            sys.executable,
            str(REHEARSE_PYTHON_ROLLBACK),
            "--dry-run",
            "--host",
            "0.0.0.0",
            "--skip-sync",
            "--skip-build",
            "--skip-signup",
            "--email",
            "user@example.com",
            "--password",
            "super-secret",
            "--recipient",
            "inbox@example.com",
            "--suites",
            "health,capabilities",
            "--include-agent-ws",
            "--summary-out",
            str(summary_path),
            "--print-hosted-commands",
            "--hosted-url",
            "https://rollback.example.com",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "LOCAL_PARITY_MODE=http" in result.stdout
    assert "shared-smoke:" in result.stdout
    assert "super-secret" not in result.stdout
    assert "<redacted>" in result.stdout
    assert "--base-url http://127.0.0.1:5176" in result.stdout

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["dry_run"] is True
    assert len(summary["phases"]) == 2
    assert summary["phases"][1]["name"] == "shared-smoke"
    password_index = summary["phases"][1]["command"].index("--password")
    assert summary["phases"][1]["command"][password_index + 1] == "<redacted>"
    assert "super-secret" not in summary["hosted_commands"][2]
    assert "<redacted>" in summary["hosted_commands"][2]
    assert "--base-url https://rollback.example.com" in summary["hosted_commands"][2]


def test_runtime_config_endpoint_supersedes_generated_frontend_env() -> None:
    app = create_app(config=APIConfig(workspace_root=REPO_ROOT))
    client = TestClient(app)

    response = client.get("/__bui/config")
    data = response.json()

    assert response.status_code == 200
    assert "frontend" in data
    assert "mode" in data["frontend"]
    assert "panels" in data["frontend"]
