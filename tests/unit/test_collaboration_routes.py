"""Unit tests for canonical collaboration routes (/members* and /invites*)."""

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


def _create_workspace(client: TestClient, *, name: str = "Primary") -> str:
    response = client.post("/api/v1/workspaces", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


def test_collaboration_routes_are_mounted(tmp_path: Path) -> None:
    client = _client(tmp_path)
    paths = [route.path for route in client.app.routes if hasattr(route, "path")]
    assert "/api/v1/workspaces/{workspace_id}/members" in paths
    assert "/api/v1/workspaces/{workspace_id}/members/{user_id}" in paths
    assert "/api/v1/workspaces/{workspace_id}/invites" in paths
    assert "/api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept" in paths


def test_members_list_requires_active_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get("/api/v1/workspaces/ws-1/members")
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_REQUIRED"


def test_invite_acceptance_flow_creates_membership(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-1", email="owner@example.com")
    workspace_id = _create_workspace(client)

    invite_response = client.post(
        f"/api/v1/workspaces/{workspace_id}/invites",
        json={"email": "editor@example.com", "role": "editor"},
    )
    assert invite_response.status_code == 200
    invite = invite_response.json()["invite"]
    invite_id = invite["invite_id"]

    _login(client, user_id="editor-1", email="editor@example.com")
    accepted = client.post(f"/api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept")
    assert accepted.status_code == 200
    payload = accepted.json()
    assert payload["invite"]["status"] == "accepted"
    assert payload["membership"]["workspace_id"] == workspace_id
    assert payload["membership"]["user_id"] == "editor-1"
    assert payload["membership"]["role"] == "editor"

    _login(client, user_id="owner-1", email="owner@example.com")
    members = client.get(f"/api/v1/workspaces/{workspace_id}/members")
    assert members.status_code == 200
    ids = {item["user_id"] for item in members.json()["members"]}
    assert "owner-1" in ids
    assert "editor-1" in ids


def test_member_upsert_requires_owner_role(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-2", email="owner2@example.com")
    workspace_id = _create_workspace(client, name="Collab")
    invite_response = client.post(
        f"/api/v1/workspaces/{workspace_id}/invites",
        json={"email": "editor2@example.com", "role": "editor"},
    )
    invite_id = invite_response.json()["invite"]["invite_id"]

    _login(client, user_id="editor-2", email="editor2@example.com")
    accept = client.post(f"/api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept")
    assert accept.status_code == 200

    denied = client.put(
        f"/api/v1/workspaces/{workspace_id}/members/user-3",
        json={"role": "viewer", "email": "viewer@example.com"},
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == "ROLE_REQUIRED_OWNER"


def test_invite_accept_requires_matching_email(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _login(client, user_id="owner-3", email="owner3@example.com")
    workspace_id = _create_workspace(client, name="Mismatch")
    invite_response = client.post(
        f"/api/v1/workspaces/{workspace_id}/invites",
        json={"email": "target@example.com", "role": "viewer"},
    )
    invite_id = invite_response.json()["invite"]["invite_id"]

    _login(client, user_id="wrong-user", email="different@example.com")
    denied = client.post(f"/api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept")
    assert denied.status_code == 403
    assert denied.json()["code"] == "INVITE_EMAIL_MISMATCH"
