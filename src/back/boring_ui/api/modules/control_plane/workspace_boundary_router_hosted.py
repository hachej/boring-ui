"""Hosted-control-plane `/w/{workspace_id}/...` boundary routes."""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .common import error_response, load_session
from .membership import NotAMember, WorkspaceNotFound, require_membership
from . import db_client

logger = logging.getLogger(__name__)

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
_LOCAL_WORKSPACE_HEADER = "x-boring-local-workspace"


def _workspace_passthrough_roots(config: APIConfig | None = None) -> tuple[str, ...]:
    roots = list(_WORKSPACE_PASSTHROUGH_ROOTS)
    extras = tuple(getattr(config, "extra_passthrough_roots", ()) or ()) if config is not None else ()
    for root in extras:
        normalized = "/" + str(root or "").strip().lstrip("/")
        normalized = normalized.rstrip("/") or "/"
        if normalized not in roots:
            roots.append(normalized)
    return tuple(roots)


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
            message="Control-plane DB pool is not initialized",
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


def _is_allowed_workspace_passthrough_target(path: str, config: APIConfig | None = None) -> bool:
    normalized = "/" + str(path or "").lstrip("/")
    if normalized.startswith("/auth/"):
        return True
    roots = _workspace_passthrough_roots(config)
    return any(
        normalized == root or normalized.startswith(f"{root}/")
        for root in roots
    )


class _FlyReplayResult:
    """Result of a fly-replay lookup."""

    __slots__ = ("response", "is_local_workspace")

    def __init__(self, response: Response | None, *, is_local_workspace: bool = False):
        self.response = response
        self.is_local_workspace = is_local_workspace


async def _try_fly_replay(workspace_id: str) -> _FlyReplayResult:
    """Check whether to redirect via fly-replay or handle locally.

    Returns a ``_FlyReplayResult``:
    - ``.response`` is a fly-replay ``Response`` when the request should be
      forwarded to another Machine, or ``None`` when it should be handled here.
    - ``.is_local_workspace`` is ``True`` when the current process IS the
      dedicated workspace Machine (detected by comparing ``FLY_MACHINE_ID``).
      Callers use this to skip workspace-id path scoping — the volume is
      mounted directly at ``BORING_UI_WORKSPACE_ROOT``.
    """
    try:
        pool = db_client.get_pool()
        ws_row = await pool.fetchrow(
            "SELECT machine_id FROM workspaces WHERE id = $1", uuid.UUID(workspace_id)
        )
        if ws_row and ws_row.get("machine_id"):
            target = ws_row["machine_id"]
            current = os.environ.get("FLY_MACHINE_ID", "")
            if current and current == target:
                # Already on the workspace Machine — handle locally.
                return _FlyReplayResult(None, is_local_workspace=True)
            return _FlyReplayResult(
                Response(
                    status_code=200,
                    headers={"fly-replay": f"instance={target}"},
                )
            )
    except Exception as exc:
        logger.warning("fly-replay lookup failed for workspace %s: %s", workspace_id, exc)
    return _FlyReplayResult(None)


async def _forward_http_request(
    request: Request,
    target_path: str,
    workspace_id: str,
    *,
    is_local_workspace: bool = False,
) -> Response:
    body = await request.body()
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    if not target_path.startswith("/auth/"):
        if not is_local_workspace:
            headers["x-workspace-id"] = workspace_id
        else:
            # Dedicated workspace Machine: pass the logical workspace id and
            # the local-workspace flag so ALL routes (files, git, agent, etc.)
            # resolve to the volume root rather than a nested <root>/<id> path.
            headers["x-workspace-id"] = workspace_id
            headers[_LOCAL_WORKSPACE_HEADER] = "1"

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


def _spa_response_hosted():
    """Serve the SPA index.html for browser navigation to workspace pages."""
    static_dir = os.environ.get("BORING_UI_STATIC_DIR", "")
    if static_dir:
        index = Path(static_dir) / "index.html"
        if index.exists():
            return FileResponse(
                index,
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )
    return JSONResponse({"error": "Frontend not available"}, status_code=404)


