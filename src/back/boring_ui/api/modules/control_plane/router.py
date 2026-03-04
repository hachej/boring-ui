"""Foundation routes for control-plane ownership in boring-ui core."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .repository import LocalControlPlaneRepository
from .service import ControlPlaneService


class MetadataPayload(BaseModel):
    """Generic metadata payload for bootstrapping control-plane entities."""

    data: dict[str, Any] = Field(default_factory=dict)
    model_config = {"extra": "forbid"}


def create_control_plane_router(config: APIConfig) -> APIRouter:
    """Create the control-plane foundation router."""

    router = APIRouter(tags=["control-plane"])
    state_path = config.validate_path(config.control_plane_state_relpath)
    state_path_display = str(state_path.relative_to(config.workspace_root.resolve()))
    repository = LocalControlPlaneRepository(state_path)
    service = ControlPlaneService(repository, workspace_root=config.workspace_root)

    @router.get("/health")
    def control_plane_health(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.health",
        )
        if deny is not None:
            return deny
        return {
            "ok": True,
            "storage": "local-json",
            "state_path": state_path_display,
            **service.summary(),
        }

    @router.get("/snapshot")
    def control_plane_snapshot(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.snapshot",
        )
        if deny is not None:
            return deny
        return {"ok": True, "snapshot": service.snapshot()}

    @router.get("/users")
    def list_users(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.user.list",
        )
        if deny is not None:
            return deny
        users = service.list_users()
        return {"ok": True, "users": users, "count": len(users)}

    @router.put("/users/{user_id}")
    def upsert_user(user_id: str, body: MetadataPayload, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.control-plane.user.upsert",
        )
        if deny is not None:
            return deny
        return {"ok": True, "user": service.upsert_user(user_id, body.data)}

    @router.get("/workspaces")
    def list_workspaces(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.workspace.list",
        )
        if deny is not None:
            return deny
        workspaces = service.list_workspaces()
        return {"ok": True, "workspaces": workspaces, "count": len(workspaces)}

    @router.put("/workspaces/{workspace_id}")
    def upsert_workspace(workspace_id: str, body: MetadataPayload, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.control-plane.workspace.upsert",
        )
        if deny is not None:
            return deny
        return {"ok": True, "workspace": service.upsert_workspace(workspace_id, body.data)}

    @router.get("/memberships")
    def list_memberships(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.membership.list",
        )
        if deny is not None:
            return deny
        memberships = service.list_memberships()
        return {"ok": True, "memberships": memberships, "count": len(memberships)}

    @router.put("/memberships/{membership_id}")
    def upsert_membership(membership_id: str, body: MetadataPayload, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.control-plane.membership.upsert",
        )
        if deny is not None:
            return deny
        return {"ok": True, "membership": service.upsert_membership(membership_id, body.data)}

    @router.get("/invites")
    def list_invites(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.invite.list",
        )
        if deny is not None:
            return deny
        invites = service.list_invites()
        return {"ok": True, "invites": invites, "count": len(invites)}

    @router.put("/invites/{invite_id}")
    def upsert_invite(invite_id: str, body: MetadataPayload, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.control-plane.invite.upsert",
        )
        if deny is not None:
            return deny
        return {"ok": True, "invite": service.upsert_invite(invite_id, body.data)}

    @router.put("/workspaces/{workspace_id}/settings")
    def set_workspace_settings(workspace_id: str, body: MetadataPayload, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.control-plane.workspace.settings",
        )
        if deny is not None:
            return deny
        return {
            "ok": True,
            "settings": service.set_workspace_settings(workspace_id, body.data),
        }

    @router.get("/workspaces/{workspace_id}/settings")
    def get_workspace_settings(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.workspace.settings.get",
        )
        if deny is not None:
            return deny
        settings = service.get_workspace_settings(workspace_id)
        if settings is None:
            raise HTTPException(404, f"workspace settings not found: {workspace_id}")
        return {"ok": True, "settings": settings}

    @router.put("/workspaces/{workspace_id}/runtime")
    def set_workspace_runtime(workspace_id: str, body: MetadataPayload, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.control-plane.workspace.runtime",
        )
        if deny is not None:
            return deny
        return {
            "ok": True,
            "runtime": service.set_workspace_runtime(workspace_id, body.data),
        }

    @router.get("/workspaces/{workspace_id}/runtime")
    def get_workspace_runtime(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.control-plane.workspace.runtime.get",
        )
        if deny is not None:
            return deny
        runtime = service.get_workspace_runtime(workspace_id)
        if runtime is None:
            raise HTTPException(404, f"workspace runtime not found: {workspace_id}")
        return {"ok": True, "runtime": runtime}

    return router
