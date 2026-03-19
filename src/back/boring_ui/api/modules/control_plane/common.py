"""Shared helpers for hosted control-plane routes."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from ...config import APIConfig
from .auth_session import SessionExpired, SessionInvalid, SessionPayload, parse_session_cookie
from . import db_client


def request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "") or uuid.uuid4())


def error_response(
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
            "request_id": request_id(request),
        },
    )


def load_session(request: Request, config: APIConfig) -> SessionPayload | JSONResponse:
    token = request.cookies.get(config.auth_session_cookie_name, "")
    if not token:
        return error_response(
            request,
            status_code=401,
            error="unauthorized",
            code="SESSION_REQUIRED",
            message="No active session",
        )
    try:
        return parse_session_cookie(token, secret=config.auth_session_secret)
    except SessionExpired:
        return error_response(
            request,
            status_code=401,
            error="unauthorized",
            code="SESSION_EXPIRED",
            message="Session expired",
        )
    except SessionInvalid:
        return error_response(
            request,
            status_code=401,
            error="unauthorized",
            code="SESSION_INVALID",
            message="Session invalid",
        )


def ensure_pool(request: Request):
    try:
        return db_client.get_pool()
    except RuntimeError:
        return error_response(
            request,
            status_code=500,
            error="server_error",
            code="DB_POOL_UNAVAILABLE",
            message="Control-plane DB pool is not initialized",
        )


def normalize_workspace_payload(row: Any) -> dict[str, Any]:
    app_id = row["app_id"] if "app_id" in row else "boring-ui"
    return {
        "id": str(row["id"]),
        "workspace_id": str(row["id"]),
        "app_id": app_id,
        "name": row["name"],
        "created_by": str(row["created_by"]),
    }
