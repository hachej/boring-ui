"""Canonical workspace lifecycle/settings routes owned by boring-ui control-plane."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException, Request, status

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .auth_session import SessionExpired, SessionInvalid, parse_session_cookie
from .repository import LocalControlPlaneRepository
from .service import ControlPlaneService
from .user_settings_state import read_user_github_link, user_state_service


def _workspace_service(config: APIConfig) -> ControlPlaneService:
    state_path = config.validate_path(config.control_plane_state_relpath)
    repository = LocalControlPlaneRepository(state_path)
    return ControlPlaneService(repository, workspace_root=config.workspace_root)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_session_optional(request: Request, config: APIConfig):
    token = request.cookies.get(config.auth_session_cookie_name, "")
    if not token:
        return None
    try:
        return parse_session_cookie(token, secret=config.auth_session_secret)
    except (SessionExpired, SessionInvalid):
        return None


def _ensure_workspace_exists(
    service: ControlPlaneService,
    workspace_id: str,
    *,
    name: str | None = None,
) -> dict[str, Any]:
    existing = next(
        (workspace for workspace in service.list_workspaces() if workspace.get("workspace_id") == workspace_id),
        None,
    )
    if existing is not None:
        return existing
    payload: dict[str, Any] = {}
    if name:
        payload["name"] = name
    return service.upsert_workspace(workspace_id, payload)


def create_workspace_router(config: APIConfig) -> APIRouter:
    """Create canonical `/api/v1/workspaces*` routes."""

    router = APIRouter(tags=["workspaces"])
    service = _workspace_service(config)
    user_service = user_state_service(config)

    @router.get("/workspaces")
    def list_workspaces(request: Request) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.list",
        )
        if deny is not None:
            return deny
        workspaces = service.list_workspaces()
        return {"ok": True, "workspaces": workspaces, "count": len(workspaces)}

    @router.post("/workspaces", status_code=status.HTTP_201_CREATED)
    def create_workspace(
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.create",
        )
        if deny is not None:
            return deny

        payload = dict(body or {})
        candidate_ids = {workspace.get("workspace_id") for workspace in service.list_workspaces()}
        workspace_id = ""
        while not workspace_id or workspace_id in candidate_ids:
            workspace_id = f"ws-{uuid4().hex[:8]}"

        workspace_name = str(payload.get("name", "")).strip()
        if not workspace_name:
            workspace_name = f"Workspace {len(candidate_ids) + 1}"
        workspace = service.upsert_workspace(
            workspace_id,
            {
                "name": workspace_name,
                "created_by": str(payload.get("created_by", "system")).strip() or "system",
            },
        )
        # Initialize default runtime/settings records so the frontend can read these
        # endpoints immediately after creation without 404/shape branching.
        service.set_workspace_runtime(
            workspace_id,
            {
                "state": "pending",
                "retryable": True,
                "retry_count": 0,
                "provisioning_requested_at": None,
            },
        )
        initial_settings: dict[str, Any] = {}
        session = _load_session_optional(request, config)
        if session is not None:
            github_link = read_user_github_link(user_service, session.user_id)
            if github_link.get("default_installation_id"):
                initial_settings["github_installation_id"] = str(github_link["default_installation_id"])
        service.set_workspace_settings(workspace_id, initial_settings)
        return {"ok": True, "workspace": workspace, "id": workspace_id}

    @router.patch("/workspaces/{workspace_id}")
    def update_workspace(
        workspace_id: str,
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.update",
        )
        if deny is not None:
            return deny

        workspace = _ensure_workspace_exists(service, workspace_id, name=workspace_id)
        payload = dict(body or {})
        name = str(payload.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Workspace name is required")

        updated = service.upsert_workspace(
            workspace_id,
            {
                **workspace,
                **payload,
                "name": name,
            },
        )
        return {"ok": True, "workspace": updated, "id": workspace_id}

    @router.get("/workspaces/{workspace_id}/runtime")
    def get_workspace_runtime(workspace_id: str, request: Request) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.runtime.get",
        )
        if deny is not None:
            return deny

        _ensure_workspace_exists(service, workspace_id)
        runtime = service.get_workspace_runtime(workspace_id)
        if runtime is None:
            runtime = service.set_workspace_runtime(
                workspace_id,
                {
                    "state": "pending",
                    "retryable": True,
                    "retry_count": 0,
                    "provisioning_requested_at": None,
                },
            )
        return {"ok": True, "runtime": runtime}

    @router.post("/workspaces/{workspace_id}/runtime/retry")
    def retry_workspace_runtime(workspace_id: str, request: Request) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.runtime.retry",
        )
        if deny is not None:
            return deny

        _ensure_workspace_exists(service, workspace_id)
        runtime = service.get_workspace_runtime(workspace_id)
        if runtime is None:
            runtime = service.set_workspace_runtime(
                workspace_id,
                {
                    "state": "provisioning",
                    "retryable": False,
                    "retry_count": 1,
                    "provisioning_requested_at": _now_iso(),
                },
            )
            return {"ok": True, "runtime": runtime, "retried": True}

        current_state = str(runtime.get("state", "")).lower()
        if current_state in {"ready", "provisioning"}:
            return {"ok": True, "runtime": runtime, "retried": False}

        next_retry_count = int(runtime.get("retry_count", 0)) + 1
        updated = service.set_workspace_runtime(
            workspace_id,
            {
                **runtime,
                "state": "provisioning",
                "retryable": False,
                "retry_count": next_retry_count,
                "provisioning_requested_at": _now_iso(),
            },
        )
        return {"ok": True, "runtime": updated, "retried": True}

    @router.get("/workspaces/{workspace_id}/settings")
    def get_workspace_settings(workspace_id: str, request: Request) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.settings.get",
        )
        if deny is not None:
            return deny

        _ensure_workspace_exists(service, workspace_id)
        settings = service.get_workspace_settings(workspace_id)
        if settings is None:
            settings = service.set_workspace_settings(workspace_id, {})
        return {"ok": True, "settings": settings}

    @router.put("/workspaces/{workspace_id}/settings")
    def update_workspace_settings(
        workspace_id: str,
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ) -> dict[str, Any]:
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.settings.update",
        )
        if deny is not None:
            return deny

        _ensure_workspace_exists(service, workspace_id)
        settings = service.set_workspace_settings(workspace_id, dict(body or {}))
        return {"ok": True, "settings": settings}

    return router
