"""Neon Auth (Better Auth) backed auth/session routes for boring-ui control-plane.

This module uses Neon Auth endpoints for the hosted login flows. The main flows are:

1. Sign in: browser POSTs to boring-ui, backend authenticates against Neon,
   fetches the JWT from ``/token``, and issues ``boring_session``.
2. Sign up: browser POSTs to boring-ui, backend creates the Neon account and
   returns a "check your email" response instead of auto-signing the user in.
3. Email verification: Neon redirects back to ``/auth/callback`` and the
   callback page exchanges the Neon session for a boring-ui session cookie.
4. Password reset: boring-ui requests a reset email, Neon redirects back to
   ``/auth/reset-password?token=...``, and the browser submits the new password
   through boring-ui to Neon.
"""

from __future__ import annotations

import logging
import base64
import hashlib
import json
from urllib.parse import quote, unquote, urlparse
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from ...config import APIConfig
from .auth_session import create_session_cookie, parse_session_cookie, SessionExpired, SessionInvalid

_logger = logging.getLogger(__name__)
_PENDING_LOGIN_TTL_SECONDS = 30 * 60


# ---------------------------------------------------------------------------
# Shared helpers for hosted auth flows.
# ---------------------------------------------------------------------------

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


def _clear_session_cookie(response: JSONResponse | RedirectResponse, config: APIConfig) -> None:
    response.delete_cookie(
        key=config.auth_session_cookie_name,
        path="/",
        secure=config.auth_session_secure_cookie,
        httponly=True,
        samesite="lax",
    )


def _normalize_origin(raw: str) -> str:
    text = str(raw or "").strip()
    parsed = urlparse(text)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return ""


def _public_origin(request: Request, *, config: APIConfig) -> str:
    if config.public_app_origin:
        return config.public_app_origin

    origin = str(request.headers.get("origin", "")).strip()
    normalized_origin = _normalize_origin(origin)
    # Fly.io terminates TLS — request.base_url is http://. Use X-Forwarded-Proto.
    raw_base = str(request.base_url).rstrip("/")
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto == "https" and raw_base.startswith("http://"):
        raw_base = "https://" + raw_base[len("http://"):]
    request_origin = _normalize_origin(raw_base)
    allowed_origins = {
        normalized
        for normalized in (_normalize_origin(item) for item in (config.cors_origins or []))
        if normalized
    }
    if normalized_origin and normalized_origin in allowed_origins:
        return normalized_origin

    # Hosted same-origin requests can legitimately arrive from domains that are
    # not prelisted in the dev-focused CORS default set (for example Modal
    # deployment URLs). When the browser Origin matches the request base URL
    # exactly and the request is HTTPS, trust that same-origin host for
    # callback generation instead of falling back to a local dev origin.
    if (
        normalized_origin
        and request_origin
        and normalized_origin == request_origin
        and urlparse(request_origin).scheme == "https"
    ):
        return request_origin

    if request_origin and request_origin in allowed_origins:
        return request_origin

    if allowed_origins:
        return sorted(allowed_origins)[0]

    return request_origin or str(request.base_url).rstrip("/")


def _build_callback_url(
    request: Request,
    *,
    config: APIConfig,
    redirect_uri: str,
    pending_login: str | None = None,
) -> str:
    base = _public_origin(request, config=config)
    query = _build_callback_query(
        redirect_uri=redirect_uri,
        pending_login=pending_login,
    )
    return f"{base}/auth/callback?{query}"


def _build_callback_query(
    *,
    redirect_uri: str,
    pending_login: str | None = None,
) -> str:
    query = f"redirect_uri={quote(redirect_uri, safe='/')}"
    if pending_login:
        query = f"{query}&pending_login={quote(pending_login, safe='')}"
    return query


def _build_callback_path(
    *,
    redirect_uri: str,
    pending_login: str | None = None,
) -> str:
    return f"/auth/callback?{_build_callback_query(redirect_uri=redirect_uri, pending_login=pending_login)}"


def _build_password_reset_url(
    request: Request,
    *,
    config: APIConfig,
    redirect_uri: str,
) -> str:
    base = _public_origin(request, config=config)
    query = f"redirect_uri={quote(redirect_uri, safe='/')}"
    return f"{base}/auth/reset-password?{query}"


def _pending_login_fernet(config: APIConfig) -> Fernet:
    digest = hashlib.sha256(config.auth_session_secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encode_pending_login(*, config: APIConfig, email: str, password: str) -> str:
    payload = json.dumps(
        {"email": email, "password": password},
        separators=(",", ":"),
    ).encode("utf-8")
    return _pending_login_fernet(config).encrypt(payload).decode("utf-8")


def _decode_pending_login(*, config: APIConfig, token: str) -> dict[str, str] | None:
    try:
        raw = _pending_login_fernet(config).decrypt(
            token.encode("utf-8"),
            ttl=_PENDING_LOGIN_TTL_SECONDS,
        )
        payload = json.loads(raw.decode("utf-8"))
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()
    if not email or not password:
        return None
    return {"email": email, "password": password}


def _parse_neon_error_message(payload: object, fallback: str) -> str:
    if isinstance(payload, str):
        text = payload.strip()
        return text or fallback
    if isinstance(payload, dict):
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        nested_error = payload.get("error")
        if isinstance(nested_error, dict):
            nested_message = nested_error.get("message")
            if isinstance(nested_message, str) and nested_message.strip():
                return nested_message.strip()
        if isinstance(nested_error, str) and nested_error.strip():
            return nested_error.strip()
        status_text = payload.get("statusText")
        if isinstance(status_text, str) and status_text.strip():
            return status_text.strip()
    return fallback


def _verification_email_disabled_message() -> str:
    return "Account created, but verification email delivery is not configured for this deployment."


def _verification_email_failed_message() -> str:
    return "Account created, but we could not send the verification email. Try again later or contact the administrator."


def _issue_session_response(
    request: Request,
    *,
    config: APIConfig,
    access_token: str,
    redirect_uri: str,
) -> JSONResponse:
    verified = _validate_neon_jwt(access_token, config=config)
    if verified is None:
        return _error(
            request,
            status_code=401,
            error="unauthorized",
            code="TOKEN_INVALID",
            message="Neon Auth JWT verification failed",
        )

    user_id = str(verified.get("user_id", "")).strip()
    email = str(verified.get("email", "")).strip().lower()

    if not user_id or not email:
        return _error(
            request,
            status_code=401,
            error="unauthorized",
            code="INCOMPLETE_IDENTITY",
            message="Session did not return user_id or email",
        )

    session_value = create_session_cookie(
        user_id,
        email,
        secret=config.auth_session_secret,
        ttl_seconds=config.auth_session_ttl_seconds,
        app_id=config.control_plane_app_id,
    )

    response = JSONResponse(
        status_code=200,
        content={"ok": True, "redirect_uri": redirect_uri},
    )
    _set_session_cookie(response, session_value, config)
    return response


_background_tasks: set = set()


async def _eager_workspace_provision(
    request: Request,
    *,
    config: APIConfig,
    user_id: str,
) -> str | None:
    """Best-effort create a default workspace for new users at login time.

    Called after a successful token-exchange so the Fly Machine is already
    being provisioned by the time the user lands on the dashboard.  Failures
    are logged but never surface to the caller -- auth must always succeed.

    ``user_id`` is passed directly by the caller (already validated from the
    JWT) to avoid redundant token re-validation.

    Returns the workspace id (str) on success, or ``None`` on failure.
    """
    import asyncio

    try:
        if not user_id:
            return None

        from . import db_client
        pool = db_client.get_pool()

        from .workspace_router_hosted import create_workspace_for_user
        workspace_id, created = await create_workspace_for_user(
            pool,
            config.control_plane_app_id,
            user_id,
            "My Workspace",
            is_default=True,
        )
        _logger.info(
            "token-exchange: eager provision resolved user=%s workspace=%s created=%s",
            user_id,
            workspace_id,
            created,
        )
        provisioner = getattr(request.app.state, "provisioner", None)
        if provisioner:
            import uuid
            # Check if workspace needs provisioning (new or missing machine_id)
            needs_provision = created
            if not needs_provision:
                async with pool.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT machine_id FROM workspaces WHERE id = $1",
                        uuid.UUID(workspace_id),
                    )
                    needs_provision = row is not None and not row["machine_id"]

            if needs_provision:
                from .workspace_router_hosted import _provision_workspace
                task = asyncio.create_task(
                    _provision_workspace(provisioner, pool, workspace_id, config)
                )
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
                _logger.info(
                    "Eager workspace provisioning started for user %s: workspace=%s (new=%s)",
                    user_id,
                    workspace_id,
                    created,
                )
        return workspace_id
    except Exception as exc:
        _logger.warning("Eager workspace provisioning failed: %s", exc)
        return None


