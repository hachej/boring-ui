"""Supabase-backed workspace-scoped `/w/{workspace_id}/...` boundary routes."""

from __future__ import annotations

import json
import uuid

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .supabase.common import error_response, load_session
from .supabase.membership import NotAMember, WorkspaceNotFound, require_membership
from .supabase import db_client

_RESERVED_SUBPATHS = {"setup", "runtime", "settings"}
_WORKSPACE_PASSTHROUGH_ROOTS = (
    "/api/v1/me",
    "/api/v1/workspaces",
    "/api/v1/files",
    "/api/v1/git",
    "/api/v1/ui",
    "/api/v1/agent",
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


async def _require_workspace_member(request: Request, config: APIConfig, workspace_id: str):
    session_or_error = load_session(request, config)
    if isinstance(session_or_error, JSONResponse):
        return session_or_error
    session = session_or_error

    try:
        ws_uuid = uuid.UUID(workspace_id)
    except ValueError:
        return error_response(
            request,
            status_code=400,
            error="bad_request",
            code="INVALID_WORKSPACE_ID",
            message="workspace_id must be a UUID",
        )

    try:
        pool = db_client.get_pool()
    except RuntimeError:
        return error_response(
            request,
            status_code=500,
            error="server_error",
            code="DB_POOL_UNAVAILABLE",
            message="Supabase DB pool is not initialized",
        )

    try:
        await require_membership(
            pool,
            ws_uuid,
            uuid.UUID(str(session.user_id)),
            app_id=config.control_plane_app_id,
        )
    except WorkspaceNotFound as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    except NotAMember as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)

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
    if not target_path.startswith("/auth/"):
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
    }
    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=filtered_headers,
    )


def create_workspace_boundary_router_supabase(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["workspace-boundary"])

    @router.get("/w/{workspace_id}/setup")
    async def workspace_setup(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.setup",
        )
        if deny is not None:
            return deny
        session_or_error = await _require_workspace_member(request, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error

        runtime_response = await _forward_http_request(
            request,
            f"/api/v1/workspaces/{workspace_id}/runtime",
            workspace_id,
        )
        runtime_payload = {}
        try:
            runtime_payload = json.loads(runtime_response.body.decode("utf-8"))
        except Exception:
            runtime_payload = {}

        return {
            "ok": True,
            "workspace_id": workspace_id,
            "route": "setup",
            "runtime": runtime_payload,
        }

    @router.get("/w/{workspace_id}/runtime")
    async def workspace_runtime(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.runtime.get",
        )
        if deny is not None:
            return deny
        session_or_error = await _require_workspace_member(request, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        return await _forward_http_request(request, f"/api/v1/workspaces/{workspace_id}/runtime", workspace_id)

    @router.post("/w/{workspace_id}/runtime/retry")
    async def workspace_runtime_retry(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.boundary.runtime.retry",
        )
        if deny is not None:
            return deny
        session_or_error = await _require_workspace_member(request, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        return await _forward_http_request(request, f"/api/v1/workspaces/{workspace_id}/runtime/retry", workspace_id)

    @router.get("/w/{workspace_id}/settings")
    async def workspace_settings_get(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.boundary.settings.get",
        )
        if deny is not None:
            return deny
        session_or_error = await _require_workspace_member(request, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        return await _forward_http_request(request, f"/api/v1/workspaces/{workspace_id}/settings", workspace_id)

    @router.put("/w/{workspace_id}/settings")
    async def workspace_settings_put(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.boundary.settings.put",
        )
        if deny is not None:
            return deny
        session_or_error = await _require_workspace_member(request, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        return await _forward_http_request(request, f"/api/v1/workspaces/{workspace_id}/settings", workspace_id)

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
        session_or_error = await _require_workspace_member(request, config, workspace_id)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error

        normalized = "/" + str(path or "").lstrip("/")
        first_segment = normalized.lstrip("/").split("/", 1)[0]
        if first_segment in _RESERVED_SUBPATHS:
            return error_response(
                request,
                status_code=404,
                error="not_found",
                code="WORKSPACE_PATH_RESERVED",
                message="Reserved workspace path",
            )
        if not _is_allowed_workspace_passthrough_target(normalized):
            return error_response(
                request,
                status_code=404,
                error="not_found",
                code="WORKSPACE_PATH_DENIED",
                message="Path is outside allowed workspace-scoped families",
            )
        return await _forward_http_request(request, normalized, workspace_id)

    return router
