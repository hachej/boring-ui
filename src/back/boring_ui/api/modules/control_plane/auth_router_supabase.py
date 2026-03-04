"""Supabase-backed auth/session routes owned by boring-ui control-plane."""

from __future__ import annotations

import os
from urllib.parse import quote, urlencode, unquote, urlparse
from uuid import uuid4

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ...config import APIConfig
from .auth_session import create_session_cookie, parse_session_cookie, SessionExpired, SessionInvalid
from .supabase.token_verify import verify_token


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


def _public_origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def _is_dev_mode() -> bool:
    env = os.environ.get("ENV", "").strip().lower()
    return env in {"dev", "development", "local", "test"}


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


async def _issue_session_from_token(
    access_token: str,
    *,
    config: APIConfig,
    request: Request,
    redirect_uri_override: str | None = None,
) -> RedirectResponse | JSONResponse:
    if not config.supabase_url:
        return _error(
            request,
            status_code=500,
            error="server_error",
            code="SUPABASE_NOT_CONFIGURED",
            message="SUPABASE_URL is not configured",
        )

    try:
        payload = verify_token(
            access_token,
            supabase_url=config.supabase_url,
            supabase_jwt_secret=config.supabase_jwt_secret,
            audience="authenticated",
        )
    except Exception:
        return _error(
            request,
            status_code=401,
            error="unauthorized",
            code="TOKEN_INVALID",
            message="Token verification failed",
        )

    session_value = create_session_cookie(
        payload.user_id,
        payload.email,
        secret=config.auth_session_secret,
        ttl_seconds=config.auth_session_ttl_seconds,
    )

    redirect_uri = _safe_redirect_path(redirect_uri_override or request.query_params.get("redirect_uri"))
    response = RedirectResponse(url=redirect_uri, status_code=302)
    _set_session_cookie(response, session_value, config)
    return response


def create_auth_session_router_supabase(config: APIConfig) -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.get("/login")
    async def auth_login(request: Request):
        # Optional local dev adapter for tests and local workflows.
        if config.auth_dev_login_enabled and request.query_params.get("user_id"):
            session_result = _create_session_from_query(request, config)
            if isinstance(session_result, JSONResponse):
                return session_result
            token, redirect_uri = session_result
            response = RedirectResponse(url=redirect_uri, status_code=302)
            _set_session_cookie(response, token, config)
            return response

        if not config.supabase_url:
            return _error(
                request,
                status_code=501,
                error="not_implemented",
                code="LOGIN_NOT_CONFIGURED",
                message="Supabase login is not configured",
            )

        callback = f"{_public_origin(request).rstrip('/')}/auth/callback"
        redirect_after = _safe_redirect_path(request.query_params.get("redirect_uri"))
        redirect_to = f"{callback}?redirect_uri={quote(redirect_after, safe='')}"
        params = urlencode({"provider": "email", "redirect_to": redirect_to})
        return RedirectResponse(
            url=f"{config.supabase_url.rstrip('/')}/auth/v1/authorize?{params}",
            status_code=302,
        )

    @router.get("/callback")
    async def auth_callback(request: Request):
        # Local dev login fallback path.
        if config.auth_dev_login_enabled and request.query_params.get("user_id"):
            session_result = _create_session_from_query(request, config)
            if isinstance(session_result, JSONResponse):
                return session_result
            token, redirect_uri = session_result
            response = RedirectResponse(url=redirect_uri, status_code=302)
            _set_session_cookie(response, token, config)
            return response

        if not config.supabase_url:
            return _error(
                request,
                status_code=500,
                error="server_error",
                code="SUPABASE_NOT_CONFIGURED",
                message="SUPABASE_URL is not configured",
            )

        access_token = request.query_params.get("access_token")
        if access_token and _is_dev_mode():
            return await _issue_session_from_token(access_token, config=config, request=request)

        code = request.query_params.get("code")
        token_hash = request.query_params.get("token_hash")
        verify_type = request.query_params.get("type")

        if not code and not (token_hash and verify_type):
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="MISSING_AUTH_PARAMS",
                message="Expected code or token_hash/type callback params",
            )

        headers = {
            "apikey": (config.supabase_anon_key or ""),
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                if code:
                    token_url = f"{config.supabase_url.rstrip('/')}/auth/v1/token?grant_type=pkce"
                    resp = await client.post(token_url, json={"code": code}, headers=headers)
                else:
                    verify_url = f"{config.supabase_url.rstrip('/')}/auth/v1/verify"
                    resp = await client.post(
                        verify_url,
                        json={"type": verify_type, "token_hash": token_hash},
                        headers=headers,
                    )
            if resp.status_code != 200:
                return _error(
                    request,
                    status_code=401,
                    error="unauthorized",
                    code="PKCE_EXCHANGE_FAILED",
                    message="Supabase callback exchange failed",
                )
            token_data = resp.json()
            access_token = token_data.get("access_token")
        except Exception:
            return _error(
                request,
                status_code=502,
                error="server_error",
                code="SUPABASE_UNREACHABLE",
                message="Unable to reach Supabase auth",
            )

        if not access_token:
            return _error(
                request,
                status_code=401,
                error="unauthorized",
                code="NO_ACCESS_TOKEN",
                message="Supabase callback did not return access token",
            )

        return await _issue_session_from_token(access_token, config=config, request=request)

    @router.post("/token-exchange")
    async def auth_token_exchange(request: Request):
        if not config.supabase_url:
            return _error(
                request,
                status_code=500,
                error="server_error",
                code="SUPABASE_NOT_CONFIGURED",
                message="SUPABASE_URL is not configured",
            )
        try:
            body = await request.json()
        except Exception:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_JSON",
                message="Expected JSON payload",
            )
        if not isinstance(body, dict):
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="INVALID_JSON",
                message="Expected JSON object",
            )
        access_token = body.get("access_token")
        if not isinstance(access_token, str) or not access_token.strip():
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="MISSING_ACCESS_TOKEN",
                message="access_token is required",
            )

        redirect_uri = _safe_redirect_path(body.get("redirect_uri"))
        token_result = await _issue_session_from_token(
            access_token,
            config=config,
            request=request,
            redirect_uri_override=redirect_uri,
        )
        if not isinstance(token_result, RedirectResponse):
            return token_result

        response = JSONResponse(
            status_code=200,
            content={"ok": True, "redirect_uri": token_result.headers.get("location", "/")},
        )
        for key, value in token_result.raw_headers:
            if key.lower() == b"set-cookie":
                response.raw_headers.append((key, value))
        return response

    @router.get("/logout")
    def auth_logout(request: Request):
        response = JSONResponse({"ok": True, "status": "logged_out"})
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
