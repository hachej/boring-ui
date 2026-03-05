"""Deployment script guardrails for core vs edge modes (bd-8lda)."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_FULL_APP = REPO_ROOT / "scripts" / "run_full_app.py"
RUN_FULL_APP_SH = REPO_ROOT / "scripts" / "run_full_app.sh"
RUN_BACKEND = REPO_ROOT / "scripts" / "run_backend.py"


def _load_run_full_app_module():
    spec = importlib.util.spec_from_file_location("run_full_app", RUN_FULL_APP)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_run_full_app_help_includes_deployment_flags() -> None:
    result = subprocess.run(
        [sys.executable, str(RUN_FULL_APP), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--deploy-mode" in result.stdout
    assert "--edge-proxy-url" in result.stdout
    assert "--ui-profile" in result.stdout


def test_run_full_app_shell_help_includes_deployment_flags() -> None:
    result = subprocess.run(
        ["bash", str(RUN_FULL_APP_SH), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--deploy-mode" in result.stdout
    assert "--edge-proxy-url" in result.stdout
    assert "--ui-profile" in result.stdout


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


def test_deployment_mode_resolution_prefers_cli_mode() -> None:
    module = _load_run_full_app_module()
    mode, proxy_url = module._resolve_deploy_mode(  # type: ignore[attr-defined]
        cli_mode="edge",
        cli_edge_proxy_url="http://127.0.0.1:8080/",
        cfg={"deployment": {"mode": "core", "edge_proxy_url": "http://ignored"}},
        env={"DEPLOY_MODE": "core"},
    )
    assert mode == "edge"
    assert proxy_url == "http://127.0.0.1:8080"


def test_deployment_mode_rejects_legacy_alias() -> None:
    module = _load_run_full_app_module()
    try:
        module._resolve_deploy_mode(  # type: ignore[attr-defined]
            cli_mode="sandbox-proxy",
            cli_edge_proxy_url=None,
            cfg={},
            env={},
        )
    except ValueError:
        return
    raise AssertionError("Expected ValueError for unsupported legacy deploy mode alias")


def test_deployment_mode_defaults_to_core() -> None:
    module = _load_run_full_app_module()
    mode, proxy_url = module._resolve_deploy_mode(  # type: ignore[attr-defined]
        cli_mode=None,
        cli_edge_proxy_url=None,
        cfg={},
        env={},
    )
    assert mode == "core"
    assert proxy_url is None


def test_frontend_env_core_mode_uses_backend_api_url() -> None:
    module = _load_run_full_app_module()
    fe_env = module._resolve_frontend_env(  # type: ignore[attr-defined]
        base_env={"DEPLOY_MODE": "core"},
        frontend_cfg={"vite_api_url": "http://127.0.0.1:9000"},
        deploy_mode="core",
        edge_proxy_url=None,
        backend_port=8000,
        ui_profile="pi-lightningfs",
    )
    assert fe_env["VITE_API_URL"] == "http://127.0.0.1:9000"
    assert "VITE_GATEWAY_URL" not in fe_env
    assert fe_env["VITE_UI_PROFILE"] == "pi-lightningfs"
    assert fe_env["VITE_AGENT_RAIL_MODE"] == "pi"
    assert fe_env["VITE_DATA_BACKEND"] == "lightningfs"


def test_frontend_env_core_mode_removes_stale_gateway_var() -> None:
    module = _load_run_full_app_module()
    fe_env = module._resolve_frontend_env(  # type: ignore[attr-defined]
        base_env={"DEPLOY_MODE": "core", "VITE_GATEWAY_URL": "http://stale"},
        frontend_cfg={"vite_api_url": "http://127.0.0.1:9000"},
        deploy_mode="core",
        edge_proxy_url=None,
        backend_port=8000,
        ui_profile="pi-lightningfs",
    )
    assert fe_env["VITE_API_URL"] == "http://127.0.0.1:9000"
    assert "VITE_GATEWAY_URL" not in fe_env


def test_frontend_env_edge_mode_points_api_to_proxy() -> None:
    module = _load_run_full_app_module()
    fe_env = module._resolve_frontend_env(  # type: ignore[attr-defined]
        base_env={"DEPLOY_MODE": "edge"},
        frontend_cfg={"vite_api_url": "http://127.0.0.1:9000"},
        deploy_mode="edge",
        edge_proxy_url="http://127.0.0.1:8080",
        backend_port=8000,
        ui_profile="companion-httpfs",
    )
    assert fe_env["VITE_API_URL"] == "http://127.0.0.1:8080"
    assert "VITE_GATEWAY_URL" not in fe_env
    assert fe_env["VITE_AGENT_RAIL_MODE"] == "companion"
    assert fe_env["VITE_DATA_BACKEND"] == "http"
