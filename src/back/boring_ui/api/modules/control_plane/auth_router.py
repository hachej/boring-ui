"""Auth/session routes owned by boring-ui control-plane."""

from __future__ import annotations

from urllib.parse import unquote, urlparse
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ...config import APIConfig
from .auth_session import (
    SessionExpired,
    SessionInvalid,
    create_session_cookie,
    parse_session_cookie,
)


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


def _safe_redirect_path(raw: str | None) -> str:
    candidate = str(raw or "/").strip()
    parsed = urlparse(candidate)
    if parsed.scheme or parsed.netloc:
        return "/"
    if not candidate.startswith("/") or candidate.startswith("//"):
        return "/"
    normalized = unquote(candidate)
    if normalized.startswith("//"):
        return "/"
    if any(ch in normalized for ch in ("\x00", "\r", "\n", "<", ">", '"', "'", "`")):
        return "/"
    return candidate


def _set_session_cookie(response: JSONResponse | RedirectResponse, token: str, config: APIConfig) -> None:
    response.set_cookie(
        key=config.auth_session_cookie_name,
        value=token,
        max_age=config.auth_session_ttl_seconds,
        httponly=True,
        secure=config.auth_session_secure_cookie,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: JSONResponse, config: APIConfig) -> None:
    response.delete_cookie(
        key=config.auth_session_cookie_name,
        path="/",
        secure=config.auth_session_secure_cookie,
        httponly=True,
        samesite="lax",
    )


def _create_session_from_query(request: Request, config: APIConfig) -> tuple[str, str] | JSONResponse:
    user_id = str(request.query_params.get("user_id", "")).strip()
    email = str(request.query_params.get("email", "")).strip().lower()
    if not user_id or not email:
        return _error(
            request,
            status_code=400,
            error="bad_request",
            code="LOGIN_IDENTITY_REQUIRED",
            message="user_id and email query params are required",
        )
    token = create_session_cookie(
        user_id,
        email,
        secret=config.auth_session_secret,
        ttl_seconds=config.auth_session_ttl_seconds,
    )
    return token, _safe_redirect_path(request.query_params.get("redirect_uri"))


def _require_dev_login_enabled(request: Request, config: APIConfig) -> JSONResponse | None:
    if config.auth_dev_login_enabled:
        return None
    return _error(
        request,
        status_code=501,
        error="not_implemented",
        code="LOGIN_NOT_CONFIGURED",
        message="Auth login/callback dev adapter is disabled; set AUTH_DEV_LOGIN_ENABLED=true for local flow",
    )


def create_auth_session_router(config: APIConfig) -> APIRouter:
    """Create /auth endpoints for session lifecycle."""

    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.get("/login")
    def auth_login(request: Request):
        deny = _require_dev_login_enabled(request, config)
        if deny is not None:
            return deny
        session_result = _create_session_from_query(request, config)
        if isinstance(session_result, JSONResponse):
            return session_result
        token, redirect_uri = session_result
        response = RedirectResponse(url=redirect_uri, status_code=302)
        _set_session_cookie(response, token, config)
        return response

    @router.get("/callback")
    def auth_callback(request: Request):
        deny = _require_dev_login_enabled(request, config)
        if deny is not None:
            return deny
        session_result = _create_session_from_query(request, config)
        if isinstance(session_result, JSONResponse):
            return session_result
        token, redirect_uri = session_result
        response = RedirectResponse(url=redirect_uri, status_code=302)
        _set_session_cookie(response, token, config)
        return response

    @router.get("/logout")
    def auth_logout(request: Request):
        response = RedirectResponse(url="/auth/login", status_code=302)
        _clear_session_cookie(response, config)
        return response

    @router.get("/session")
    def auth_session(request: Request):
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
            session = parse_session_cookie(token, secret=config.auth_session_secret)
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
        return {
            "ok": True,
            "authenticated": True,
            "user": {
                "user_id": session.user_id,
                "email": session.email,
            },
            "expires_at": session.exp,
        }

    return router
