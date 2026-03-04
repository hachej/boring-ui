"""Canonical workspace collaboration routes (members + invites)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .auth_session import SessionExpired, SessionInvalid, parse_session_cookie
from .repository import LocalControlPlaneRepository
from .service import ControlPlaneService

VALID_ROLES = {"owner", "editor", "viewer"}


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


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    candidate = str(raw).strip()
    if not candidate:
        return None
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def _service(config: APIConfig) -> ControlPlaneService:
    state_path = config.validate_path(config.control_plane_state_relpath)
    return ControlPlaneService(LocalControlPlaneRepository(state_path), workspace_root=config.workspace_root)


def _load_session(request: Request, config: APIConfig):
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


def _normalize_role(raw: Any, *, fallback: str = "viewer") -> str:
    role = str(raw or "").strip().lower()
    return role if role in VALID_ROLES else fallback


def _ensure_workspace_exists(service: ControlPlaneService, workspace_id: str) -> None:
    exists = any(item.get("workspace_id") == workspace_id for item in service.list_workspaces())
    if not exists:
        service.upsert_workspace(workspace_id, {"name": workspace_id})


def _workspace_memberships(service: ControlPlaneService, workspace_id: str) -> list[dict[str, Any]]:
    return [
        item
        for item in service.list_memberships()
        if item.get("workspace_id") == workspace_id and item.get("deleted_at") is None
    ]


def _workspace_invites(service: ControlPlaneService, workspace_id: str) -> list[dict[str, Any]]:
    return [
        item
        for item in service.list_invites()
        if item.get("workspace_id") == workspace_id and item.get("deleted_at") is None
    ]


def _membership_id(workspace_id: str, user_id: str) -> str:
    return f"{workspace_id}:{user_id}"


def _find_invite(service: ControlPlaneService, workspace_id: str, invite_id: str) -> dict[str, Any] | None:
    return next(
        (
            invite
            for invite in _workspace_invites(service, workspace_id)
            if str(invite.get("invite_id", "")).strip() == invite_id
        ),
        None,
    )


def _caller_role(service: ControlPlaneService, workspace_id: str, user_id: str) -> str | None:
    membership = next(
        (
            item
            for item in _workspace_memberships(service, workspace_id)
            if str(item.get("user_id", "")).strip() == user_id
        ),
        None,
    )
    if membership is None:
        return None
    return str(membership.get("role", "")).strip().lower() or None


def _maybe_bootstrap_owner(
    service: ControlPlaneService,
    *,
    workspace_id: str,
    user_id: str,
    email: str,
) -> None:
    if _workspace_memberships(service, workspace_id):
        return
    service.upsert_user(user_id, {"email": email})
    service.upsert_membership(
        _membership_id(workspace_id, user_id),
        {
            "workspace_id": workspace_id,
            "user_id": user_id,
            "role": "owner",
            "status": "active",
        },
    )


def create_collaboration_router(config: APIConfig) -> APIRouter:
    """Create canonical `/api/v1/workspaces/{id}/members*` + `/invites*` routes."""

    router = APIRouter(tags=["collaboration"])
    service = _service(config)

    @router.get("/workspaces/{workspace_id}/members")
    def list_members(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.collaboration.members.list",
        )
        if deny is not None:
            return deny
        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        _ensure_workspace_exists(service, workspace_id)
        _maybe_bootstrap_owner(
            service,
            workspace_id=workspace_id,
            user_id=session.user_id,
            email=session.email,
        )
        caller_role = _caller_role(service, workspace_id, session.user_id)
        if caller_role is None:
            return _error(
                request,
                status_code=403,
                error="forbidden",
                code="MEMBER_ROLE_REQUIRED",
                message="Workspace membership required",
            )

        members = _workspace_memberships(service, workspace_id)
        return {"ok": True, "members": members, "count": len(members)}

    @router.put("/workspaces/{workspace_id}/members/{user_id}")
    def upsert_member(
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
        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        payload = dict(body or {})
        _ensure_workspace_exists(service, workspace_id)
        _maybe_bootstrap_owner(
            service,
            workspace_id=workspace_id,
            user_id=session.user_id,
            email=session.email,
        )
        if _caller_role(service, workspace_id, session.user_id) != "owner":
            return _error(
                request,
                status_code=403,
                error="forbidden",
                code="ROLE_REQUIRED_OWNER",
                message="Owner role required",
            )

        target_email = str(payload.get("email", "")).strip().lower()
        if target_email:
            service.upsert_user(
                user_id,
                {
                    "email": target_email,
                    "display_name": str(payload.get("display_name", "")).strip(),
                },
            )
        membership = service.upsert_membership(
            _membership_id(workspace_id, user_id),
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "role": _normalize_role(payload.get("role"), fallback="viewer"),
                "status": "active",
                "deleted_at": None,
            },
        )
        return {"ok": True, "member": membership}

    @router.get("/workspaces/{workspace_id}/invites")
    def list_invites(workspace_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.collaboration.invites.list",
        )
        if deny is not None:
            return deny
        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        _ensure_workspace_exists(service, workspace_id)
        _maybe_bootstrap_owner(
            service,
            workspace_id=workspace_id,
            user_id=session.user_id,
            email=session.email,
        )
        caller_role = _caller_role(service, workspace_id, session.user_id)
        if caller_role not in {"owner", "editor"}:
            return _error(
                request,
                status_code=403,
                error="forbidden",
                code="ROLE_REQUIRED_EDITOR",
                message="Owner or editor role required",
            )
        invites = _workspace_invites(service, workspace_id)
        return {"ok": True, "invites": invites, "count": len(invites)}

    @router.post("/workspaces/{workspace_id}/invites")
    def create_invite(
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
        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        payload = dict(body or {})
        invite_email = str(payload.get("email", "")).strip().lower()
        if not invite_email:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="INVITE_EMAIL_REQUIRED",
                message="email is required",
            )

        _ensure_workspace_exists(service, workspace_id)
        _maybe_bootstrap_owner(
            service,
            workspace_id=workspace_id,
            user_id=session.user_id,
            email=session.email,
        )
        caller_role = _caller_role(service, workspace_id, session.user_id)
        if caller_role not in {"owner", "editor"}:
            return _error(
                request,
                status_code=403,
                error="forbidden",
                code="ROLE_REQUIRED_EDITOR",
                message="Owner or editor role required",
            )

        invite_id = str(payload.get("invite_id", "")).strip() or f"inv-{uuid4().hex[:8]}"
        expires_at = payload.get("expires_at")
        if not expires_at:
            expires_days = int(payload.get("expires_in_days", 7))
            expires_at = (_now() + timedelta(days=max(expires_days, 1))).isoformat()
        invite = service.upsert_invite(
            invite_id,
            {
                "workspace_id": workspace_id,
                "email": invite_email,
                "role": _normalize_role(payload.get("role"), fallback="editor"),
                "status": "pending",
                "created_by_user_id": session.user_id,
                "accepted_at": None,
                "accepted_by_user_id": None,
                "expires_at": expires_at,
            },
        )
        return {"ok": True, "invite": invite}

    @router.post("/workspaces/{workspace_id}/invites/{invite_id}/accept")
    def accept_invite(workspace_id: str, invite_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.collaboration.invites.accept",
        )
        if deny is not None:
            return deny
        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        _ensure_workspace_exists(service, workspace_id)
        invite = _find_invite(service, workspace_id, invite_id)
        if invite is None:
            return _error(
                request,
                status_code=404,
                error="not_found",
                code="INVITE_NOT_FOUND",
                message="Invite not found",
            )
        if str(invite.get("accepted_at") or "").strip():
            return _error(
                request,
                status_code=409,
                error="conflict",
                code="INVITE_ALREADY_ACCEPTED",
                message="Invite has already been accepted",
            )
        if str(invite.get("email", "")).strip().lower() != session.email:
            return _error(
                request,
                status_code=403,
                error="forbidden",
                code="INVITE_EMAIL_MISMATCH",
                message="Invite email does not match session user",
            )
        expiry = _parse_iso(str(invite.get("expires_at", "")).strip())
        if expiry is not None and expiry <= _now():
            return _error(
                request,
                status_code=410,
                error="gone",
                code="INVITE_EXPIRED",
                message="Invite has expired",
            )

        membership = service.upsert_membership(
            _membership_id(workspace_id, session.user_id),
            {
                "workspace_id": workspace_id,
                "user_id": session.user_id,
                "role": _normalize_role(invite.get("role"), fallback="viewer"),
                "status": "active",
                "deleted_at": None,
            },
        )
        updated_invite = service.upsert_invite(
            invite_id,
            {
                **invite,
                "status": "accepted",
                "accepted_at": _now_iso(),
                "accepted_by_user_id": session.user_id,
            },
        )
        return {"ok": True, "invite": updated_invite, "membership": membership}

    return router

