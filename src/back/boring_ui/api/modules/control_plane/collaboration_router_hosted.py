"""Hosted-control-plane workspace collaboration routes."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .common import ensure_pool, error_response, load_session
from .membership import MemberRole, NotAMember, WorkspaceNotFound, require_membership

_TOKEN_BYTES = 32
_DEFAULT_EXPIRY_DAYS = 7


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _parse_workspace_uuid(workspace_id: str, request: Request):
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


def _normalize_member_payload(row: Any) -> dict[str, Any]:
    return {
        "workspace_id": str(row["workspace_id"]),
        "user_id": str(row["user_id"]),
        "role": row["role"],
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def _normalize_invite_payload(row: Any) -> dict[str, Any]:
    return {
        "invite_id": str(row["id"]),
        "id": str(row["id"]),
        "workspace_id": str(row["workspace_id"]),
        "email": row["email"],
        "role": row["role"],
        "expires_at": row["expires_at"].isoformat(),
        "accepted_at": row["accepted_at"].isoformat() if row["accepted_at"] else None,
        "created_at": row["created_at"].isoformat(),
    }


async def _require_owner_role(request: Request, config: APIConfig, ws_uuid: uuid.UUID, user_id: str):
    pool_or_error = ensure_pool(request)
    if isinstance(pool_or_error, JSONResponse):
        return None, pool_or_error
    pool = pool_or_error

    role = await require_membership(
        pool,
        ws_uuid,
        uuid.UUID(str(user_id)),
        app_id=config.control_plane_app_id,
    )
    if role != MemberRole.owner:
        return None, error_response(
            request,
            status_code=403,
            error="forbidden",
            code="OWNER_REQUIRED",
            message="Only workspace owners can manage members",
        )
    return pool, None


def create_collaboration_router_hosted(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["collaboration"])

    @router.get("/workspaces/{workspace_id}/members")
    async def list_members(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.collaboration.members.list",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_uuid(workspace_id, request)
        if err is not None:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

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

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT workspace_id, user_id, role, created_at
                FROM workspace_members
                WHERE workspace_id = $1
                ORDER BY
                  CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
                  created_at ASC
                """,
                ws_uuid,
            )

        members = [_normalize_member_payload(row) for row in rows]
        return {"ok": True, "members": members, "count": len(members)}

    @router.put("/workspaces/{workspace_id}/members/{user_id}")
    async def upsert_member(
        workspace_id: str,
        user_id: str,
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.collaboration.members.upsert",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_uuid(workspace_id, request)
        if err is not None:
            return err

        try:
            member_uuid = uuid.UUID(user_id)
        except ValueError:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_MEMBER_USER_ID",
                message="user_id must be a UUID",
            )

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        payload = dict(body or {})
        role = str(payload.get("role", "viewer")).strip().lower()
        if role not in {"owner", "editor", "viewer"}:
            role = "viewer"

        pool, owner_err = await _require_owner_role(request, config, ws_uuid, session.user_id)
        if owner_err is not None:
            return owner_err

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO workspace_members (workspace_id, user_id, role)
                VALUES ($1, $2, $3)
                ON CONFLICT (workspace_id, user_id)
                DO UPDATE SET role = EXCLUDED.role
                RETURNING workspace_id, user_id, role, created_at
                """,
                ws_uuid,
                member_uuid,
                role,
            )

        return {"ok": True, "member": _normalize_member_payload(row)}

    @router.get("/workspaces/{workspace_id}/invites")
    async def list_invites(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.collaboration.invites.list",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_uuid(workspace_id, request)
        if err is not None:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        try:
            caller_role = await require_membership(
                pool,
                ws_uuid,
                uuid.UUID(str(session.user_id)),
                app_id=config.control_plane_app_id,
            )
        except WorkspaceNotFound as exc:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        except NotAMember as exc:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        if caller_role not in {MemberRole.owner, MemberRole.editor}:
            return error_response(
                request,
                status_code=403,
                error="forbidden",
                code="ROLE_REQUIRED_EDITOR",
                message="Owner or editor role required",
            )

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, workspace_id, email, role, expires_at, accepted_at, created_at
                FROM workspace_invites
                WHERE workspace_id = $1
                ORDER BY created_at DESC
                """,
                ws_uuid,
            )

        invites = [_normalize_invite_payload(row) for row in rows]
        return {"ok": True, "invites": invites, "count": len(invites)}

    @router.post("/workspaces/{workspace_id}/invites")
    async def create_invite(
        workspace_id: str,
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.collaboration.invites.create",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_uuid(workspace_id, request)
        if err is not None:
            return err

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        payload = dict(body or {})
        email = str(payload.get("email", "")).strip().lower()
        if not email or "@" not in email:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_EMAIL",
                message="A valid email address is required",
            )

        role = str(payload.get("role", "editor")).strip().lower()
        if role not in {"owner", "editor", "viewer"}:
            role = "editor"

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        try:
            caller_role = await require_membership(
                pool,
                ws_uuid,
                uuid.UUID(str(session.user_id)),
                app_id=config.control_plane_app_id,
            )
        except WorkspaceNotFound as exc:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        except NotAMember as exc:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        if caller_role not in {MemberRole.owner, MemberRole.editor}:
            return error_response(
                request,
                status_code=403,
                error="forbidden",
                code="ROLE_REQUIRED_EDITOR",
                message="Owner or editor role required",
            )

        token = secrets.token_urlsafe(_TOKEN_BYTES)
        token_hash = _hash_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(days=_DEFAULT_EXPIRY_DAYS)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO workspace_invites
                  (workspace_id, email, token_hash, role, expires_at, created_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, workspace_id, email, role, expires_at, accepted_at, created_at
                """,
                ws_uuid,
                email,
                token_hash,
                role,
                expires_at,
                uuid.UUID(str(session.user_id)),
            )

        invite = _normalize_invite_payload(row)
        invite["invite_token"] = token
        return {"ok": True, "invite": invite}

    @router.post("/workspaces/{workspace_id}/invites/{invite_id}/accept")
    async def accept_invite(workspace_id: str, invite_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.collaboration.invites.accept",
        )
        if deny is not None:
            return deny

        ws_uuid, err = _parse_workspace_uuid(workspace_id, request)
        if err is not None:
            return err

        try:
            invite_uuid = uuid.UUID(invite_id)
        except ValueError:
            return error_response(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_INVITE_ID",
                message="invite_id must be a UUID",
            )

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        async with pool.acquire() as conn:
            async with conn.transaction():
                invite = await conn.fetchrow(
                    """
                    SELECT id, workspace_id, email, role, expires_at, accepted_at, created_at
                    FROM workspace_invites
                    WHERE id = $1 AND workspace_id = $2
                    FOR UPDATE
                    """,
                    invite_uuid,
                    ws_uuid,
                )
                if invite is None:
                    return error_response(
                        request,
                        status_code=404,
                        error="not_found",
                        code="INVITE_NOT_FOUND",
                        message="Invite not found",
                    )
                if invite["accepted_at"] is not None:
                    return error_response(
                        request,
                        status_code=409,
                        error="conflict",
                        code="INVITE_ALREADY_ACCEPTED",
                        message="Invite already accepted",
                    )
                if invite["expires_at"] < datetime.now(timezone.utc):
                    return error_response(
                        request,
                        status_code=410,
                        error="gone",
                        code="INVITE_EXPIRED",
                        message="Invite has expired",
                    )
                if str(invite["email"]).lower() != str(session.email).lower():
                    return error_response(
                        request,
                        status_code=403,
                        error="forbidden",
                        code="EMAIL_MISMATCH",
                        message="Invite email does not match session user",
                    )

                await conn.execute(
                    """
                    UPDATE workspace_invites
                    SET accepted_at = now()
                    WHERE id = $1
                    """,
                    invite_uuid,
                )
                await conn.execute(
                    """
                    INSERT INTO workspace_members (workspace_id, user_id, role)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
                    WHERE CASE workspace_members.role
                            WHEN 'owner'  THEN 3
                            WHEN 'editor' THEN 2
                            WHEN 'viewer' THEN 1 ELSE 0 END
                        < CASE EXCLUDED.role
                            WHEN 'owner'  THEN 3
                            WHEN 'editor' THEN 2
                            WHEN 'viewer' THEN 1 ELSE 0 END
                    """,
                    ws_uuid,
                    uuid.UUID(str(session.user_id)),
                    invite["role"],
                )
                membership = await conn.fetchrow(
                    """
                    SELECT workspace_id, user_id, role, created_at
                    FROM workspace_members
                    WHERE workspace_id = $1 AND user_id = $2
                    """,
                    ws_uuid,
                    uuid.UUID(str(session.user_id)),
                )

        return {
            "ok": True,
            "invite": _normalize_invite_payload(invite),
            "membership": _normalize_member_payload(membership),
        }

    return router
