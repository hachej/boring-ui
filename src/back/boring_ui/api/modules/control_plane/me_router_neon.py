"""Hosted-control-plane user identity/settings routes for Neon mode.

User settings are stored in the ``user_settings`` table in the Neon DB
(not a local JSON file) so they persist across container restarts and
are accessible from any Machine in the same app.
"""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .common import ensure_pool, error_response, load_session
from .user_settings_state import build_me_payload

logger = logging.getLogger(__name__)


def create_me_router_neon(config: APIConfig) -> APIRouter:
    router = APIRouter(tags=["user"])
    app_id = config.control_plane_app_id or "boring-ui"

    async def _get_user_row(pool, user_id: str):
        return await pool.fetchrow(
            "SELECT settings, email, display_name FROM user_settings WHERE user_id = $1 AND app_id = $2",
            uuid.UUID(str(user_id)),
            app_id,
        )

    async def _upsert_user(pool, user_id: str, email: str, display_name: str, settings: dict):
        await pool.execute(
            """
            INSERT INTO user_settings (user_id, app_id, settings, email, display_name, updated_at)
            VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (user_id, app_id)
            DO UPDATE SET settings = $3, email = $4, display_name = $5, updated_at = now()
            """,
            uuid.UUID(str(user_id)),
            app_id,
            json.dumps(settings),
            email,
            display_name,
        )

    @router.get("/me")
    async def get_me(request: Request):
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

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        row = await _get_user_row(pool, session.user_id)
        if row is None:
            # First visit — touch profile
            await _upsert_user(pool, session.user_id, session.email, "", {})
            row = {"settings": "{}", "email": session.email, "display_name": ""}

        return build_me_payload({
            "user_id": session.user_id,
            "email": row["email"] or session.email,
            "display_name": row["display_name"] or "",
        })

    @router.get("/me/settings")
    async def get_me_settings(request: Request):
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

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        row = await _get_user_row(pool, session.user_id)
        try:
            settings = json.loads(row["settings"]) if row and row["settings"] else {}
        except (json.JSONDecodeError, TypeError):
            settings = {}
        return {"ok": True, "settings": settings}

    @router.put("/me/settings")
    async def put_me_settings(request: Request, body: dict | None = Body(default=None)):
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

        pool_or_error = ensure_pool(request)
        if isinstance(pool_or_error, JSONResponse):
            return pool_or_error
        pool = pool_or_error

        # Merge with existing
        row = await _get_user_row(pool, session.user_id)
        try:
            existing = json.loads(row["settings"]) if row and row["settings"] else {}
        except (json.JSONDecodeError, TypeError):
            existing = {}
        merged = {**existing, **dict(body or {})}

        display_name = str(merged.get("display_name", (row["display_name"] if row else "") or "")).strip()

        await _upsert_user(pool, session.user_id, session.email, display_name, merged)
        return {"ok": True, "settings": merged}

    return router
