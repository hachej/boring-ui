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
PROD_COMPOSE = REPO_ROOT / "deploy" / "docker-compose.prod.yml"

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


def test_prod_compose_reads_backend_secrets_from_env_file() -> None:
    contents = PROD_COMPOSE.read_text(encoding="utf-8")

    assert "env_file:" in contents
    assert "${BUI_BACKEND_ENV_FILE:-/dev/null}" in contents
    assert "DATABASE_URL: ${DATABASE_URL:-}" not in contents


def test_prod_compose_does_not_hard_require_kvm() -> None:
    contents = PROD_COMPOSE.read_text(encoding="utf-8")

    assert "/dev/kvm" not in contents


def test_prod_compose_mounts_host_workspace_volume() -> None:
    contents = PROD_COMPOSE.read_text(encoding="utf-8")

    assert "${BORING_UI_WORKSPACES_HOST_PATH:-/data/workspaces}:/data/workspaces" in contents


def test_prod_compose_uses_prod_caddyfile_by_default() -> None:
    contents = PROD_COMPOSE.read_text(encoding="utf-8")

    assert "${BUI_CADDYFILE:-./python/Caddyfile.prod}" in contents


def test_prod_compose_caddy_healthcheck_uses_internal_http_probe() -> None:
    contents = PROD_COMPOSE.read_text(encoding="utf-8")

    assert 'test: ["CMD-SHELL", "wget -q --spider --header=\\"Host: ${BUI_HOSTNAME:-localhost}\\" http://127.0.0.1/healthz"]' in contents
