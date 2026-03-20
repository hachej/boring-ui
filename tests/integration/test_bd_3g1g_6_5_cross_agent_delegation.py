"""Cross-agent integration coverage for delegated boundary policy (bd-3g1g.6.5).

Goal: prove policy enforcement at owner services behaves consistently across all
agent runtimes (normal/companion/pi) when a delegated scope envelope is present.

We treat the `X-Scope-Context` header as the cross-agent contract boundary:
- Direct UI calls omit the header and remain unchanged.
- Delegated calls include the header and are deny-by-default unless capability
  claims satisfy the operation contract.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from boring_ui.api import APIConfig, create_app


AGENT_SERVICES = ("agent-normal", "agent-pi")


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    (tmp_path / "README.md").write_text("# Test Project\n", encoding="utf-8")
    return tmp_path


def _scope_headers(*, service: str, claims: list[str], session_id: str | None = None) -> dict[str, str]:
    payload: dict[str, object] = {
        "request_id": "req_test_1",
        "workspace_id": "ws_test_1",
        "actor": {"user_id": "u_test", "service": service, "role": "runtime"},
        "capability_claims": claims,
        "cwd_or_worktree": ".",
    }
    if session_id is not None:
        payload["session_id"] = session_id
    return {"X-Scope-Context": json.dumps(payload)}


def _assert_error_envelope(data: dict, expected_code: str) -> None:
    assert data["code"] == expected_code
    assert isinstance(data["message"], str) and data["message"]
    assert data["retryable"] is False
    details = data.get("details")
    assert isinstance(details, dict)
    assert details.get("request_id")
    assert details.get("workspace_id")


@pytest.mark.parametrize("service", AGENT_SERVICES)
def test_workspace_core_files_is_consistent_across_agents(service: str, workspace: Path) -> None:
    app = create_app(
        APIConfig(workspace_root=workspace),
        include_pty=False,
        include_stream=False,
        include_approval=False,
    )
    client = TestClient(app)

    # Allowed: read claim present.
    resp = client.get(
        "/api/v1/files/list",
        params={"path": "."},
        headers=_scope_headers(service=service, claims=["workspace.files.read"]),
    )
    assert resp.status_code == 200
    assert "entries" in resp.json()

    # Denied: write without write claim should not mutate.
    target = workspace / f"{service}.txt"
    assert not target.exists()
    resp = client.put(
        "/api/v1/files/write",
        params={"path": target.name},
        headers=_scope_headers(service=service, claims=["workspace.files.read"]),
        json={"content": "nope"},
    )
    assert resp.status_code == 403
    _assert_error_envelope(resp.json(), "capability_denied")
    assert not target.exists()


@pytest.mark.parametrize("service", AGENT_SERVICES)
def test_workspace_core_git_is_consistent_across_agents(service: str, workspace: Path) -> None:
    app = create_app(
        APIConfig(workspace_root=workspace),
        include_pty=False,
        include_stream=False,
        include_approval=False,
    )
    client = TestClient(app)

    # Allowed: git read claim present (workspace may or may not be a git repo).
    resp = client.get(
        "/api/v1/git/status",
        headers=_scope_headers(service=service, claims=["workspace.git.read"]),
    )
    assert resp.status_code == 200
    assert "is_repo" in resp.json()

    resp = client.get(
        "/api/v1/git/status",
        headers=_scope_headers(service=service, claims=["workspace.files.read"]),
    )
    assert resp.status_code == 403
    _assert_error_envelope(resp.json(), "capability_denied")


@pytest.mark.parametrize("service", AGENT_SERVICES)
def test_pty_lifecycle_is_consistent_across_agents(service: str, workspace: Path) -> None:
    app = create_app(
        APIConfig(workspace_root=workspace),
        include_stream=False,
        include_approval=False,
        include_pty=True,
    )
    client = TestClient(app)

    # Allowed: session start claim present.
    resp = client.post(
        "/api/v1/pty/sessions",
        headers=_scope_headers(service=service, claims=["pty.session.start"]),
    )
    assert resp.status_code == 200
    assert isinstance(resp.json().get("session_id"), str)

    # Allowed: list requires attach claim.
    resp = client.get(
        "/api/v1/pty/sessions",
        headers=_scope_headers(service=service, claims=["pty.session.attach"]),
    )
    assert resp.status_code == 200
    listed = resp.json()
    assert isinstance(listed.get("sessions"), list)

    resp = client.post(
        "/api/v1/pty/sessions",
        headers=_scope_headers(service=service, claims=["pty.session.attach"]),
    )
    assert resp.status_code == 403
    _assert_error_envelope(resp.json(), "capability_denied")


@pytest.mark.parametrize("service", AGENT_SERVICES)
def test_pty_ws_policy_denial_is_consistent_across_agents(service: str, workspace: Path) -> None:
    # We only exercise the denial path here, so the PTY process is never spawned.
    app = create_app(
        APIConfig(workspace_root=workspace),
        include_stream=False,
        include_approval=False,
        include_pty=True,
    )
    client = TestClient(app)

    sess = str(uuid.uuid4())
    headers = _scope_headers(service=service, claims=["pty.session.start"], session_id=sess)

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(
            f"/ws/pty?provider=shell&session_id={sess}",
            headers=headers,
        ) as ws:
            ws.receive_text()

    assert excinfo.value.code in (4004, 1008)
    reason = excinfo.value.reason or ""
    assert reason in ("", "policy:capability_denied")
