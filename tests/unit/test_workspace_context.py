"""Unit tests for request-scoped workspace context resolution."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from boring_ui.api.config import APIConfig
from boring_ui.api.modules.files import create_file_router
from boring_ui.api.modules.git import create_git_router
from boring_ui.api.modules.pty import router as pty_router_module
from boring_ui.api.modules.stream import router as stream_router_module
from boring_ui.api.storage import LocalStorage
from boring_ui.api.workspace import (
    WorkspaceContext,
    build_workspace_context_resolver,
    get_workspace_context,
    resolve_workspace_root,
)


def test_resolve_workspace_root_single_mode_uses_base_root(tmp_path: Path) -> None:
    assert resolve_workspace_root(tmp_path, "ws-1", single_mode=True) == tmp_path.resolve()


def test_resolve_workspace_root_multi_mode_uses_workspace_child(tmp_path: Path) -> None:
    assert resolve_workspace_root(tmp_path, "ws-1", single_mode=False) == (tmp_path / "ws-1").resolve()


def test_resolve_workspace_root_rejects_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="traversal"):
        resolve_workspace_root(tmp_path, "../escape", single_mode=False)


def test_resolve_workspace_root_rejects_nested_workspace_id(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="traversal"):
        resolve_workspace_root(tmp_path, "team/ws-1", single_mode=False)


def test_resolve_workspace_root_rejects_absolute_workspace_id(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="traversal"):
        resolve_workspace_root(tmp_path, "/tmp/ws-1", single_mode=False)


def test_workspace_context_dependency_resolves_path_param_in_hosted_mode(tmp_path: Path) -> None:
    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.state.workspace_context_resolver = build_workspace_context_resolver(config)

    @app.get("/w/{workspace_id}/ctx")
    async def ctx_info(ctx: WorkspaceContext = Depends(get_workspace_context)):
        return {
            "workspace_id": ctx.workspace_id,
            "root_path": str(ctx.root_path),
        }

    client = TestClient(app)
    response = client.get("/w/ws-1/ctx")
    assert response.status_code == 200
    assert response.json() == {
        "workspace_id": "ws-1",
        "root_path": str((tmp_path / "ws-1").resolve()),
    }


def test_workspace_context_resolver_populates_execution_backend(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    sentinel = object()
    monkeypatch.setattr(config, "create_execution_backend", lambda: sentinel)

    resolver = build_workspace_context_resolver(config)
    context = resolver.resolve("ws-1")

    assert context.execution_backend is sentinel


def test_file_router_uses_header_workspace_context_in_hosted_mode(tmp_path: Path) -> None:
    workspace_root = tmp_path / "ws-1"
    workspace_root.mkdir()
    (workspace_root / "note.txt").write_text("workspace note", encoding="utf-8")

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(create_file_router(config, LocalStorage(tmp_path)), prefix="/api/v1/files")

    client = TestClient(app)
    response = client.get(
        "/api/v1/files/read",
        params={"path": "note.txt"},
        headers={"x-workspace-id": "ws-1"},
    )
    assert response.status_code == 200
    assert response.json()["content"] == "workspace note"


def test_file_router_rejects_header_workspace_traversal_in_hosted_mode(tmp_path: Path) -> None:
    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(create_file_router(config, LocalStorage(tmp_path)), prefix="/api/v1/files")

    client = TestClient(app)
    response = client.get(
        "/api/v1/files/read",
        params={"path": "note.txt"},
        headers={"x-workspace-id": "../escape"},
    )

    assert response.status_code == 400
    assert "traversal" in response.json()["detail"].lower()


def test_git_router_uses_header_workspace_context_in_hosted_mode(tmp_path: Path) -> None:
    workspace_root = tmp_path / "ws-1"
    workspace_root.mkdir()
    subprocess.run(["git", "init"], cwd=workspace_root, capture_output=True, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=workspace_root, capture_output=True, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=workspace_root, capture_output=True, check=True)
    (workspace_root / "file.txt").write_text("hello", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=workspace_root, capture_output=True, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=workspace_root, capture_output=True, check=True)
    (workspace_root / "file.txt").write_text("updated", encoding="utf-8")

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(create_git_router(config), prefix="/api/v1/git")

    client = TestClient(app)
    response = client.get(
        "/api/v1/git/status",
        headers={"x-workspace-id": "ws-1"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["is_repo"] is True
    files_by_path = {entry["path"]: entry["status"] for entry in payload["files"]}
    assert files_by_path["file.txt"] == "M"


def test_pty_router_uses_workspace_context_for_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    workspace_root = tmp_path / "ws-1"
    workspace_root.mkdir()
    captured: dict[str, Path] = {}

    async def fake_ensure_cleanup_running():
        return None

    async def fake_get_or_create_session(*, session_id, command, cwd):
        captured["cwd"] = cwd
        raise ValueError("session-stopped")

    monkeypatch.setattr(pty_router_module._pty_service, "ensure_cleanup_running", fake_ensure_cleanup_running)
    monkeypatch.setattr(pty_router_module._pty_service, "get_or_create_session", fake_get_or_create_session)

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(pty_router_module.create_pty_router(config), prefix="/ws")

    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/pty", headers={"x-workspace-id": "ws-1"}):
            pass

    assert exc.value.code == 4004
    assert captured["cwd"] == workspace_root.resolve()


def test_pty_router_rejects_workspace_traversal(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    async def fake_ensure_cleanup_running():
        return None

    async def fail_if_called(*, session_id, command, cwd):
        raise AssertionError("PTY session should not start for traversal input")

    monkeypatch.setattr(pty_router_module._pty_service, "ensure_cleanup_running", fake_ensure_cleanup_running)
    monkeypatch.setattr(pty_router_module._pty_service, "get_or_create_session", fail_if_called)

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(pty_router_module.create_pty_router(config), prefix="/ws")

    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/pty", headers={"x-workspace-id": "../escape"}):
            pass

    assert exc.value.code == 4004


def test_stream_router_uses_workspace_context_for_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    workspace_root = tmp_path / "ws-1"
    workspace_root.mkdir()
    captured: dict[str, str] = {}

    async def fake_handle_stream_websocket(websocket, cmd="claude", base_args=None, cwd=None):
        captured["cwd"] = cwd
        await websocket.accept()
        await websocket.close()

    monkeypatch.setattr(stream_router_module, "handle_stream_websocket", fake_handle_stream_websocket)

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(stream_router_module.create_stream_router(config), prefix="/ws/agent/normal")

    client = TestClient(app)
    with client.websocket_connect("/ws/agent/normal/stream", headers={"x-workspace-id": "ws-1"}) as websocket:
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_text()

    assert captured["cwd"] == str(workspace_root.resolve())


def test_stream_router_propagates_request_id_to_websocket_state(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "ws-1"
    workspace_root.mkdir()
    captured: dict[str, str] = {}

    async def fake_handle_stream_websocket(websocket, cmd="claude", base_args=None, cwd=None):
        captured["request_id"] = websocket.state.request_id
        await websocket.accept()
        await websocket.close()

    monkeypatch.setattr(stream_router_module, "handle_stream_websocket", fake_handle_stream_websocket)

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(stream_router_module.create_stream_router(config), prefix="/ws/agent/normal")

    client = TestClient(app)
    with client.websocket_connect(
        "/ws/agent/normal/stream",
        headers={"x-workspace-id": "ws-1", "x-request-id": "req-stream-1"},
    ) as websocket:
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_text()

    assert captured["request_id"] == "req-stream-1"


def test_stream_router_rejects_workspace_traversal(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    async def fail_if_called(websocket, cmd="claude", base_args=None, cwd=None):
        raise AssertionError("stream handler should not start for traversal input")

    monkeypatch.setattr(stream_router_module, "handle_stream_websocket", fail_if_called)

    config = APIConfig(workspace_root=tmp_path, control_plane_provider="neon")
    app = FastAPI()
    app.include_router(stream_router_module.create_stream_router(config), prefix="/ws/agent/normal")

    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/agent/normal/stream", headers={"x-workspace-id": "../escape"}):
            pass

    assert exc.value.code == 4004
