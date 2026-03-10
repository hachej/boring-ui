"""Workspace-scoped `/w/{workspace_id}/...` boundary and precedence routes."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, Body, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .auth_session import SessionExpired, SessionInvalid, parse_session_cookie
from .repository import LocalControlPlaneRepository
from .service import ControlPlaneService

_RESERVED_SUBPATHS = {"setup", "runtime", "settings"}
_WORKSPACE_PASSTHROUGH_ROOTS = (
    "/api/v1/me",
    "/api/v1/workspaces",
    "/api/v1/files",
    "/api/v1/git",
    "/api/v1/ui",
    "/api/v1/agent",
    "/api/v1/auth",
    "/api/v1/control-plane",
    "/api/capabilities",
    "/api/config",
    "/api/project",
    "/api/approval",
)
_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "") or uuid4())


def _error(
    request: Request,
    *,
    status_code: int,
    error: str,
    code: str,
    message: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": error,
            "code": code,
            "message": message,
            "request_id": _request_id(request),
        },
    )


def _service(config: APIConfig) -> ControlPlaneService:
    state_path = config.validate_path(config.control_plane_state_relpath)
    return ControlPlaneService(LocalControlPlaneRepository(state_path), workspace_root=config.workspace_root)


def _load_session(request: Request, config: APIConfig):
    # Dev bypass: when no auth provider is configured, return a synthetic session
    # so workspace routes work without requiring Supabase login.
    if not config.use_supabase_control_plane:
        from .auth_session import SessionPayload
        import time
        return SessionPayload(
            user_id="dev-user",
            email="dev@localhost",
            exp=int(time.time()) + 86400,
        )

    token = request.cookies.get(config.auth_session_cookie_name, "")
    if not token:
        return _error(
            request,
            status_code=401,
            error="unauthorized",
            code="SESSION_REQUIRED",
            message="No active session",
        )
    try:
        return parse_session_cookie(token, secret=config.auth_session_secret)
    except SessionExpired:
        return _error(
            request,
            status_code=401,
            error="unauthorized",
            code="SESSION_EXPIRED",
            message="Session expired",
        )
    except SessionInvalid:
        return _error(
            request,
            status_code=401,
            error="unauthorized",
            code="SESSION_INVALID",
            message="Session invalid",
        )


def _ensure_workspace_exists(service: ControlPlaneService, workspace_id: str) -> None:
    exists = any(item.get("workspace_id") == workspace_id for item in service.list_workspaces())
    if not exists:
        service.upsert_workspace(workspace_id, {"name": workspace_id})


def _membership_for_user(service: ControlPlaneService, workspace_id: str, user_id: str) -> dict[str, Any] | None:
    return next(
        (
            item
            for item in service.list_memberships()
            if item.get("workspace_id") == workspace_id
            and item.get("user_id") == user_id
            and item.get("deleted_at") is None
        ),
        None,
    )


def _require_workspace_member(
    request: Request,
    service: ControlPlaneService,
    config: APIConfig,
    workspace_id: str,
):
    session_or_error = _load_session(request, config)
    if isinstance(session_or_error, JSONResponse):
        return session_or_error
    session = session_or_error
    _ensure_workspace_exists(service, workspace_id)
    membership = _membership_for_user(service, workspace_id, session.user_id)
    if membership is None:
        # Dev bypass: auto-grant membership when no auth provider is configured
        if not config.use_supabase_control_plane:
            membership_id = f"{workspace_id}:{session.user_id}"
            service.upsert_membership(membership_id, {
                "workspace_id": workspace_id,
                "user_id": session.user_id,
                "role": "owner",
            })
        else:
            return _error(
                request,
                status_code=403,
                error="forbidden",
                code="WORKSPACE_MEMBERSHIP_REQUIRED",
                message="Workspace membership required",
            )
    return session


def _is_allowed_workspace_passthrough_target(path: str) -> bool:
    normalized = "/" + str(path or "").lstrip("/")
    if normalized.startswith("/auth/"):
        return True
    return any(
        normalized == root or normalized.startswith(f"{root}/")
        for root in _WORKSPACE_PASSTHROUGH_ROOTS
    )


async def _forward_http_request(request: Request, target_path: str, workspace_id: str) -> Response:
    body = await request.body()
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers["x-workspace-id"] = workspace_id

    transport = httpx.ASGITransport(app=request.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://workspace-boundary.local") as client:
        response = await client.request(
            request.method,
            target_path,
            params=dict(request.query_params),
            headers=headers,
            content=body,
        )

    filtered_headers = {
        key: value
        for key, value in response.headers.items()
        if key.lower() not in _HOP_BY_HOP_HEADERS
        and key.lower() != "content-encoding"
    }
    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=filtered_headers,
    )


def create_workspace_boundary_router(config: APIConfig) -> APIRouter:
    """Create workspace-scoped boundary router at `/w/{workspace_id}/...`."""

    router = APIRouter(tags=["workspace-boundary"])
    service = _service(config)

    @router.get("/w/{workspace_id}/setup")
    def workspace_setup(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.setup",
        )
        if deny is not None:
            return deny
        session_or_error = _require_workspace_member(request, service, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error

        runtime = service.get_workspace_runtime(workspace_id) or {"state": "pending"}
        return {
            "ok": True,
            "workspace_id": workspace_id,
            "route": "setup",
            "runtime": runtime,
        }

    @router.get("/w/{workspace_id}/runtime")
    def workspace_runtime(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.runtime.get",
        )
        if deny is not None:
            return deny
        session_or_error = _require_workspace_member(request, service, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        runtime = service.get_workspace_runtime(workspace_id)
        if runtime is None:
            runtime = service.set_workspace_runtime(
                workspace_id,
                {"state": "pending", "retryable": True, "retry_count": 0},
            )
        return {"ok": True, "runtime": runtime}

    @router.post("/w/{workspace_id}/runtime/retry")
    def workspace_runtime_retry(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.boundary.runtime.retry",
        )
        if deny is not None:
            return deny
        session_or_error = _require_workspace_member(request, service, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error

        runtime = service.get_workspace_runtime(workspace_id) or {}
        state = str(runtime.get("state", "")).lower()
        if state not in {"ready", "provisioning"}:
            runtime = service.set_workspace_runtime(
                workspace_id,
                {
                    **runtime,
                    "state": "provisioning",
                    "retry_count": int(runtime.get("retry_count", 0)) + 1,
                    "retryable": False,
                },
            )
            return {"ok": True, "runtime": runtime, "retried": True}
        return {"ok": True, "runtime": runtime, "retried": False}

    @router.get("/w/{workspace_id}/settings")
    def workspace_settings_get(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.settings.get",
        )
        if deny is not None:
            return deny
        session_or_error = _require_workspace_member(request, service, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        settings = service.get_workspace_settings(workspace_id)
        if settings is None:
            settings = service.set_workspace_settings(workspace_id, {})
        return {"ok": True, "settings": settings}

    @router.put("/w/{workspace_id}/settings")
    def workspace_settings_put(
        workspace_id: str,
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.boundary.settings.put",
        )
        if deny is not None:
            return deny
        session_or_error = _require_workspace_member(request, service, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        settings = service.set_workspace_settings(workspace_id, dict(body or {}))
        return {"ok": True, "settings": settings}

    @router.api_route(
        "/w/{workspace_id}/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    )
    async def workspace_passthrough(workspace_id: str, path: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.passthrough",
        )
        if deny is not None:
            return deny
        session_or_error = _require_workspace_member(request, service, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error

        normalized = "/" + str(path or "").lstrip("/")
        first_segment = normalized.lstrip("/").split("/", 1)[0]
        if first_segment in _RESERVED_SUBPATHS:
            return _error(
                request,
                status_code=404,
                error="not_found",
                code="WORKSPACE_PATH_RESERVED",
                message="Reserved workspace path",
            )
        if not _is_allowed_workspace_passthrough_target(normalized):
            # Non-API paths are frontend client routes — serve SPA index.html
            static_dir = os.environ.get("BORING_UI_STATIC_DIR", "")
            index_html = Path(static_dir) / "index.html" if static_dir else None
            if index_html and index_html.exists():
                return FileResponse(
                    index_html,
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
                )
            return _error(
                request,
                status_code=404,
                error="not_found",
                code="WORKSPACE_PATH_DENIED",
                message="Path is outside allowed workspace-scoped families",
            )
        return await _forward_http_request(request, normalized, workspace_id)

    return router
