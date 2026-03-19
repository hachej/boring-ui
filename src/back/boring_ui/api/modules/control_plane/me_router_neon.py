"""Hosted-control-plane user identity/settings routes for Neon mode."""

from __future__ import annotations

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .common import load_session
from .user_settings_state import (
    build_me_payload,
    read_user_settings,
    touch_user_profile,
    user_state_service,
    write_user_settings,
)


def create_me_router_neon(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["user"])
    service = user_state_service(config)

    @router.get("/me")
    def get_me(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.user.me.get",
        )
        if deny is not None:
            return deny

        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error

        return build_me_payload(touch_user_profile(service, user_id=session.user_id, email=session.email))

    @router.get("/me/settings")
    def get_me_settings(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.user.settings.get",
        )
        if deny is not None:
            return deny
        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error
        settings = read_user_settings(service, session.user_id)
        return {"ok": True, "settings": settings}

    @router.put("/me/settings")
    def put_me_settings(request: Request, body: dict | None = Body(default=None)):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.user.settings.update",
        )
        if deny is not None:
            return deny
        session_or_error = load_session(request, config)
        if isinstance(session_or_error, JSONResponse):
            return session_or_error
        session = session_or_error
        settings = write_user_settings(
            service,
            user_id=session.user_id,
            email=session.email,
            settings=dict(body or {}),
        )
        return {"ok": True, "settings": settings}

    return router
