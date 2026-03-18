"""Unit tests for canonical `/api/v1/workspaces*` control-plane routes."""

from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app


def _client(tmp_path: Path) -> TestClient:
    config = APIConfig(
        workspace_root=tmp_path,
        control_plane_provider="local",
        database_url=None,
        neon_auth_base_url=None,
        neon_auth_jwks_url=None,
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


def test_workspace_routes_are_mounted(tmp_path: Path) -> None:
    client = _client(tmp_path)
    paths = [route.path for route in client.app.routes if hasattr(route, "path")]
    assert "/api/v1/workspaces" in paths
    assert "/api/v1/workspaces/{workspace_id}/runtime" in paths
    assert "/api/v1/workspaces/{workspace_id}/runtime/retry" in paths
    assert "/api/v1/workspaces/{workspace_id}/settings" in paths


def test_workspace_create_and_list(tmp_path: Path) -> None:
    client = _client(tmp_path)

    created = client.post("/api/v1/workspaces", json={"name": "Primary"})
    assert created.status_code == 201
    payload = created.json()
    assert payload["ok"] is True
    assert payload["id"].startswith("ws-")
    assert payload["workspace"]["name"] == "Primary"
    assert payload["workspace"]["app_id"] == "boring-ui"

    listed = client.get("/api/v1/workspaces")
    assert listed.status_code == 200
    list_payload = listed.json()
    assert list_payload["ok"] is True
    assert list_payload["count"] == 1
    assert list_payload["workspaces"][0]["workspace_id"] == payload["id"]


def test_workspace_runtime_get_and_retry_is_idempotent(tmp_path: Path) -> None:
    client = _client(tmp_path)
    workspace_id = client.post("/api/v1/workspaces", json={"name": "Retry Test"}).json()["id"]

    runtime_get = client.get(f"/api/v1/workspaces/{workspace_id}/runtime")
    assert runtime_get.status_code == 200
    assert runtime_get.json()["runtime"]["state"] == "pending"

    first_retry = client.post(f"/api/v1/workspaces/{workspace_id}/runtime/retry")
    assert first_retry.status_code == 200
    first_payload = first_retry.json()
    assert first_payload["retried"] is True
    assert first_payload["runtime"]["state"] == "provisioning"
    assert first_payload["runtime"]["retry_count"] == 1

    second_retry = client.post(f"/api/v1/workspaces/{workspace_id}/runtime/retry")
    assert second_retry.status_code == 200
    second_payload = second_retry.json()
    assert second_payload["retried"] is False
    assert second_payload["runtime"]["state"] == "provisioning"
    assert second_payload["runtime"]["retry_count"] == 1


def test_workspace_settings_get_defaults_and_put_round_trip(tmp_path: Path) -> None:
    client = _client(tmp_path)
    workspace_id = client.post("/api/v1/workspaces").json()["id"]

    settings_get = client.get(f"/api/v1/workspaces/{workspace_id}/settings")
    assert settings_get.status_code == 200
    initial = settings_get.json()["settings"]
    assert initial["workspace_id"] == workspace_id

    settings_put = client.put(
        f"/api/v1/workspaces/{workspace_id}/settings",
        json={"theme": "dark", "shell": "zsh"},
    )
    assert settings_put.status_code == 200
    updated = settings_put.json()["settings"]
    assert updated["workspace_id"] == workspace_id
    assert updated["theme"] == "dark"
    assert updated["shell"] == "zsh"

    settings_get_again = client.get(f"/api/v1/workspaces/{workspace_id}/settings")
    assert settings_get_again.status_code == 200
    loaded = settings_get_again.json()["settings"]
    assert loaded["theme"] == "dark"
    assert loaded["shell"] == "zsh"