async def _neon_password_auth(
    request: Request,
    *,
    config: APIConfig,
    endpoint_path: str,
    payload: dict[str, str],
    upstream_error_message: str,
    missing_token_message: str,
    complete_session: bool = True,
    verification_pending_login: str | None = None,
) -> JSONResponse:
    neon_base = (config.neon_auth_base_url or "").rstrip("/")
    if not neon_base:
        return _error(
            request,
            status_code=500,
            error="server_error",
            code="NEON_AUTH_NOT_CONFIGURED",
            message="NEON_AUTH_BASE_URL is not configured",
        )

    redirect_uri = _safe_redirect_path(payload.pop("redirect_uri", "/"))
    url = f"{neon_base}/{endpoint_path.lstrip('/')}"
    # Server-to-server call: use the Neon Auth origin so Better Auth's
    # CSRF / trusted-origin check passes for any deployment domain.
    parsed_neon = urlparse(neon_base)
    neon_origin = f"{parsed_neon.scheme}://{parsed_neon.netloc}"
    upstream_payload = dict(payload)
    public_origin = _public_origin(request, config=config)
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            auth_response = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Origin": neon_origin,
                },
                json=upstream_payload,
            )
            auth_body = auth_response.json() if auth_response.content else {}
            if auth_response.status_code not in {200, 201}:
                message = _parse_neon_error_message(auth_body, upstream_error_message)
                status_code = auth_response.status_code if 400 <= auth_response.status_code < 500 else 502
                _logger.warning(
                    "Neon auth %s failed: status=%d body=%s",
                    endpoint_path, auth_response.status_code, auth_body,
                )
                return _error(
                    request,
                    status_code=status_code,
                    error="auth_failed",
                    code="NEON_AUTH_REJECTED",
                    message=message,
                )

            access_token = ""
            token_response = await client.get(f"{neon_base}/token")
            token_body = token_response.json() if token_response.content else {}
            if token_response.status_code == 200 and isinstance(token_body, dict):
                candidate = token_body.get("token")
                if isinstance(candidate, str):
                    access_token = candidate.strip()

            if not access_token and isinstance(auth_body, dict):
                candidate = auth_body.get("token")
                if isinstance(candidate, str):
                    access_token = candidate.strip()
    except httpx.TimeoutException:
        return _error(
            request,
            status_code=504,
            error="upstream_timeout",
            code="NEON_AUTH_TIMEOUT",
            message="Neon Auth did not respond in time",
        )
    except httpx.HTTPError as exc:
        _logger.warning("Neon auth request failed: %s", exc)
        return _error(
            request,
            status_code=502,
            error="upstream_error",
            code="NEON_AUTH_UNAVAILABLE",
            message="Unable to reach Neon Auth",
        )

    if not complete_session:
        # Auto-send verification email — Better Auth doesn't send on signup.
        signup_email = payload.get("email", "")
        verification_email_enabled = config.verification_email_enabled
        verification_email_error: str | None = None
        if signup_email and neon_base:
            if verification_email_enabled:
                # Build callback URL and convert to relative path.
                # Neon Auth rejects absolute callbackURLs that don't match
                # their trusted_origins exactly, but accepts relative paths
                # and resolves them against the Origin header.
                full_callback = _build_callback_url(
                    request,
                    config=config,
                    redirect_uri=redirect_uri,
                    pending_login=verification_pending_login,
                )
                from urllib.parse import urlparse
                parsed_cb = urlparse(full_callback)
                relative_callback = parsed_cb.path
                if parsed_cb.query:
                    relative_callback += "?" + parsed_cb.query

                verification_email_error = await _auto_send_verification_email(
                    neon_base=neon_base,
                    email=signup_email,
                    origin=public_origin,
                    callback_url=relative_callback,
                )
            else:
                verification_email_error = _verification_email_disabled_message()

        verification_email_sent = verification_email_enabled and not verification_email_error
        message = (
            "Check your email to verify your account."
            if verification_email_sent
            else (
                _verification_email_disabled_message()
                if not verification_email_enabled
                else _verification_email_failed_message()
            )
        )

        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "requires_email_verification": True,
                "verification_email_enabled": verification_email_enabled,
                "verification_email_sent": verification_email_sent,
                "message": message,
                "redirect_uri": redirect_uri,
            },
        )

    if not access_token:
        return _error(
            request,
            status_code=502,
            error="upstream_error",
            code="NEON_AUTH_TOKEN_MISSING",
            message=missing_token_message,
        )

    return _issue_session_response(
        request,
        config=config,
        access_token=access_token,
        redirect_uri=redirect_uri,
    )


async def _complete_pending_sign_in(
    request: Request,
    *,
    config: APIConfig,
    pending_login_token: str,
    redirect_uri: str,
) -> JSONResponse | None:
    credentials = _decode_pending_login(config=config, token=pending_login_token)
    if credentials is None:
        return None

    return await _neon_password_auth(
        request,
        config=config,
        endpoint_path="/sign-in/email",
        payload={
            "email": credentials["email"],
            "password": credentials["password"],
            "redirect_uri": redirect_uri,
        },
        upstream_error_message="Unable to complete sign-in after email verification.",
        missing_token_message="Neon Auth did not return a session token after verification.",
    )


