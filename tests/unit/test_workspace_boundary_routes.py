"""Tests for `/w/{workspace_id}/...` workspace boundary precedence and proxying."""

from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app


def _client(tmp_path: Path) -> TestClient:
    config = APIConfig(
        workspace_root=tmp_path,
        auth_dev_login_enabled=True,
        auth_dev_auto_login=False,
        control_plane_provider="local",
        database_url=None,
        neon_auth_base_url=None,
        neon_auth_jwks_url=None,
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


def _login(client: TestClient, *, user_id: str, email: str) -> None:
    response = client.get(
        f"/auth/login?user_id={user_id}&email={email}&redirect_uri=/",
        follow_redirects=False,
    )
    assert response.status_code == 302


def _create_workspace(client: TestClient, *, name: str = "Boundary") -> str:
    response = client.post("/api/v1/workspaces", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


def _bootstrap_owner_membership(client: TestClient, workspace_id: str) -> None:
    response = client.get(f"/api/v1/workspaces/{workspace_id}/members")
    assert response.status_code == 200


def test_workspace_scoped_boundary_routes_are_mounted(tmp_path: Path) -> None:
    client = _client(tmp_path)
    paths = [route.path for route in client.app.routes if hasattr(route, "path")]
    assert "/w/{workspace_id}/setup" in paths
    assert "/w/{workspace_id}/runtime" in paths
    assert "/w/{workspace_id}/runtime/retry" in paths
    assert "/w/{workspace_id}/settings" in paths
    assert "/w/{workspace_id}/{path:path}" in paths


def test_workspace_scoped_proxy_requires_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get("/w/ws-1/api/v1/me")
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_REQUIRED"


def test_workspace_scoped_proxy_requires_membership(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-1", email="owner@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    _login(client, user_id="outsider-1", email="outsider@example.com")
    denied = client.get(f"/w/{workspace_id}/api/v1/me")
    assert denied.status_code == 403
    assert denied.json()["code"] == "WORKSPACE_MEMBERSHIP_REQUIRED"


def test_workspace_scoped_proxy_forwards_allowed_internal_paths(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-2", email="owner2@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    forwarded = client.get(f"/w/{workspace_id}/api/v1/me")
    assert forwarded.status_code == 200
    assert forwarded.json()["email"] == "owner2@example.com"


def test_workspace_scoped_proxy_forwards_filesystem_families(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-fs", email="owner-fs@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    listed = client.get(f"/w/{workspace_id}/api/v1/files/list?path=.")
    assert listed.status_code == 200
    assert "entries" in listed.json()

    git_status = client.get(f"/w/{workspace_id}/api/v1/git/status")
    assert git_status.status_code == 200


def test_workspace_scoped_root_route_allows_membership_verified_access(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-root", email="owner-root@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    response = client.get(f"/w/{workspace_id}/")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "workspace_id": workspace_id,
        "route": "root",
    }


def test_workspace_scoped_precedence_prefers_reserved_settings_route(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-3", email="owner3@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    updated = client.put(f"/w/{workspace_id}/settings", json={"theme": "dark"})
    assert updated.status_code == 200
    assert updated.json()["settings"]["theme"] == "dark"

    loaded = client.get(f"/w/{workspace_id}/settings")
    assert loaded.status_code == 200
    assert loaded.json()["settings"]["theme"] == "dark"


def test_workspace_scoped_proxy_denies_non_allowed_paths(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-4", email="owner4@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    denied = client.get(f"/w/{workspace_id}/internal/secret")
    assert denied.status_code == 404
    assert denied.json()["code"] == "WORKSPACE_PATH_DENIED"


def test_workspace_scoped_proxy_denies_macro_family(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-5", email="owner5@example.com")
    workspace_id = _create_workspace(client)
    _bootstrap_owner_membership(client, workspace_id)

    denied = client.get(f"/w/{workspace_id}/api/v1/macro/query")
    assert denied.status_code == 404
    assert denied.json()["code"] == "WORKSPACE_PATH_DENIED"
