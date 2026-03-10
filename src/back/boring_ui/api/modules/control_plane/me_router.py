"""Canonical user identity/settings routes owned by boring-ui control-plane."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .auth_session import SessionExpired, SessionInvalid, parse_session_cookie
from .repository import LocalControlPlaneRepository
from .service import ControlPlaneService


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


def _to_me_payload(user: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "user_id": str(user.get("user_id", "")).strip(),
        "email": str(user.get("email", "")).strip().lower(),
        "display_name": str(user.get("display_name", "")).strip(),
    }
    return {
        "ok": True,
        **payload,
        "user": dict(payload),
        "me": dict(payload),
        "data": dict(payload),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_me_router(config: APIConfig) -> APIRouter:
    """Create canonical `/api/v1/me` routes."""

    router = APIRouter(tags=["user"])
    service = _service(config)

    @router.get("/me")
    def get_me(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.user.me.get",
        )
        if deny is not None:
            return deny

        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        existing = next(
            (user for user in service.list_users() if user.get("user_id") == session.user_id),
            None,
        )
        merged_user = service.upsert_user(
            session.user_id,
            {
                "email": session.email,
                "display_name": (existing or {}).get("display_name", ""),
                "last_seen_at": _now_iso(),
            },
        )
        return _to_me_payload(merged_user)

    @router.get("/me/settings")
    def get_me_settings(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.user.settings.get",
        )
        if deny is not None:
            return deny

        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        existing = next(
            (user for user in service.list_users() if user.get("user_id") == session.user_id),
            None,
        )
        settings = dict((existing or {}).get("settings") or {})
        return {"ok": True, "settings": settings}

    @router.put("/me/settings")
    def put_me_settings(
        request: Request,
        body: dict[str, Any] | None = Body(default=None),
    ):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.user.settings.update",
        )
        if deny is not None:
            return deny

        session_or_error = _load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        existing = next(
            (user for user in service.list_users() if user.get("user_id") == session.user_id),
            None,
        )
        profile = {
            "email": session.email,
            "display_name": str((existing or {}).get("display_name", "")).strip(),
            "settings": dict(body or {}),
            "last_seen_at": _now_iso(),
        }
        service.upsert_user(session.user_id, profile)
        return {"ok": True, "settings": dict(body or {})}

    return router

