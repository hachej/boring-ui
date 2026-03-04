"""Supabase-backed canonical user identity/settings routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .supabase.common import load_session


def create_me_router_supabase(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["user"])

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

        payload = {
            "user_id": session.user_id,
            "email": session.email,
            "display_name": "",
        }
        return {
            "ok": True,
            **payload,
            "user": dict(payload),
            "me": dict(payload),
            "data": dict(payload),
        }

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
        return {"ok": True, "settings": {}}

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
        return {"ok": True, "settings": dict(body or {})}

    return router
