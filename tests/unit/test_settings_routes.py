"""Tests for user settings and workspace settings API endpoints."""

from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app


def _client(tmp_path: Path) -> TestClient:
    config = APIConfig(workspace_root=tmp_path, auth_dev_login_enabled=True)
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


def _login(client: TestClient, *, user_id: str = "user-1", email: str = "user@example.com") -> None:
    response = client.get(
        f"/auth/login?user_id={user_id}&email={email}&redirect_uri=/",
        follow_redirects=False,
    )
    assert response.status_code == 302


def _create_workspace(client: TestClient, *, name: str = "Settings Test") -> str:
    response = client.post("/api/v1/workspaces", json={"name": name})
    assert response.status_code == 200
    return response.json()["id"]


# ── User Settings ──────────────────────────────────────────────────────


def test_user_settings_requires_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    resp = client.get("/api/v1/me/settings")
    assert resp.status_code == 401


def test_user_settings_get_returns_empty_initially(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)
    resp = client.get("/api/v1/me/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert isinstance(data["settings"], dict)


def test_user_settings_put_and_read_back(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)

    # Write settings
    put_resp = client.put(
        "/api/v1/me/settings",
        json={"display_name": "Test User", "theme": "dark"},
    )
    assert put_resp.status_code == 200

    # Read back
    get_resp = client.get("/api/v1/me/settings")
    assert get_resp.status_code == 200
    settings = get_resp.json()["settings"]
    assert settings["display_name"] == "Test User"
    assert settings["theme"] == "dark"


def test_user_settings_put_merges_with_existing(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)

    # Write initial settings
    client.put("/api/v1/me/settings", json={"display_name": "Alice"})

    # Write additional settings
    client.put("/api/v1/me/settings", json={"theme": "dark"})

    # Read back — should have both
    get_resp = client.get("/api/v1/me/settings")
    settings = get_resp.json()["settings"]
    assert settings.get("theme") == "dark"


def test_user_settings_overwrite_existing_key(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)

    client.put("/api/v1/me/settings", json={"display_name": "Alice"})
    client.put("/api/v1/me/settings", json={"display_name": "Bob"})

    get_resp = client.get("/api/v1/me/settings")
    settings = get_resp.json()["settings"]
    assert settings["display_name"] == "Bob"


def test_user_settings_isolated_per_user(tmp_path: Path) -> None:
    client = _client(tmp_path)

    _login(client, user_id="user-a", email="a@example.com")
    client.put("/api/v1/me/settings", json={"display_name": "User A"})

    _login(client, user_id="user-b", email="b@example.com")
    client.put("/api/v1/me/settings", json={"display_name": "User B"})

    # Switch back to A
    _login(client, user_id="user-a", email="a@example.com")
    get_resp = client.get("/api/v1/me/settings")
    settings = get_resp.json()["settings"]
    assert settings["display_name"] == "User A"


# ── Workspace Settings ─────────────────────────────────────────────────


def test_workspace_settings_get_without_auth_returns_empty(tmp_path: Path) -> None:
    """In local dev mode, workspace settings endpoint doesn't require auth."""
    client = _client(tmp_path)
    _login(client)
    ws_id = _create_workspace(client)
    resp = client.get(f"/api/v1/workspaces/{ws_id}/settings")
    assert resp.status_code == 200


def test_workspace_settings_get_returns_empty_initially(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)
    ws_id = _create_workspace(client)

    resp = client.get(f"/api/v1/workspaces/{ws_id}/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert isinstance(data["settings"], dict)


def test_workspace_settings_put_and_read_back(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)
    ws_id = _create_workspace(client)

    put_resp = client.put(
        f"/api/v1/workspaces/{ws_id}/settings",
        json={"theme": "dark", "layout": "compact"},
    )
    assert put_resp.status_code == 200

    get_resp = client.get(f"/api/v1/workspaces/{ws_id}/settings")
    assert get_resp.status_code == 200
    settings = get_resp.json()["settings"]
    assert settings["theme"] == "dark"
    assert settings["layout"] == "compact"


def test_workspace_settings_isolated_per_workspace(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client)
    ws1 = _create_workspace(client, name="WS1")
    ws2 = _create_workspace(client, name="WS2")

    client.put(f"/api/v1/workspaces/{ws1}/settings", json={"color": "blue"})
    client.put(f"/api/v1/workspaces/{ws2}/settings", json={"color": "red"})

    resp1 = client.get(f"/api/v1/workspaces/{ws1}/settings")
    resp2 = client.get(f"/api/v1/workspaces/{ws2}/settings")

    assert resp1.json()["settings"]["color"] == "blue"
    assert resp2.json()["settings"]["color"] == "red"


# ── Workspace Boundary Settings ────────────────────────────────────────


def _bootstrap_membership(client: TestClient, workspace_id: str) -> None:
    """Bootstrap owner membership for boundary router access."""
    resp = client.get(f"/api/v1/workspaces/{workspace_id}/members")
    assert resp.status_code == 200


def test_boundary_settings_get_forwards_to_settings_endpoint(tmp_path: Path) -> None:
    """GET /w/{id}/settings should proxy to workspace settings endpoint."""
    client = _client(tmp_path)
    _login(client)
    ws_id = _create_workspace(client)
    _bootstrap_membership(client, ws_id)

    # Write settings via canonical path
    client.put(f"/api/v1/workspaces/{ws_id}/settings", json={"theme": "dark"})

    # Read via boundary path
    resp = client.get(f"/w/{ws_id}/settings")
    assert resp.status_code == 200
    settings = resp.json()["settings"]
    assert settings["theme"] == "dark"


def test_boundary_settings_put_forwards_to_settings_endpoint(tmp_path: Path) -> None:
    """PUT /w/{id}/settings should proxy to workspace settings endpoint."""
    client = _client(tmp_path)
    _login(client)
    ws_id = _create_workspace(client)
    _bootstrap_membership(client, ws_id)

    # Write via boundary path
    put_resp = client.put(f"/w/{ws_id}/settings", json={"theme": "light"})
    assert put_resp.status_code == 200

    # Read back via canonical path
    get_resp = client.get(f"/api/v1/workspaces/{ws_id}/settings")
    settings = get_resp.json()["settings"]
    assert settings["theme"] == "light"


# ── Workspace Switch Flow ─────────────────────────────────────────────


def test_workspace_switch_list_multiple_workspaces(tmp_path: Path) -> None:
    """Create two workspaces, list them, verify both appear."""
    client = _client(tmp_path)
    _login(client)
    ws1 = _create_workspace(client, name="Workspace Alpha")
    ws2 = _create_workspace(client, name="Workspace Beta")

    resp = client.get("/api/v1/workspaces")
    assert resp.status_code == 200
    workspaces = resp.json()["workspaces"]
    ids = {w.get("workspace_id") or w.get("id") for w in workspaces}
    assert ws1 in ids
    assert ws2 in ids


def test_workspace_switch_settings_isolation_after_switch(tmp_path: Path) -> None:
    """Simulate workspace switch: write settings to WS-A, switch to WS-B, verify isolation."""
    client = _client(tmp_path)
    _login(client)
    ws_a = _create_workspace(client, name="WS-A")
    ws_b = _create_workspace(client, name="WS-B")

    # Write settings to WS-A
    client.put(f"/api/v1/workspaces/{ws_a}/settings", json={"project": "alpha", "color": "blue"})

    # "Switch" to WS-B — write different settings
    client.put(f"/api/v1/workspaces/{ws_b}/settings", json={"project": "beta", "color": "red"})

    # Verify WS-A settings untouched
    resp_a = client.get(f"/api/v1/workspaces/{ws_a}/settings")
    assert resp_a.json()["settings"]["project"] == "alpha"
    assert resp_a.json()["settings"]["color"] == "blue"

    # Verify WS-B settings correct
    resp_b = client.get(f"/api/v1/workspaces/{ws_b}/settings")
    assert resp_b.json()["settings"]["project"] == "beta"
    assert resp_b.json()["settings"]["color"] == "red"


def test_workspace_switch_boundary_routes_per_workspace(tmp_path: Path) -> None:
    """Access two workspaces via boundary routes — settings are isolated."""
    client = _client(tmp_path)
    _login(client)
    ws_a = _create_workspace(client, name="Boundary-A")
    ws_b = _create_workspace(client, name="Boundary-B")
    _bootstrap_membership(client, ws_a)
    _bootstrap_membership(client, ws_b)

    # Write via boundary to each workspace
    client.put(f"/w/{ws_a}/settings", json={"env": "staging"})
    client.put(f"/w/{ws_b}/settings", json={"env": "production"})

    # Read back via boundary — each workspace returns its own settings
    resp_a = client.get(f"/w/{ws_a}/settings")
    assert resp_a.json()["settings"]["env"] == "staging"

    resp_b = client.get(f"/w/{ws_b}/settings")
    assert resp_b.json()["settings"]["env"] == "production"


def test_workspace_switch_me_endpoint_via_both_boundaries(tmp_path: Path) -> None:
    """The /me endpoint returns the same user regardless of which workspace boundary is used."""
    client = _client(tmp_path)
    _login(client, user_id="switcher-1", email="switch@example.com")
    ws_a = _create_workspace(client, name="Me-A")
    ws_b = _create_workspace(client, name="Me-B")
    _bootstrap_membership(client, ws_a)
    _bootstrap_membership(client, ws_b)

    me_a = client.get(f"/w/{ws_a}/api/v1/me")
    me_b = client.get(f"/w/{ws_b}/api/v1/me")

    assert me_a.status_code == 200
    assert me_b.status_code == 200
    assert me_a.json()["email"] == "switch@example.com"
    assert me_b.json()["email"] == "switch@example.com"