async def _send_neon_verification_email(
    request: Request,
    *,
    config: APIConfig,
    email: str,
    redirect_uri: str,
) -> JSONResponse:
    neon_base = (config.neon_auth_base_url or "").rstrip("/")
    if not neon_base:
        return _error(
            request,
            status_code=500,
            error="server_error",
            code="NEON_AUTH_NOT_CONFIGURED",
            message="NEON_AUTH_BASE_URL is not configured",
        )

    callback_url = _build_callback_url(
        request,
        config=config,
        redirect_uri=_safe_redirect_path(redirect_uri),
    )
    # Origin must match Neon Auth's own origin, not the app's origin.
    parsed_neon = urlparse(neon_base)
    origin = f"{parsed_neon.scheme}://{parsed_neon.netloc}"

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            auth_response = await client.post(
                f"{neon_base}/send-verification-email",
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                },
                json={
                    "email": email,
                    "callbackURL": callback_url,
                },
            )
            auth_body = auth_response.json() if auth_response.content else {}
    except httpx.TimeoutException:
        return _error(
            request,
            status_code=504,
            error="upstream_timeout",
            code="NEON_AUTH_TIMEOUT",
            message="Neon Auth did not respond in time",
        )
    except httpx.HTTPError as exc:
        _logger.warning("Neon verification resend failed: %s", exc)
        return _error(
            request,
            status_code=502,
            error="upstream_error",
            code="NEON_AUTH_UNAVAILABLE",
            message="Unable to reach Neon Auth",
        )

    if auth_response.status_code not in {200, 201}:
        message = _parse_neon_error_message(auth_body, "Unable to resend verification email.")
        status_code = auth_response.status_code if 400 <= auth_response.status_code < 500 else 502
        return _error(
            request,
            status_code=status_code,
            error="auth_failed",
            code="NEON_AUTH_REJECTED",
            message=message,
        )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": "Verification email sent. Check your inbox.",
            "redirect_uri": _safe_redirect_path(redirect_uri),
        },
    )


async def _auto_send_verification_email(
    *,
    neon_base: str,
    email: str,
    origin: str,
    callback_url: str = "",
) -> str | None:
    """Best-effort send of verification email after signup."""
    try:
        payload: dict[str, str] = {"email": email}
        if callback_url:
            # Keep the full app callback URL so the verification email links
            # back to boring-ui rather than Neon Auth's host.
            payload["callbackURL"] = callback_url
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.post(
                f"{neon_base}/send-verification-email",
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                },
                json=payload,
            )
            auth_body = resp.json() if resp.content else {}
            if resp.status_code not in {200, 201}:
                _logger.warning(
                    "Auto-send verification email failed (%s): %s",
                    resp.status_code,
                    resp.text[:200],
                )
                return _parse_neon_error_message(
                    auth_body,
                    "Unable to send verification email.",
                )
            else:
                _logger.info("Verification email auto-sent to %s", email)
                return None
    except Exception:
        _logger.warning("Auto-send verification email error for %s", email, exc_info=True)
        return "Unable to send verification email."


async def _request_neon_password_reset_email(
    request: Request,
    *,
    config: APIConfig,
    email: str,
    redirect_uri: str,
) -> JSONResponse:
    neon_base = (config.neon_auth_base_url or "").rstrip("/")
    if not neon_base:
        return _error(
            request,
            status_code=500,
            error="server_error",
            code="NEON_AUTH_NOT_CONFIGURED",
            message="NEON_AUTH_BASE_URL is not configured",
        )

    redirect_after = _safe_redirect_path(redirect_uri)
    redirect_to = _build_password_reset_url(
        request,
        config=config,
        redirect_uri=redirect_after,
    )
    parsed_neon = urlparse(neon_base)
    origin = f"{parsed_neon.scheme}://{parsed_neon.netloc}"

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            auth_response = await client.post(
                f"{neon_base}/request-password-reset",
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                },
                json={
                    "email": email,
                    "redirectTo": redirect_to,
                },
            )
            auth_body = auth_response.json() if auth_response.content else {}
    except httpx.TimeoutException:
        return _error(
            request,
            status_code=504,
            error="upstream_timeout",
            code="NEON_AUTH_TIMEOUT",
            message="Neon Auth did not respond in time",
        )
    except httpx.HTTPError as exc:
        _logger.warning("Neon password reset email request failed: %s", exc)
        return _error(
            request,
            status_code=502,
            error="upstream_error",
            code="NEON_AUTH_UNAVAILABLE",
            message="Unable to reach Neon Auth",
        )

    if auth_response.status_code not in {200, 201}:
        if 400 <= auth_response.status_code < 500 and auth_response.status_code != 429:
            _logger.info(
                "Neon password reset request rejected with client error; returning generic success: status=%s body=%s",
                auth_response.status_code,
                auth_body,
            )
            return JSONResponse(
                status_code=200,
                content={
                    "ok": True,
                    "message": "Password reset email sent. Check your inbox.",
                    "redirect_uri": redirect_after,
                },
            )

        message = _parse_neon_error_message(auth_body, "Unable to send password reset email.")
        status_code = auth_response.status_code if 400 <= auth_response.status_code < 500 else 502
        return _error(
            request,
            status_code=status_code,
            error="auth_failed",
            code="NEON_AUTH_REJECTED",
            message=message,
        )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": "Password reset email sent. Check your inbox.",
            "redirect_uri": redirect_after,
        },
    )


async def _reset_neon_password(
    request: Request,
    *,
    config: APIConfig,
    token: str,
    new_password: str,
    redirect_uri: str,
) -> JSONResponse:
    neon_base = (config.neon_auth_base_url or "").rstrip("/")
    if not neon_base:
        return _error(
            request,
            status_code=500,
            error="server_error",
            code="NEON_AUTH_NOT_CONFIGURED",
            message="NEON_AUTH_BASE_URL is not configured",
        )

    parsed_neon = urlparse(neon_base)
    origin = f"{parsed_neon.scheme}://{parsed_neon.netloc}"

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            auth_response = await client.post(
                f"{neon_base}/reset-password",
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                },
                json={
                    "newPassword": new_password,
                    "token": token,
                },
            )
            auth_body = auth_response.json() if auth_response.content else {}
    except httpx.TimeoutException:
        return _error(
            request,
            status_code=504,
            error="upstream_timeout",
            code="NEON_AUTH_TIMEOUT",
            message="Neon Auth did not respond in time",
        )
    except httpx.HTTPError as exc:
        _logger.warning("Neon password reset failed: %s", exc)
        return _error(
            request,
            status_code=502,
            error="upstream_error",
            code="NEON_AUTH_UNAVAILABLE",
            message="Unable to reach Neon Auth",
        )

    if auth_response.status_code not in {200, 201}:
        message = _parse_neon_error_message(auth_body, "Unable to reset password.")
        status_code = auth_response.status_code if 400 <= auth_response.status_code < 500 else 502
        return _error(
            request,
            status_code=status_code,
            error="auth_failed",
            code="NEON_AUTH_REJECTED",
            message=message,
        )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": "Password updated. Sign in with your new password.",
            "redirect_uri": _safe_redirect_path(redirect_uri),
        },
    )


