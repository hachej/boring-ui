"""Runtime boot and deployment guardrails."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_FULL_APP = REPO_ROOT / "scripts" / "run_full_app.py"
RUN_FULL_APP_SH = REPO_ROOT / "scripts" / "run_full_app.sh"
RUN_BACKEND = REPO_ROOT / "scripts" / "run_backend.py"
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


def test_runtime_config_endpoint_supersedes_generated_frontend_env() -> None:
    app = create_app(config=APIConfig(workspace_root=REPO_ROOT))
    client = TestClient(app)

    response = client.get("/__bui/config")
    data = response.json()

    assert response.status_code == 200
    assert "frontend" in data
    assert "mode" in data["frontend"]
    assert "panels" in data["frontend"]


