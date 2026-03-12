"""Neon Auth (Better Auth) backed auth/session routes for boring-ui control-plane.

This module mirrors the Supabase auth router but uses Neon Auth endpoints
(email/password only, no magic-link/PKCE). The main flows are:

1. Sign in: browser POSTs to boring-ui, backend authenticates against Neon,
   fetches the JWT from ``/token``, and issues ``boring_session``.
2. Sign up: browser POSTs to boring-ui, backend creates the Neon account and
   returns a "check your email" response instead of auto-signing the user in.
3. Email verification: Neon redirects back to ``/auth/callback`` and the
   callback page exchanges the Neon session for a boring-ui session cookie.
"""

from __future__ import annotations

import json
import logging
import base64
import hashlib
from urllib.parse import unquote, urlparse
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
# Shared helpers (mirrors auth_router_supabase private helpers)
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
    origin = str(request.headers.get("origin", "")).strip()
    normalized_origin = _normalize_origin(origin)
    request_origin = _normalize_origin(str(request.base_url).rstrip("/"))
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


def _build_callback_url(request: Request, *, config: APIConfig, redirect_uri: str) -> str:
    base = _public_origin(request, config=config)
    return f"{base}/auth/callback?redirect_uri={redirect_uri}"


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


async def _neon_password_auth(
    request: Request,
    *,
    config: APIConfig,
    endpoint_path: str,
    payload: dict[str, str],
    upstream_error_message: str,
    missing_token_message: str,
    complete_session: bool = True,
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
    origin = _public_origin(request, config=config)
    upstream_payload = dict(payload)
    callback_url = _build_callback_url(request, config=config, redirect_uri=redirect_uri)
    if not complete_session:
        email = str(upstream_payload.get("email", "")).strip().lower()
        password = str(upstream_payload.get("password", "")).strip()
        if email and password:
            pending_login = _encode_pending_login(config=config, email=email, password=password)
            separator = "&" if "?" in callback_url else "?"
            callback_url = f"{callback_url}{separator}pending_login={pending_login}"
    upstream_payload["callbackURL"] = callback_url

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            auth_response = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                },
                json=upstream_payload,
            )
            auth_body = auth_response.json() if auth_response.content else {}
            if auth_response.status_code not in {200, 201}:
                message = _parse_neon_error_message(auth_body, upstream_error_message)
                status_code = auth_response.status_code if 400 <= auth_response.status_code < 500 else 502
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
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "requires_email_verification": True,
                "message": "Check your email to verify your account.",
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
    origin = _public_origin(request, config=config)

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
    .name-field { display: none; }
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
    .error { color: var(--color-error); }
    button:disabled, input:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
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
          <div id="name-group" class="name-field">
            <label for="name">Name</label>
            <input id="name" type="text" autocomplete="name" placeholder="Your name">
          </div>
          <label for="email">Work email</label>
          <input id="email" type="email" autocomplete="email" placeholder="you@company.com" required>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" placeholder="Enter your password" required>
          <button id="submit" class="submit" type="submit">Continue</button>
        </form>
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
    var nameEl = document.getElementById("name");
    var emailEl = document.getElementById("email");
    var passwordEl = document.getElementById("password");
    var submitEl = document.getElementById("submit");
    var tabSignInEl = document.getElementById("tab-signin");
    var tabSignUpEl = document.getElementById("tab-signup");

    var mode = AUTH.initialMode === "sign_up" ? "sign_up" : "sign_in";
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
      submitEl.disabled = busy;
      tabSignInEl.disabled = busy;
      tabSignUpEl.disabled = busy;
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
      mode = nextMode === "sign_up" ? "sign_up" : "sign_in";
      var signUp = mode === "sign_up";
      setTabState(signUp);
      titleEl.textContent = signUp ? "Create your account" : "Welcome back";
      subtitleEl.textContent = signUp
        ? "Get started in minutes."
        : "Use your email and password to continue.";
      submitEl.textContent = signUp ? "Create account" : "Continue";
      passwordEl.autocomplete = signUp ? "new-password" : "current-password";
      passwordEl.placeholder = signUp ? "Create a password (8+ characters)" : "Enter your password";
      nameGroupEl.style.display = signUp ? "block" : "none";
      setStatus("");
    }

    tabSignInEl.addEventListener("click", function() { setMode("sign_in"); });
    tabSignUpEl.addEventListener("click", function() { setMode("sign_up"); });

    form.addEventListener("submit", async function(event) {
      event.preventDefault();
      if (busy) return;
      var email = (emailEl.value || "").trim();
      var password = passwordEl.value || "";
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

    applyBranding();
    setMode(mode);
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
        "initialMode": "sign_up" if initial_mode == "sign_up" else "sign_in",
        "appName": config.auth_app_name,
        "appDescription": config.auth_app_description,
        "railCode": config.auth_rail_code,
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
    from .supabase.token_verify import verify_token, TokenError

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
            supabase_url=neon_base or "",
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

        return await _neon_password_auth(
            request,
            config=config,
            endpoint_path="/sign-up/email",
            payload={
                "email": email,
                "password": password,
                "name": name,
                "redirect_uri": body.get("redirect_uri", "/"),
            },
            upstream_error_message="Unable to create account.",
            missing_token_message="Account created but Neon Auth did not return a session token.",
            complete_session=False,
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

        # Accept both "access_token" (matches frontend & Supabase router) and
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
        return _issue_session_response(
            request,
            config=config,
            access_token=access_token,
            redirect_uri=redirect_uri,
        )

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