# ---------------------------------------------------------------------------
# Login / signup HTML template
# ---------------------------------------------------------------------------

_NEON_LOGIN_HTML_TEMPLATE: str = """\
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&family=Fira+Code:wght@500;600&display=swap');
    :root {
      --color-bg-primary: #ffffff;
      --color-bg-secondary: #f8f8f8;
      --color-text-primary: #1a1a1a;
      --color-text-secondary: #6b6b6b;
      --color-border: #e0e0e0;
      --color-border-strong: #767676;
      --color-accent: #007aff;
      --color-accent-hover: #005bcc;
      --color-accent-light: rgba(0, 122, 255, 0.1);
      --color-accent-foreground: #ffffff;
      --color-link: #005bcc;
      --color-error: #dc3545;
      --color-info: #17a2b8;
      --font-mono: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
      --shadow-auth: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      --focus: rgba(0, 112, 243, 0.18);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-bg-primary: #1f1f1f;
        --color-bg-secondary: #242424;
        --color-text-primary: #e0e0e0;
        --color-text-secondary: #bdbdbd;
        --color-border: #404040;
        --color-border-strong: #6b6b6b;
        --color-accent: #61dafb;
        --color-accent-hover: #3d9dd6;
        --color-accent-light: rgba(97, 218, 251, 0.15);
        --color-accent-foreground: #1a1a1a;
        --color-link: #61dafb;
        --color-error: #e74c3c;
        --color-info: #3498db;
        --shadow-auth: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 20px -10px rgb(0 0 0 / 0.58), 0 2px 8px -4px rgb(0 0 0 / 0.42);
        --focus: rgba(97, 218, 251, 0.22);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--color-text-primary);
      background:
        radial-gradient(circle at 15% 8%, var(--color-accent-light) 0, transparent 28%),
        linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg-primary));
    }
    .wrap {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .shell {
      width: min(980px, 100%);
      display: grid;
      grid-template-columns: 1.08fr 1fr;
      gap: 20px;
      align-items: stretch;
    }
    .rail {
      position: relative;
      overflow: hidden;
      background: var(--color-bg-primary);
      backdrop-filter: blur(8px);
      border: 1px solid var(--color-border);
      border-radius: 18px;
      padding: 28px;
      box-shadow: var(--shadow-auth);
      animation: enter 260ms ease-out both;
    }
    .rail::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at center, color-mix(in srgb, var(--color-accent) 22%, transparent) 1px, transparent 1.5px);
      background-size: 12px 12px;
      opacity: 0.22;
    }
    .rail::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, transparent) 0%, transparent 55%);
    }
    .rail h1 {
      margin: 0 0 10px;
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: clamp(1.55rem, 2.6vw, 2.1rem);
      line-height: 1.18;
      letter-spacing: -0.02em;
    }
    .rail p {
      margin: 0;
      color: var(--color-text-secondary);
      line-height: 1.58;
      max-width: 36ch;
    }
    .rail-code {
      margin: 18px 0 0;
      border: 1px solid color-mix(in srgb, var(--color-border) 84%, var(--color-accent));
      border-radius: 12px;
      padding: 10px 12px;
      background: color-mix(in srgb, var(--color-bg-secondary) 86%, var(--color-bg-primary));
      color: color-mix(in srgb, var(--color-accent) 62%, var(--color-text-primary));
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      letter-spacing: 0;
      white-space: pre-wrap;
    }
    .card {
      border-radius: 18px;
      background: var(--color-bg-primary);
      border: 1px solid var(--color-border);
      padding: 24px;
      box-shadow: var(--shadow-auth);
      animation: enter 260ms ease-out both;
    }
    .mode-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-radius: 12px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      padding: 4px;
      margin-bottom: 16px;
      gap: 4px;
    }
    .mode-tab {
      border: 0;
      background: transparent;
      color: var(--color-text-secondary);
      border-radius: 9px;
      padding: 9px 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 140ms ease, color 140ms ease;
    }
    .mode-tab.is-active {
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      font-weight: 700;
      box-shadow: 0 1px 0 var(--color-border);
    }
    h2 {
      margin: 0;
      font-size: 1.45rem;
      letter-spacing: -0.01em;
    }
    .subtitle {
      margin: 8px 0 0;
      color: var(--color-text-secondary);
      line-height: 1.5;
    }
    label {
      display: block;
      margin: 14px 0 6px;
      font-size: 0.9rem;
      color: var(--color-text-primary);
      font-weight: 700;
    }
    input {
      width: 100%;
      border: 1px solid var(--color-border-strong);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      border-radius: 10px;
      padding: 11px 12px;
      font-size: 1rem;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    input::placeholder { color: var(--color-text-secondary); }
    input:focus-visible {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 4px var(--focus);
    }
    .field-hidden { display: none; }
    .submit {
      margin-top: 16px;
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 12px 14px;
      background: var(--color-accent);
      color: var(--color-accent-foreground);
      font-weight: 700;
      cursor: pointer;
      transition: transform 120ms ease, background-color 120ms ease;
    }
    .submit:hover { background: var(--color-accent-hover); }
    .submit:active { transform: translateY(1px); }
    .submit:focus-visible {
      outline: none;
      box-shadow: 0 0 0 4px var(--focus);
      border-radius: 8px;
    }
    .status {
      min-height: 24px;
      margin-top: 14px;
      font-size: 0.9rem;
      color: var(--color-info);
      line-height: 1.4;
    }
    .alt-actions {
      margin-top: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .muted {
      margin: 0;
      color: var(--color-text-secondary);
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .link-btn {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--color-link);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: underline;
    }
    .link-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 4px var(--focus);
      border-radius: 6px;
    }
    .error { color: var(--color-error); }
    button:disabled, input:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 18px 0;
      color: var(--color-text-secondary);
      font-size: 0.85rem;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--color-border);
    }
    .oauth-buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .oauth-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      border: 1px solid var(--color-border-strong);
      border-radius: 10px;
      padding: 11px 14px;
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .oauth-btn:hover {
      background: var(--color-bg-secondary);
      border-color: var(--color-accent);
    }
    .oauth-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 4px var(--focus);
    }
    .oauth-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
    .oauth-hidden { display: none; }
    @keyframes enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; max-width: 560px; }
      .rail { order: 2; }
      .card { order: 1; }
    }
  </style>
</head>
<body>
    <div class="wrap">
    <div class="shell">
      <aside class="rail" aria-label="Product highlights">
        <h1 id="app-name">&lt;app-name&gt;</h1>
        <p id="app-description">&lt;app-description&gt;</p>
        <pre class="rail-code" aria-hidden="true">const session = await auth.login(email)
workspace.open(session.id)</pre>
      </aside>
      <main>
        <div id="auth-panel" class="card" role="tabpanel" aria-labelledby="tab-signin">
        <div class="mode-tabs" role="tablist" aria-label="Authentication mode">
          <button id="tab-signin" class="mode-tab is-active" role="tab" aria-selected="true" aria-controls="auth-panel" type="button">Sign in</button>
          <button id="tab-signup" class="mode-tab" role="tab" aria-selected="false" aria-controls="auth-panel" type="button">Create account</button>
        </div>
        <h2 id="title">Welcome back</h2>
        <p id="subtitle" class="subtitle">Use your email and password to continue.</p>
        <form id="auth-form" autocomplete="on" novalidate>
          <div id="name-group" class="field-hidden">
            <label for="name">Name</label>
            <input id="name" type="text" autocomplete="name" placeholder="Your name">
          </div>
          <div id="email-group">
            <label for="email">Work email</label>
            <input id="email" type="email" autocomplete="email" placeholder="you@company.com" required>
          </div>
          <div id="password-group">
            <label id="password-label" for="password">Password</label>
            <input id="password" type="password" autocomplete="current-password" placeholder="Enter your password" required>
          </div>
          <div id="confirm-password-group" class="field-hidden">
            <label for="confirm-password">Confirm new password</label>
            <input id="confirm-password" type="password" autocomplete="new-password" placeholder="Repeat your new password" required>
          </div>
          <button id="submit" class="submit" type="submit">Continue</button>
        </form>
        <div id="alt-actions" class="alt-actions">
          <p id="alt-actions-copy" class="muted">Lost access to your password?</p>
          <button id="forgot-password" class="link-btn" type="button">Forgot password?</button>
        </div>
        <div id="oauth-section" class="oauth-hidden">
          <div class="divider">or</div>
          <div class="oauth-buttons">
            <a id="oauth-google" class="oauth-btn oauth-hidden" href="#">
              <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </a>
            <a id="oauth-github" class="oauth-btn oauth-hidden" href="#">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              Continue with GitHub
            </a>
          </div>
        </div>
        <div id="status" class="status" aria-live="polite"></div>
        </div>
      </main>
    </div>
  </div>
  <script defer>
    document.addEventListener("DOMContentLoaded", function() {
    var AUTH = /*AUTH_CONFIG_JSON*/;
    var statusEl = document.getElementById("status");
    var appNameEl = document.getElementById("app-name");
    var appDescriptionEl = document.getElementById("app-description");
    var panelEl = document.getElementById("auth-panel");
    var titleEl = document.getElementById("title");
    var subtitleEl = document.getElementById("subtitle");
    var form = document.getElementById("auth-form");
    var nameGroupEl = document.getElementById("name-group");
    var emailGroupEl = document.getElementById("email-group");
    var nameEl = document.getElementById("name");
    var emailEl = document.getElementById("email");
    var passwordLabelEl = document.getElementById("password-label");
    var passwordEl = document.getElementById("password");
    var confirmPasswordGroupEl = document.getElementById("confirm-password-group");
    var confirmPasswordEl = document.getElementById("confirm-password");
    var submitEl = document.getElementById("submit");
    var altActionsEl = document.getElementById("alt-actions");
    var altActionsCopyEl = document.getElementById("alt-actions-copy");
    var forgotPasswordEl = document.getElementById("forgot-password");
    var tabSignInEl = document.getElementById("tab-signin");
    var tabSignUpEl = document.getElementById("tab-signup");
    var modeTabsEl = document.querySelector(".mode-tabs");
    var oauthSectionEl = document.getElementById("oauth-section");

    var mode = AUTH.initialMode === "sign_up"
      ? "sign_up"
      : AUTH.initialMode === "reset_password"
        ? "reset_password"
        : "sign_in";
    var busy = false;

    function setStatus(message, isError) {
      statusEl.textContent = message || "";
      statusEl.classList.toggle("error", !!isError);
    }

    function applyBranding() {
      var appName = String(AUTH.appName || "").trim() || "Boring UI";
      var appDescription = String(AUTH.appDescription || "").trim() || "";
      appNameEl.textContent = appName;
      appDescriptionEl.textContent = appDescription;
      document.title = "Sign in — " + appName;
      var railCodeEl = document.querySelector(".rail-code");
      var railCode = String(AUTH.railCode || "").trim();
      if (railCodeEl) {
        if (railCode) {
          railCodeEl.textContent = railCode;
        } else {
          railCodeEl.style.display = "none";
        }
      }
    }

    function setBusy(isBusy) {
      busy = !!isBusy;
      form.setAttribute("aria-busy", busy ? "true" : "false");
      nameEl.disabled = busy;
      emailEl.disabled = busy;
      passwordEl.disabled = busy;
      confirmPasswordEl.disabled = busy;
      submitEl.disabled = busy;
      tabSignInEl.disabled = busy;
      tabSignUpEl.disabled = busy;
      forgotPasswordEl.disabled = busy;
    }

    function setTabState(isSignUp) {
      tabSignInEl.classList.toggle("is-active", !isSignUp);
      tabSignUpEl.classList.toggle("is-active", isSignUp);
      tabSignInEl.setAttribute("aria-selected", isSignUp ? "false" : "true");
      tabSignUpEl.setAttribute("aria-selected", isSignUp ? "true" : "false");
      if (panelEl) {
        panelEl.setAttribute("aria-labelledby", isSignUp ? "tab-signup" : "tab-signin");
      }
    }

    function setMode(nextMode) {
      if (busy) return;
      mode = nextMode === "sign_up"
        ? "sign_up"
        : nextMode === "reset_password"
          ? "reset_password"
          : "sign_in";
      var signUp = mode === "sign_up";
      var resetPassword = mode === "reset_password";
      setTabState(signUp);
      if (modeTabsEl) {
        modeTabsEl.style.display = resetPassword ? "none" : "grid";
      }
      titleEl.textContent = resetPassword ? "Set a new password" : signUp ? "Create your account" : "Welcome back";
      subtitleEl.textContent = resetPassword
        ? "Choose a new password for your account."
        : signUp
          ? "Get started in minutes."
          : "Use your email and password to continue.";
      submitEl.textContent = resetPassword ? "Update password" : signUp ? "Create account" : "Continue";
      passwordLabelEl.textContent = resetPassword ? "New password" : "Password";
      passwordEl.autocomplete = signUp || resetPassword ? "new-password" : "current-password";
      passwordEl.placeholder = signUp || resetPassword ? "Create a password (8+ characters)" : "Enter your password";
      nameGroupEl.style.display = signUp ? "block" : "none";
      emailGroupEl.style.display = resetPassword ? "none" : "block";
      confirmPasswordGroupEl.style.display = resetPassword ? "block" : "none";
      altActionsEl.hidden = signUp;
      altActionsCopyEl.textContent = resetPassword
        ? "Need to try another account?"
        : "Lost access to your password?";
      forgotPasswordEl.textContent = resetPassword ? "Back to sign in" : "Forgot password?";
      if (oauthSectionEl) {
        oauthSectionEl.classList.toggle("oauth-hidden", resetPassword);
      }
      document.title = (resetPassword ? "Reset password" : signUp ? "Create account" : "Sign in")
        + " — "
        + (String(AUTH.appName || "").trim() || "Boring UI");
      confirmPasswordEl.value = "";
      setupOAuth();
      if (!resetPassword) {
        emailEl.focus();
      } else {
        passwordEl.focus();
      }
      setStatus("");
    }

    tabSignInEl.addEventListener("click", function() { setMode("sign_in"); });
    tabSignUpEl.addEventListener("click", function() { setMode("sign_up"); });
    forgotPasswordEl.addEventListener("click", async function() {
      if (busy) return;
      if (mode === "reset_password") {
        setMode("sign_in");
        return;
      }

      var email = (emailEl.value || "").trim().toLowerCase();
      if (!email) {
        setStatus("Enter your email to receive a reset link.", true);
        return;
      }

      setBusy(true);
      setStatus("Sending password reset email...");
      try {
        var resetReqResp = await fetch("/auth/request-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email,
            redirect_uri: AUTH.redirectUri || "/"
          }),
        });
        var resetReqData = {};
        try { resetReqData = await resetReqResp.json(); } catch(_) {}
        if (!resetReqResp.ok) {
          setStatus(resetReqData.message || resetReqData.error || "Unable to send password reset email.", true);
          return;
        }
        setStatus(resetReqData.message || "Password reset email sent. Check your inbox.");
      } finally {
        setBusy(false);
      }
    });

    form.addEventListener("submit", async function(event) {
      event.preventDefault();
      if (busy) return;
      var password = passwordEl.value || "";
      var email = (emailEl.value || "").trim();

      if (mode === "reset_password") {
        var token = String(AUTH.resetToken || "").trim();
        var confirmPassword = confirmPasswordEl.value || "";
        if (!token) {
          setStatus("Password reset link is missing or invalid. Request a new one.", true);
          return;
        }
        if (!password || !confirmPassword) {
          setStatus("Enter and confirm your new password.", true);
          return;
        }
        if (password !== confirmPassword) {
          setStatus("Passwords do not match.", true);
          return;
        }

        setBusy(true);
        try {
          setStatus("Updating password...");
          var resetResp = await fetch("/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: token,
              new_password: password,
              redirect_uri: AUTH.redirectUri || "/"
            }),
          });
          var resetData = {};
          try { resetData = await resetResp.json(); } catch(_) {}
          if (!resetResp.ok) {
            setStatus(resetData.message || resetData.error || "Unable to reset password.", true);
            return;
          }
          passwordEl.value = "";
          confirmPasswordEl.value = "";
          setMode("sign_in");
          setStatus(resetData.message || "Password updated. Sign in with your new password.");
        } finally {
          setBusy(false);
        }
        return;
      }

      if (!email || !password) {
        setStatus("Enter email and password.", true);
        return;
      }

      setBusy(true);
      try {
        if (mode === "sign_up") {
          setStatus("Creating account...");
          var signupResp = await fetch("/auth/sign-up", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email,
              password: password,
              name: (nameEl.value || "").trim() || email.split("@")[0],
              redirect_uri: AUTH.redirectUri || "/"
            }),
          });
          if (!signupResp.ok) {
            var signupErr = {};
            try { signupErr = await signupResp.json(); } catch(_) {}
            setStatus(signupErr.message || signupErr.error || "Unable to create account.", true);
            return;
          }
          var signupData = await signupResp.json();
          passwordEl.value = "";
          setMode("sign_in");
          setStatus(signupData.message || "Check your email to verify your account.");
          return;
        }

        // sign_in mode
        setStatus("Signing in...");
        var signinResp = await fetch("/auth/sign-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email,
            password: password,
            redirect_uri: AUTH.redirectUri || "/"
          }),
        });
        if (!signinResp.ok) {
          var signinErr = {};
          try { signinErr = await signinResp.json(); } catch(_) {}
          setStatus(signinErr.message || signinErr.error || "Unable to sign in.", true);
          return;
        }
        var signinData = await signinResp.json();
        window.location.assign(signinData.redirect_uri || "/");
      } finally {
        setBusy(false);
      }
    });

    function setupOAuth() {
      var providers = AUTH.oauthProviders || [];
      if (!providers.length) return;
      if (mode === "reset_password") return;
      oauthSectionEl.classList.remove("oauth-hidden");
      var redirectUri = AUTH.redirectUri || "/";
      providers.forEach(function(p) {
        var btn = document.getElementById("oauth-" + p);
        if (btn) {
          btn.classList.remove("oauth-hidden");
          btn.href = "/auth/social/" + p + "?redirect_uri=" + encodeURIComponent(redirectUri);
        }
      });
    }

    applyBranding();
    setMode(mode);
    if (mode === "reset_password") {
      var resetToken = String(AUTH.resetToken || "").trim();
      var resetError = String(AUTH.resetError || "").trim().toLowerCase();
      if (!resetToken) {
        setStatus("Password reset link is missing or invalid. Request a new one.", true);
      } else if (resetError) {
        setStatus(
          resetError.indexOf("invalid") >= 0 || resetError.indexOf("expired") >= 0
            ? "This password reset link is invalid or has expired. Request a new one."
            : "Unable to use this reset link: " + AUTH.resetError,
          true
        );
      }
    }
    setupOAuth();
    });
  </script>
</body>
</html>"""

