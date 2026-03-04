"""Service layer for the control-plane foundation module."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .repository import ControlPlaneRepository


class ControlPlaneService:
    """Business-layer facade for control-plane aggregates."""

    def __init__(self, repository: ControlPlaneRepository, workspace_root: Path):
        self._repository = repository
        self._workspace_root = Path(workspace_root)

    def snapshot(self) -> dict[str, Any]:
        return self._repository.snapshot()

    def summary(self) -> dict[str, Any]:
        snapshot = self.snapshot()
        return {
            "workspace_root": str(self._workspace_root),
            "counts": {
                "users": len(snapshot.get("users", {})),
                "workspaces": len(snapshot.get("workspaces", {})),
                "memberships": len(snapshot.get("memberships", {})),
                "invites": len(snapshot.get("invites", {})),
                "workspace_settings": len(snapshot.get("workspace_settings", {})),
                "workspace_runtime": len(snapshot.get("workspace_runtime", {})),
            },
        }

    def upsert_user(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._repository.upsert_user(user_id, payload)

    def list_users(self) -> list[dict[str, Any]]:
        return self._repository.list_users()

    def upsert_workspace(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._repository.upsert_workspace(workspace_id, payload)

    def list_workspaces(self) -> list[dict[str, Any]]:
        return self._repository.list_workspaces()

    def upsert_membership(self, membership_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._repository.upsert_membership(membership_id, payload)

    def list_memberships(self) -> list[dict[str, Any]]:
        return self._repository.list_memberships()

    def upsert_invite(self, invite_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._repository.upsert_invite(invite_id, payload)

    def list_invites(self) -> list[dict[str, Any]]:
        return self._repository.list_invites()

    def set_workspace_settings(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._repository.set_workspace_settings(workspace_id, payload)

    def get_workspace_settings(self, workspace_id: str) -> dict[str, Any] | None:
        return self._repository.get_workspace_settings(workspace_id)

    def set_workspace_runtime(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._repository.set_workspace_runtime(workspace_id, payload)

    def get_workspace_runtime(self, workspace_id: str) -> dict[str, Any] | None:
        return self._repository.get_workspace_runtime(workspace_id)
