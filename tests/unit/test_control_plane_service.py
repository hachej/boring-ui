from pathlib import Path

from boring_ui.api.modules.control_plane.repository import LocalControlPlaneRepository
from boring_ui.api.modules.control_plane.service import (
    ControlPlaneService,
    ensure_workspace_root_dir,
)


def test_ensure_workspace_root_dir_creates_workspace_subdirectory(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspaces"
    created = ensure_workspace_root_dir(workspace_root, "ws-123")

    assert created == workspace_root / "ws-123"
    assert created.is_dir()


def test_upsert_workspace_creates_workspace_directory(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspaces"
    state_path = tmp_path / "state.json"
    service = ControlPlaneService(
        LocalControlPlaneRepository(state_path),
        workspace_root=workspace_root,
    )

    stored = service.upsert_workspace("ws-abc", {"name": "Primary"})

    assert stored["workspace_id"] == "ws-abc"
    assert (workspace_root / "ws-abc").is_dir()