_AUTH_CONFIG_PLACEHOLDER = "/*AUTH_CONFIG_JSON*/"

_NEON_CALLBACK_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Completing sign-in...</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0d1210;
      --panel: #171f1b;
      --text: #f3f5f4;
      --muted: #b3bbb7;
      --accent: #7be0a5;
      --border: rgba(255,255,255,0.08);
      --error: #ff8f8f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, sans-serif;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at top, rgba(123,224,165,0.12), transparent 40%), var(--bg);
      color: var(--text);
      padding: 24px;
    }
    .card {
      width: min(100%, 420px);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
    }
    h1 { margin: 0 0 8px; font-size: 1.4rem; }
    p { margin: 0; color: var(--muted); line-height: 1.5; }
    .error { color: var(--error); margin-top: 16px; }
    .link {
      display: inline-block;
      margin-top: 18px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1 id="title">Completing sign-in...</h1>
    <p id="status">Finishing email verification.</p>
    <p id="error" class="error" hidden></p>
    <a id="login-link" class="link" href="/auth/login" hidden>Go to login</a>
  </main>
  <script>
    (function() {
      var AUTH = /*AUTH_CONFIG_JSON*/;
      var statusEl = document.getElementById("status");
      var errorEl = document.getElementById("error");
      var loginEl = document.getElementById("login-link");

      function showError(message) {
        statusEl.textContent = "Sign-in could not be completed.";
        errorEl.hidden = false;
        errorEl.textContent = message || "Unexpected callback error.";
        loginEl.hidden = false;
        loginEl.href = "/auth/login?redirect_uri=" + encodeURIComponent(AUTH.redirectUri || "/");
      }

      async function run() {
        try {
          var tokenResp = await fetch(AUTH.neonAuthUrl + "/token", { credentials: "include" });
          var tokenPayload = {};
          try { tokenPayload = await tokenResp.json(); } catch(_) {}
          if (!tokenResp.ok || !tokenPayload.token) {
            showError(tokenPayload.message || "Verification succeeded, but no session token was returned.");
            return;
          }

          statusEl.textContent = "Starting your session...";
          var exchangeResp = await fetch("/auth/token-exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: tokenPayload.token,
              redirect_uri: AUTH.redirectUri || "/"
            }),
          });
          var exchangePayload = {};
          try { exchangePayload = await exchangeResp.json(); } catch(_) {}
          if (!exchangeResp.ok) {
            showError(exchangePayload.message || "Token exchange failed.");
            return;
          }
          window.location.replace(exchangePayload.redirect_uri || AUTH.redirectUri || "/");
        } catch (error) {
          showError((error && error.message) || "Unexpected callback error.");
        }
      }

      run();
    })();
  </script>
