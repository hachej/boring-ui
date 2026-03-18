"""Unit tests for `/api/v1/me*` control-plane routes."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app


def _client(
    tmp_path: Path,
    *,
    auth_dev_login_enabled: bool = True,
    control_plane_provider: str = "local",
) -> TestClient:
    config = APIConfig(
        workspace_root=tmp_path,
        auth_dev_login_enabled=auth_dev_login_enabled,
        auth_dev_auto_login=False,
        control_plane_provider=control_plane_provider,
        database_url=None,
        neon_auth_base_url=None,
        neon_auth_jwks_url=None,
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


def _login(client: TestClient, *, user_id: str = "user-1", email: str = "owner@example.com") -> None:
    response = client.get(
        f"/auth/login?user_id={user_id}&email={email}&redirect_uri=/",
        follow_redirects=False,
    )
    assert response.status_code == 302


def test_me_routes_are_mounted(tmp_path: Path) -> None:
    client = _client(tmp_path)
    paths = [route.path for route in client.app.routes if hasattr(route, "path")]
    assert "/api/v1/me" in paths
    assert "/api/v1/me/settings" in paths


def test_me_requires_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_REQUIRED"


def test_me_returns_identity_and_compat_fields(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="user-22", email="owner@example.com")

    response = client.get("/api/v1/me")
    assert response.status_code == 200
    payload = response.json()

    assert payload["ok"] is True
    assert payload["user_id"] == "user-22"
    assert payload["email"] == "owner@example.com"
    assert payload["user"]["email"] == "owner@example.com"
    assert payload["me"]["email"] == "owner@example.com"
    assert payload["data"]["email"] == "owner@example.com"


@pytest.mark.parametrize("control_plane_provider", ["local", "neon"])
def test_me_settings_round_trip(tmp_path: Path, control_plane_provider: str) -> None:
    client = _client(tmp_path, control_plane_provider=control_plane_provider)
    _login(client, user_id="user-33", email="settings@example.com")

    initial = client.get("/api/v1/me/settings")
    assert initial.status_code == 200
    assert initial.json()["settings"] == {}

    updated = client.put("/api/v1/me/settings", json={"theme": "dark", "shell": "zsh"})
    assert updated.status_code == 200
    assert updated.json()["settings"]["theme"] == "dark"

    loaded = client.get("/api/v1/me/settings")
    assert loaded.status_code == 200
    assert loaded.json()["settings"]["theme"] == "dark"
    assert loaded.json()["settings"]["shell"] == "zsh"
