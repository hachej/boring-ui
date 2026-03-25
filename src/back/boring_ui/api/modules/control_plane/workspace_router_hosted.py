"""Hosted-control-plane workspace lifecycle/settings routes."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .common import ensure_pool, error_response, load_session, normalize_workspace_payload
from .membership import NotAMember, WorkspaceNotFound, require_membership
from .service import ensure_workspace_root_dir
from .user_settings_state import GITHUB_DEFAULT_INSTALLATION_ID_KEY, GITHUB_ACCOUNT_LINKED_KEY

logger = logging.getLogger(__name__)

_background_tasks: set = set()
_MACHINE_READY_TIMEOUT_SECONDS = 60.0
_MACHINE_READY_POLL_INTERVAL_SECONDS = 1.0


async def _wait_for_machine_started(
    provisioner,
    machine_id: str,
    *,
    timeout_seconds: float = _MACHINE_READY_TIMEOUT_SECONDS,
    poll_interval_seconds: float = _MACHINE_READY_POLL_INTERVAL_SECONDS,
) -> None:
    """Wait until Fly reports the workspace machine as healthy.

    The control plane should not advertise a workspace runtime as ``ready``
    until Fly can actually route traffic to the machine. Marking ``ready``
    immediately after machine creation causes the first replayed request to
    race the machine boot and return a 500.
    """

    deadline = asyncio.get_running_loop().time() + timeout_seconds
    last_state = "unknown"
    terminal_states = {"destroyed", "failed", "replacing", "stopped"}

    while True:
        info = None
        if hasattr(provisioner, "machine_info"):
            info = await provisioner.machine_info(machine_id)
            state = str(info.get("state") or "").strip().lower() or "unknown"
        else:
            state = str(await provisioner.status(machine_id) or "").strip().lower() or "unknown"
        last_state = state
        checks = []
        if isinstance(info, dict):
            raw_checks = info.get("checks")
            if isinstance(raw_checks, list):
                checks = raw_checks
        checks_passing = bool(checks) and all(
            str((check or {}).get("status") or "").strip().lower() == "passing"
            for check in checks
        )

        if state == "started" and (not checks or checks_passing):
            return
        if state in terminal_states:
            raise RuntimeError(f"Workspace machine {machine_id} entered terminal state {state!r}")

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise RuntimeError(
                f"Workspace machine {machine_id} did not reach 'started' within "
                f"{timeout_seconds:.0f}s (last state: {last_state!r})"
            )
        await asyncio.sleep(min(poll_interval_seconds, remaining))


async def _provision_workspace(provisioner, pool, workspace_id: str, config: APIConfig):
    """Background task: create Fly Machine + Volume, then update DB state."""
    try:
        result = await provisioner.create(workspace_id, region="cdg", size_gb=10)
        await _wait_for_machine_started(provisioner, result.machine_id)
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE workspaces SET machine_id = $1, volume_id = $2, fly_region = $3 WHERE id = $4""",
                result.machine_id, result.volume_id, result.region, uuid.UUID(workspace_id),
            )
            await conn.execute(
                """UPDATE workspace_runtimes SET state = 'ready', updated_at = now() WHERE workspace_id = $1""",
                uuid.UUID(workspace_id),
            )
        logger.info(
            "Provisioned workspace %s: machine=%s volume=%s",
            workspace_id, result.machine_id, result.volume_id,
        )
    except Exception as exc:
        logger.error("Failed to provision workspace %s: %s", workspace_id, exc)
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE workspace_runtimes SET state = 'error', last_error = $1, updated_at = now() WHERE workspace_id = $2""",
                str(exc), uuid.UUID(workspace_id),
            )


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
    user_email: str = "",
) -> tuple[str, bool]:
    user_uuid = uuid.UUID(str(user_id))
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Ensure user exists in the users table (Neon Auth manages
            # users externally; this syncs the local FK reference).
            await conn.execute(
                """INSERT INTO users (id, email) VALUES ($1, $2)
                   ON CONFLICT (id) DO NOTHING""",
                user_uuid,
                user_email or "unknown",
            )
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
                        SELECT id, app_id, name, created_by, machine_id, volume_id, fly_region
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


async def _read_user_github_link_db(pool, user_id: str, app_id: str) -> dict:
    """Read GitHub link settings from user_settings DB table."""
    row = await pool.fetchrow(
        "SELECT settings FROM user_settings WHERE user_id = $1 AND app_id = $2",
        uuid.UUID(str(user_id)),
        app_id,
    )
    if not row or not row["settings"]:
        return {"account_linked": False, "default_installation_id": None}
    settings = json.loads(row["settings"]) if isinstance(row["settings"], str) else row["settings"]
    raw_installation_id = settings.get(GITHUB_DEFAULT_INSTALLATION_ID_KEY)
    default_installation_id = None
    if raw_installation_id not in (None, ""):
        try:
            default_installation_id = int(raw_installation_id)
        except (TypeError, ValueError):
            pass
    return {
        "account_linked": bool(settings.get(GITHUB_ACCOUNT_LINKED_KEY)),
        "default_installation_id": default_installation_id,
    }


def create_workspace_router_hosted(config: APIConfig) -> APIRouter:
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

        # Provision Fly Machine in background if provisioner is configured
        provisioner = getattr(request.app.state, 'provisioner', None)
        if provisioner:
            task = asyncio.create_task(_provision_workspace(provisioner, pool, workspace_id, config))
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)

        github_link = await _read_user_github_link_db(pool, str(session.user_id), config.control_plane_app_id)
        default_installation_id = github_link.get("default_installation_id")
        settings_key = config.settings_encryption_key or os.environ.get("BORING_SETTINGS_KEY", "")
        if default_installation_id and settings_key:
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO workspace_settings (workspace_id, key, value)
                    VALUES ($1, 'github_installation_id', pgp_sym_encrypt($2, $3))
                    ON CONFLICT (workspace_id, key)
                    DO UPDATE SET value = pgp_sym_encrypt($2, $3), updated_at = now()
                    """,
                    uuid.UUID(workspace_id),
                    str(default_installation_id),
                    settings_key,
                )

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, app_id, name, created_by, machine_id, volume_id, fly_region FROM workspaces WHERE id = $1",
                uuid.UUID(workspace_id),
            )
        ensure_workspace_root_dir(config.workspace_root, workspace_id)
        data = normalize_workspace_payload(row)

        # Auto-provision GitHub repo if GitHub App is configured
        git_repo = None
        git_provisioning_error = None
        if config.github_configured:
            try:
                from ..github_auth.provisioning import provision_workspace_repo
                git_repo = await provision_workspace_repo(
                    config, pool, workspace_id, name,
                )
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning(
                    'Git repo provisioning failed for workspace %s: %s',
                    workspace_id, exc,
                )
                git_provisioning_error = str(exc)

        result = {"ok": True, "workspace": data, **data}
        if git_repo:
            result["git_repo"] = git_repo
        elif config.github_configured:
            result["git_provisioning_status"] = "failed"
            if git_provisioning_error:
                result["git_provisioning_error"] = git_provisioning_error
        return result

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
                SELECT w.id, w.app_id, w.name, w.created_by, w.machine_id, w.volume_id, w.fly_region
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

    @router.patch("/workspaces/{workspace_id}")
    async def update_workspace(request: Request, workspace_id: str):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.update",
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

        name = str(payload.get("name", "")).strip() if isinstance(payload, dict) else ""
        if not name:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="NAME_REQUIRED",
                message="Workspace name is required",
            )

        if len(name) > 100:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="WORKSPACE_NAME_TOO_LONG",
                message="Workspace name must be 100 characters or fewer",
            )

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE workspaces
                SET name = $1
                WHERE id = $2 AND deleted_at IS NULL
                RETURNING id, app_id, name, created_by
                """,
                name,
                ws_uuid,
            )
            if row is None:
                return error_response(
                    request,
                    status_code=404,
                    error="not_found",
                    code="WORKSPACE_NOT_FOUND",
                    message="Workspace not found",
                )

        data = normalize_workspace_payload(row)
        return {"ok": True, "workspace": data, **data}

    @router.delete("/workspaces/{workspace_id}")
    async def delete_workspace(request: Request, workspace_id: str):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.workspace.delete",
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

        # Clean up Fly Machine + Volume before soft-deleting
        provisioner = getattr(request.app.state, 'provisioner', None)
        if provisioner:
            async with pool.acquire() as conn:
                ws_row = await conn.fetchrow(
                    "SELECT machine_id, volume_id FROM workspaces WHERE id = $1",
                    ws_uuid,
                )
            if ws_row and ws_row['machine_id']:
                try:
                    await provisioner.delete(ws_row['machine_id'], ws_row['volume_id'])
                except Exception as exc:
                    logger.warning(
                        "Failed to delete Fly resources for workspace %s: %s",
                        workspace_id, exc,
                    )

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE workspaces
                SET deleted_at = now()
                WHERE id = $1 AND deleted_at IS NULL
                RETURNING id
                """,
                ws_uuid,
            )
            if row is None:
                return error_response(
                    request,
                    status_code=404,
                    error="not_found",
                    code="WORKSPACE_NOT_FOUND",
                    message="Workspace not found or already deleted",
                )

        return {"ok": True, "deleted": True}

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