</body>
</html>"""


def _render_neon_login_html(
    *,
    request: Request,
    config: APIConfig,
    initial_mode: str,
) -> HTMLResponse:
    if not config.neon_auth_base_url:
        return HTMLResponse(
            status_code=500,
            content=(
                "<!doctype html><html><body>"
                "<h1>Auth not configured</h1>"
                "<p>NEON_AUTH_BASE_URL is required.</p>"
                "</body></html>"
            ),
        )

    redirect_after = _safe_redirect_path(request.query_params.get("redirect_uri"))
    cfg = {
        "neonAuthUrl": config.neon_auth_base_url.rstrip("/"),
        "redirectUri": redirect_after,
        "initialMode": (
            "sign_up"
            if initial_mode == "sign_up"
            else "reset_password" if initial_mode == "reset_password" else "sign_in"
        ),
        "resetToken": str(request.query_params.get("token", "")).strip(),
        "resetError": str(request.query_params.get("error", "")).strip(),
        "appName": config.auth_app_name,
        "appDescription": config.auth_app_description,
        "railCode": config.auth_rail_code,
        "verificationEmailEnabled": config.verification_email_enabled,
        "oauthProviders": config.auth_oauth_providers or [],
    }
    cfg_json = json.dumps(cfg, separators=(",", ":"))
    html = _NEON_LOGIN_HTML_TEMPLATE.replace(_AUTH_CONFIG_PLACEHOLDER, cfg_json, 1)

    response = HTMLResponse(content=html, status_code=200)
    response.headers["Cache-Control"] = "no-store"
    return response


def _render_neon_callback_html(
    *,
    request: Request,
    config: APIConfig,
) -> HTMLResponse:
    if not config.neon_auth_base_url:
        return HTMLResponse(
            status_code=500,
            content=(
                "<!doctype html><html><body>"
                "<h1>Auth not configured</h1>"
                "<p>NEON_AUTH_BASE_URL is required.</p>"
                "</body></html>"
            ),
        )

    redirect_after = _safe_redirect_path(request.query_params.get("redirect_uri"))
    cfg = {
        "neonAuthUrl": config.neon_auth_base_url.rstrip("/"),
        "redirectUri": redirect_after,
    }
    cfg_json = json.dumps(cfg, separators=(",", ":"))
    html = _NEON_CALLBACK_HTML.replace(_AUTH_CONFIG_PLACEHOLDER, cfg_json, 1)
    response = HTMLResponse(content=html, status_code=200)
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Neon Auth session validation helper
# ---------------------------------------------------------------------------

def _validate_neon_jwt(
    jwt_token: str,
    *,
    config: APIConfig,
) -> dict | None:
    """Verify a Neon Auth JWT using JWKS (EdDSA).

    Returns a dict with ``user_id`` and ``email`` on success, or ``None``.
    """
    from .token_verify import verify_token, TokenError

    jwks_url = config.neon_auth_jwks_url
    neon_base = (config.neon_auth_base_url or "").rstrip("/")
    if not jwks_url and neon_base:
        jwks_url = f"{neon_base}/.well-known/jwks.json"

    if not jwks_url:
        _logger.error("No JWKS URL configured for Neon Auth JWT verification")
        return None

    try:
        # Neon Auth JWT ``aud`` is the auth endpoint origin (no path).
        # Derive from neon_auth_base_url so we don't need extra config.
        aud = None
        if neon_base:
            parsed = urlparse(neon_base)
            aud = f"{parsed.scheme}://{parsed.netloc}"
        payload = verify_token(
            jwt_token,
            issuer_base_url=neon_base or "",
            jwks_url=jwks_url,
            audience=aud,
        )
        return {
            "user_id": payload.user_id,
            "email": payload.email,
        }
    except TokenError as exc:
        _logger.warning("Neon JWT verification failed: %s", exc)
        return None
    except Exception:
        _logger.exception("Neon JWT verification error")
        return None


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def create_auth_session_router_neon(config: APIConfig) -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.get("/login")
    async def auth_login(request: Request):
        # Optional local dev adapter for tests and local workflows.
        if config.auth_dev_login_enabled and request.query_params.get("user_id"):
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
                app_id=config.control_plane_app_id,
            )
            redirect_uri = _safe_redirect_path(request.query_params.get("redirect_uri"))
            response = RedirectResponse(url=redirect_uri, status_code=302)
            _set_session_cookie(response, token, config)
            return response

        return _render_neon_login_html(
            request=request,
            config=config,
            initial_mode="sign_in",
        )

    @router.get("/signup")
    async def auth_signup(request: Request):
        return _render_neon_login_html(
            request=request,
            config=config,
            initial_mode="sign_up",
        )

    @router.get("/reset-password")
    async def auth_reset_password_page(request: Request):
        return _render_neon_login_html(
            request=request,
            config=config,
            initial_mode="reset_password",
        )

    @router.post("/sign-up")
    async def auth_sign_up(request: Request):
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

        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", "")).strip()
        name = str(body.get("name", "")).strip() or email.split("@")[0]
        if not email or not password:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="EMAIL_PASSWORD_REQUIRED",
                message="email and password are required",
            )

        redirect_uri = _safe_redirect_path(body.get("redirect_uri"))
        pending_login = _encode_pending_login(
            config=config,
            email=email,
            password=password,
        )
        return await _neon_password_auth(
            request,
            config=config,
            endpoint_path="/sign-up/email",
            payload={
                "email": email,
                "password": password,
                "name": name,
                "redirect_uri": redirect_uri,
            },
            upstream_error_message="Unable to create account.",
            missing_token_message="Account created but Neon Auth did not return a session token.",
            complete_session=False,
            verification_pending_login=pending_login,
        )

    @router.post("/sign-in")
    async def auth_sign_in(request: Request):
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

        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", "")).strip()
        if not email or not password:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="EMAIL_PASSWORD_REQUIRED",
                message="email and password are required",
            )

        return await _neon_password_auth(
            request,
            config=config,
            endpoint_path="/sign-in/email",
            payload={
                "email": email,
                "password": password,
                "redirect_uri": body.get("redirect_uri", "/"),
            },
            upstream_error_message="Unable to sign in.",
            missing_token_message="Neon Auth did not return a session token.",
        )

    @router.post("/resend-verification")
    async def auth_resend_verification(request: Request):
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

        email = str(body.get("email", "")).strip().lower()
        if not email:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="EMAIL_REQUIRED",
                message="email is required",
            )

        return await _send_neon_verification_email(
            request,
            config=config,
            email=email,
            redirect_uri=str(body.get("redirect_uri", "/")),
        )

    @router.post("/request-password-reset")
    async def auth_request_password_reset(request: Request):
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

        email = str(body.get("email", "")).strip().lower()
        if not email:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="EMAIL_REQUIRED",
                message="email is required",
            )

        return await _request_neon_password_reset_email(
            request,
            config=config,
            email=email,
            redirect_uri=str(body.get("redirect_uri", "/")),
        )

    @router.post("/reset-password")
    async def auth_reset_password(request: Request):
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

        token = str(body.get("token", "")).strip()
        new_password = str(body.get("new_password") or body.get("newPassword") or "").strip()
        if not token or not new_password:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="TOKEN_PASSWORD_REQUIRED",
                message="token and new_password are required",
            )

        return await _reset_neon_password(
            request,
            config=config,
            token=token,
            new_password=new_password,
            redirect_uri=str(body.get("redirect_uri", "/")),
        )

    @router.get("/social/{provider}")
    async def auth_social_redirect(request: Request, provider: str):
        """Initiate OAuth social sign-in via Neon Auth.

        Redirects the browser to the OAuth provider (Google, GitHub, etc.)
        via Neon Auth's ``/sign-in/social`` endpoint.
        """
        if not config.neon_auth_base_url:
            return _error(
                request,
                status_code=500,
                error="server_error",
                code="NEON_AUTH_NOT_CONFIGURED",
                message="NEON_AUTH_BASE_URL is not configured",
            )

        allowed_providers = {"google", "github", "discord"}
        if provider not in allowed_providers:
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="UNSUPPORTED_PROVIDER",
                message=f"Unsupported OAuth provider: {provider}",
            )

        redirect_uri = _safe_redirect_path(request.query_params.get("redirect_uri"))
        origin = _public_origin(request, config=config)
        # Neon Auth requires a relative callbackURL + Origin header.
        callback_path = f"/auth/callback?redirect_uri={quote(redirect_uri, safe='/')}"

        neon_url = config.neon_auth_base_url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{neon_url}/sign-in/social",
                    json={
                        "provider": provider,
                        "callbackURL": callback_path,
                    },
                    headers={"Origin": origin},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    oauth_url = data.get("url")
                    if oauth_url:
                        return RedirectResponse(url=oauth_url, status_code=302)

                # If Neon Auth returns the redirect as a 3xx, follow it
                if resp.is_redirect:
                    return RedirectResponse(
                        url=str(resp.headers.get("location", "/")),
                        status_code=302,
                    )

                _logger.warning(
                    "Neon Auth social sign-in failed: status=%s body=%s",
                    resp.status_code,
                    resp.text[:200],
                )
                error_data = {}
                try:
                    error_data = resp.json()
                except Exception:
                    pass
                return _error(
                    request,
                    status_code=400,
                    error="oauth_error",
                    code=error_data.get("code", "SOCIAL_SIGNIN_FAILED"),
                    message=error_data.get("error", f"Unable to start {provider} sign-in."),
                )
        except httpx.RequestError as exc:
            _logger.exception("Neon Auth social sign-in request error")
            return _error(
                request,
                status_code=502,
                error="upstream_error",
                code="NEON_AUTH_UNREACHABLE",
                message="Unable to reach authentication service.",
            )

    @router.get("/callback")
    async def auth_callback(request: Request):
        """Neon Auth callback handler.

        Prefer a backend-completed sign-in when the callback carries a
        short-lived pending-login token from the original sign-up. That keeps
        email verification returning directly to the requested workspace path
        without depending on a third-party browser cookie fetch to Neon.
        """
        # Local dev login fallback path.
        if config.auth_dev_login_enabled and request.query_params.get("user_id"):
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
                app_id=config.control_plane_app_id,
            )
            redirect_uri = _safe_redirect_path(request.query_params.get("redirect_uri"))
            response = RedirectResponse(url=redirect_uri, status_code=302)
            _set_session_cookie(response, token, config)
            return response

        redirect_uri = _safe_redirect_path(request.query_params.get("redirect_uri"))
        pending_login_token = str(request.query_params.get("pending_login", "")).strip()
        if pending_login_token:
            completed = await _complete_pending_sign_in(
                request,
                config=config,
                pending_login_token=pending_login_token,
                redirect_uri=redirect_uri,
            )
            if completed is not None and completed.status_code == 200:
                response = RedirectResponse(url=redirect_uri, status_code=302)
                cookie_header = completed.headers.get("set-cookie")
                if cookie_header:
                    response.headers.append("set-cookie", cookie_header)
                return response

        return _render_neon_callback_html(
            request=request,
            config=config,
        )

    @router.post("/token-exchange")
    async def auth_token_exchange(request: Request):
        """Exchange a Neon Auth session token for a boring-ui session cookie.

        The frontend calls this after a successful sign-in/sign-up with the
        Neon Auth API.  The backend validates the token by calling the Neon
        Auth ``/get-session`` endpoint, then issues a boring-ui session cookie.
        """
        if not config.neon_auth_base_url:
            return _error(
                request,
                status_code=500,
                error="server_error",
                code="NEON_AUTH_NOT_CONFIGURED",
                message="NEON_AUTH_BASE_URL is not configured",
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

        # Accept both "access_token" (matches the frontend login flow) and
        # "session_token" for backward compatibility.
        access_token = body.get("access_token") or body.get("session_token")
        if not isinstance(access_token, str) or not access_token.strip():
            return _error(
                request,
                status_code=400,
                error="bad_request",
                code="MISSING_ACCESS_TOKEN",
                message="access_token is required",
            )

        redirect_uri = _safe_redirect_path(body.get("redirect_uri"))
        response = _issue_session_response(
            request,
            config=config,
            access_token=access_token,
            redirect_uri=redirect_uri,
        )

        # Eager workspace provisioning: create a default workspace for new
        # users so the Fly Machine is already being provisioned by the time
        # they land on the dashboard.
        _logger.info("token-exchange: status=%s, starting eager provision check", response.status_code)
        eager_workspace_id = None
        if response.status_code == 200:
            verified = _validate_neon_jwt(access_token, config=config)
            if verified:
                user_id = str(verified.get("user_id", "")).strip()
                if user_id:
                    eager_workspace_id = await _eager_workspace_provision(
                        request, config=config, user_id=user_id,
                    )

        # Enrich the response payload with the workspace id so the frontend
        # can navigate directly to /w/{id}/setup instead of bouncing via /.
        if eager_workspace_id and response.status_code == 200:
            import json
            body = json.loads(response.body.decode("utf-8"))
            body["workspace_id"] = eager_workspace_id
            response.body = json.dumps(body).encode("utf-8")
            # Update Content-Length after body mutation
            response.headers["content-length"] = str(len(response.body))

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