def _workspace_root_response(request: Request, workspace_id: str):
    accept = request.headers.get("accept", "")
    if request.method == "GET" and "text/html" in accept:
        return _spa_response_hosted()
    return {
        "ok": True,
        "workspace_id": workspace_id,
        "route": "root",
    }


def create_workspace_boundary_router_hosted(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["workspace-boundary"])

    async def _maybe_fly_replay(workspace_id: str) -> _FlyReplayResult:
        # Frontend/core mode handles workspace requests locally even when older
        # workspace rows still carry machine metadata from backend-mode runs.
        if config.agents_mode != "backend":
            return _FlyReplayResult(None)
        return await _try_fly_replay(workspace_id)

    @router.get("/w/{workspace_id}/setup")
    async def workspace_setup(workspace_id: str, request: Request):
        # Browser navigation → serve SPA HTML so the frontend handles rendering
        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            return _spa_response_hosted()

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

        # Route to Fly Machine if workspace has one assigned
        replay = await _maybe_fly_replay(workspace_id)
        if replay.response is not None:
            return replay.response

        runtime_response = await _forward_http_request(
            request,
            f"/api/v1/workspaces/{workspace_id}/runtime",
            workspace_id,
            is_local_workspace=replay.is_local_workspace,
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
        replay = await _maybe_fly_replay(workspace_id)
        if replay.response is not None:
            return replay.response
        return await _forward_http_request(
            request, f"/api/v1/workspaces/{workspace_id}/runtime", workspace_id,
            is_local_workspace=replay.is_local_workspace,
        )

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
        replay = await _maybe_fly_replay(workspace_id)
        if replay.response is not None:
            return replay.response
        return await _forward_http_request(
            request, f"/api/v1/workspaces/{workspace_id}/runtime/retry", workspace_id,
            is_local_workspace=replay.is_local_workspace,
        )

    @router.get("/w/{workspace_id}/settings")
    async def workspace_settings_get(workspace_id: str, request: Request):
        accept = request.headers.get("accept", "")
        if request.method == "GET" and "text/html" in accept:
            return _spa_response_hosted()

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
        replay = await _maybe_fly_replay(workspace_id)
        if replay.response is not None:
            return replay.response
        return await _forward_http_request(
            request, f"/api/v1/workspaces/{workspace_id}/settings", workspace_id,
            is_local_workspace=replay.is_local_workspace,
        )

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
        replay = await _maybe_fly_replay(workspace_id)
        if replay.response is not None:
            return replay.response
        return await _forward_http_request(
            request, f"/api/v1/workspaces/{workspace_id}/settings", workspace_id,
            is_local_workspace=replay.is_local_workspace,
        )

    @router.api_route(
        "/w/{workspace_id}/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    )
    async def workspace_passthrough(workspace_id: str, path: str, request: Request):
        normalized = "/" + str(path or "").lstrip("/")
        accept = request.headers.get("accept", "")
        is_browser_navigation = request.method == "GET" and "text/html" in accept
        if is_browser_navigation:
            if normalized == "/":
                return _workspace_root_response(request, workspace_id)
            if not _is_allowed_workspace_passthrough_target(normalized, config=config):
                return _spa_response_hosted()

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
        if normalized == "/":
            return _workspace_root_response(request, workspace_id)
        first_segment = normalized.lstrip("/").split("/", 1)[0]
        if first_segment in _RESERVED_SUBPATHS:
            return error_response(
                request,
                status_code=404,
                error="not_found",
                code="WORKSPACE_PATH_RESERVED",
                message="Reserved workspace path",
            )
        if not _is_allowed_workspace_passthrough_target(normalized, config=config):
            # Non-API paths are frontend client routes — serve SPA index.html
            static_dir = os.environ.get("BORING_UI_STATIC_DIR", "")
            index_html = Path(static_dir) / "index.html" if static_dir else None
            if index_html and index_html.exists():
                return FileResponse(
                    index_html,
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
                )
            return error_response(
                request,
                status_code=404,
                error="not_found",
                code="WORKSPACE_PATH_DENIED",
                message="Path is outside allowed workspace-scoped families",
            )
        replay = await _maybe_fly_replay(workspace_id)
        if replay.response is not None:
            return replay.response
        return await _forward_http_request(
            request, normalized, workspace_id,
            is_local_workspace=replay.is_local_workspace,
        )

    return router
