"""Supabase-backed canonical workspace lifecycle/settings routes."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .supabase.common import ensure_pool, error_response, load_session, normalize_workspace_payload
from .supabase.membership import NotAMember, WorkspaceNotFound, require_membership


def _parse_workspace_id(workspace_id: str, request: Request):
    try:
        return uuid.UUID(workspace_id), None
    except ValueError:
        return None, error_response(
            request,
            status_code=400,
            error="bad_request",
            code="INVALID_WORKSPACE_ID",
            message="workspace_id must be a UUID",
        )


async def create_workspace_for_user(
    pool,
    app_id: str,
    user_id: str | uuid.UUID,
    name: str,
    *,
    is_default: bool = False,
) -> tuple[str, bool]:
    user_uuid = uuid.UUID(str(user_id))
    async with pool.acquire() as conn:
        async with conn.transaction():
            if is_default:
                workspace_row = await conn.fetchrow(
                    """
                    INSERT INTO workspaces (name, app_id, created_by, is_default)
                    VALUES ($1, $2, $3, true)
                    ON CONFLICT (created_by, app_id) WHERE is_default = true
                    DO NOTHING
                    RETURNING id, app_id, name, created_by
                    """,
                    name,
                    app_id,
                    user_uuid,
                )
                if workspace_row is None:
                    workspace_row = await conn.fetchrow(
                        """
                        SELECT id, app_id, name, created_by
                        FROM workspaces
                        WHERE created_by = $1 AND app_id = $2 AND is_default = true
                        """,
                        user_uuid,
                        app_id,
                    )
                    ws_id = workspace_row["id"]
                    await conn.execute(
                        """INSERT INTO workspace_members (workspace_id, user_id, role)
                        VALUES ($1, $2, 'owner')
                        ON CONFLICT (workspace_id, user_id) DO NOTHING""",
                        ws_id,
                        user_uuid,
                    )
                    await conn.execute(
                        """INSERT INTO workspace_runtimes (workspace_id, state)
                        VALUES ($1, 'pending')
                        ON CONFLICT (workspace_id) DO NOTHING""",
                        ws_id,
                    )
                    return str(ws_id), False
            else:
                workspace_row = await conn.fetchrow(
                    """
                    INSERT INTO workspaces (name, app_id, created_by)
                    VALUES ($1, $2, $3)
                    RETURNING id, app_id, name, created_by
                    """,
                    name,
                    app_id,
                    user_uuid,
                )
            workspace_id = workspace_row["id"]
            await conn.execute(
                """INSERT INTO workspace_members (workspace_id, user_id, role)
                VALUES ($1, $2, 'owner')
                ON CONFLICT (workspace_id, user_id) DO NOTHING""",
                workspace_id,
                user_uuid,
            )
            await conn.execute(
                """INSERT INTO workspace_runtimes (workspace_id, state)
                VALUES ($1, 'pending')
                ON CONFLICT (workspace_id) DO NOTHING
                """,
                workspace_id,
            )
    return str(workspace_id), True


def _runtime_state_payload(row) -> dict:
    def _val(key: str):
        return row[key] if key in row else None
    updated_at = _val("updated_at")

    payload: dict = {
        "workspace_id": str(_val("workspace_id")),
        "state": _val("state"),
        "status": _val("state"),
        "sprite_url": _val("sprite_url"),
        "sprite_name": _val("sprite_name"),
        "last_error": _val("last_error"),
        "updated_at": updated_at.isoformat() if updated_at else None,
    }
    provisioning_step = _val("provisioning_step")
    step_started_at = _val("step_started_at")
    if provisioning_step:
        payload["provisioning_step"] = provisioning_step
    if step_started_at:
        payload["step_started_at"] = step_started_at.isoformat()
    payload["retryable"] = payload["state"] in {"error", "provisioning"}
    return payload


def create_workspace_router_supabase(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["workspaces"])

    async def _require_membership_or_error(request: Request, pool, ws_uuid: uuid.UUID, user_id: str):
        try:
            await require_membership(
                pool,
                ws_uuid,
                uuid.UUID(str(user_id)),
                app_id=config.control_plane_app_id,
            )
            return None
        except WorkspaceNotFound as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    **exc.detail,
                    "request_id": str(getattr(request.state, "request_id", "") or uuid.uuid4()),
                },
            )
        except NotAMember as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    **exc.detail,
                    "request_id": str(getattr(request.state, "request_id", "") or uuid.uuid4()),
                },
            )

    @router.post("/workspaces", status_code=status.HTTP_201_CREATED)
    async def create_workspace(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.create",
        )
        if deny is not None:
            return deny

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        try:
            payload = await request.json()
        except Exception:
            payload = {}
        name = str(payload.get("name", "")).strip() if isinstance(payload, dict) else ""
        if not name:
            # Frontends may call POST /workspaces without a body; provide a stable default.
            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            name = f"Workspace {stamp}"

        if len(name) > 100:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="WORKSPACE_NAME_TOO_LONG",
                message="Workspace name must be 100 characters or fewer",
            )

        workspace_id, _ = await create_workspace_for_user(
            pool,
            config.control_plane_app_id,
            session.user_id,
            name,
        )

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, app_id, name, created_by FROM workspaces WHERE id = $1",
                uuid.UUID(workspace_id),
            )
        data = normalize_workspace_payload(row)
        return {"ok": True, "workspace": data, **data}

    @router.get("/workspaces")
    async def list_workspaces(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.list",
        )
        if deny is not None:
            return deny

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT w.id, w.app_id, w.name, w.created_by
                FROM workspaces w
                JOIN workspace_members m ON w.id = m.workspace_id
                WHERE m.user_id = $1 AND w.app_id = $2 AND w.deleted_at IS NULL
                ORDER BY w.created_at DESC
                """,
                uuid.UUID(str(session.user_id)),
                config.control_plane_app_id,
            )
        workspaces = [normalize_workspace_payload(row) for row in rows]
        return {"ok": True, "workspaces": workspaces, "count": len(workspaces)}

    @router.get("/workspaces/{workspace_id}/runtime")
    async def get_workspace_runtime(request: Request, workspace_id: str):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.runtime.get",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_id(workspace_id, request)
        if err:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        membership_err = await _require_membership_or_error(request, pool, ws_uuid, session.user_id)
        if membership_err is not None:
            return membership_err

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT workspace_id, state, sprite_url, sprite_name, last_error,
                       updated_at, provisioning_step, step_started_at
                FROM workspace_runtimes
                WHERE workspace_id = $1
                """,
                ws_uuid,
            )
            if row is None:
                await conn.execute(
                    """
                    INSERT INTO workspace_runtimes (workspace_id, state)
                    VALUES ($1, 'pending')
                    ON CONFLICT (workspace_id) DO NOTHING
                    """,
                    ws_uuid,
                )
                row = await conn.fetchrow(
                    """
                    SELECT workspace_id, state, sprite_url, sprite_name, last_error,
                           updated_at, provisioning_step, step_started_at
                    FROM workspace_runtimes
                    WHERE workspace_id = $1
                    """,
                    ws_uuid,
                )

        return {"ok": True, "runtime": _runtime_state_payload(row)}

    @router.post("/workspaces/{workspace_id}/runtime/retry")
    async def retry_workspace_runtime(request: Request, workspace_id: str):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.runtime.retry",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_id(workspace_id, request)
        if err:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        membership_err = await _require_membership_or_error(request, pool, ws_uuid, session.user_id)
        if membership_err is not None:
            return membership_err

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE workspace_runtimes
                SET state = 'pending',
                    last_error = NULL,
                    provisioning_step = NULL,
                    step_started_at = NULL,
                    updated_at = now()
                WHERE workspace_id = $1
                  AND state IN ('error', 'provisioning')
                RETURNING workspace_id, state, sprite_url, sprite_name, last_error,
                          updated_at, provisioning_step, step_started_at
                """,
                ws_uuid,
            )
            if row is None:
                current = await conn.fetchrow(
                    """
                    SELECT workspace_id, state, sprite_url, sprite_name, last_error,
                           updated_at, provisioning_step, step_started_at
                    FROM workspace_runtimes
                    WHERE workspace_id = $1
                    """,
                    ws_uuid,
                )
                if current is None:
                    return error_response(
                        request,
                        status_code=404,
                        error="not_found",
                        code="RUNTIME_NOT_FOUND",
                        message="Runtime not found for this workspace",
                    )
                return error_response(
                    request,
                    status_code=409,
                    error="conflict",
                    code="INVALID_TRANSITION",
                    message="Retry is only available from error/provisioning states",
                )

        return {"ok": True, "runtime": _runtime_state_payload(row), "retried": True}

    @router.get("/workspaces/{workspace_id}/settings")
    async def get_workspace_settings(request: Request, workspace_id: str):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.workspace.settings.get",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_id(workspace_id, request)
        if err:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        membership_err = await _require_membership_or_error(request, pool, ws_uuid, session.user_id)
        if membership_err is not None:
            return membership_err

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT key, updated_at FROM workspace_settings WHERE workspace_id = $1",
                ws_uuid,
            )

        settings = {
            row["key"]: {
                "configured": True,
                "updated_at": row["updated_at"].isoformat(),
            }
            for row in rows
        }
        return {"ok": True, "settings": settings, "data": {"workspace_settings": settings}}

    @router.put("/workspaces/{workspace_id}/settings")
    async def put_workspace_settings(request: Request, workspace_id: str):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.settings.update",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_id(workspace_id, request)
        if err:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        membership_err = await _require_membership_or_error(request, pool, ws_uuid, session.user_id)
        if membership_err is not None:
            return membership_err

        try:
            payload = await request.json()
        except Exception:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_PAYLOAD",
                message="Expected JSON object",
            )

        if not isinstance(payload, dict):
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_PAYLOAD",
                message="Expected JSON object",
            )
        if len(payload) > 50:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="SETTINGS_TOO_MANY_KEYS",
                message="At most 50 setting keys are allowed per request",
            )

        settings_key = config.settings_encryption_key or os.environ.get("BORING_SETTINGS_KEY", "")
        if not settings_key:
            return error_response(
                request,
                status_code=500,
                error="server_error",
                code="SETTINGS_KEY_NOT_CONFIGURED",
                message="Settings encryption key is not configured",
            )

        for key, value in payload.items():
            if not isinstance(key, str) or not key.strip() or len(key.strip()) > 128:
                return error_response(
                    request,
                    status_code=400,
                    error="bad_request",
                    code="INVALID_SETTING_KEY",
                    message="Setting keys must be non-empty strings up to 128 characters",
                )
            if not isinstance(value, str) or not value.strip():
                return error_response(
                    request,
                    status_code=400,
                    error="bad_request",
                    code="INVALID_SETTING_VALUE",
                    message=f"Value for '{key}' must be a non-empty string",
                )

        async with pool.acquire() as conn:
            async with conn.transaction():
                for key, value in payload.items():
                    await conn.execute(
                        """
                        INSERT INTO workspace_settings (workspace_id, key, value)
                        VALUES ($1, $2, pgp_sym_encrypt($3, $4))
                        ON CONFLICT (workspace_id, key)
                        DO UPDATE SET value = pgp_sym_encrypt($3, $4), updated_at = now()
                        """,
                        ws_uuid,
                        key,
                        value,
                        settings_key,
                    )

        return {"ok": True, "settings": payload}

    return router
