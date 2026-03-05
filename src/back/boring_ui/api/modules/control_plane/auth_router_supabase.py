"""Supabase-backed auth/session routes owned by boring-ui control-plane."""

from __future__ import annotations

import json
import os
from urllib.parse import unquote, urlparse
from uuid import uuid4

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

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


_LOGIN_HTML_TEMPLATE: str = """\
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { width: min(440px, 100%); background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; }
    h1 { margin: 0 0 6px; font-size: 1.25rem; }
    p { margin: 0 0 16px; color: #93a3b8; }
    label { display: block; margin: 12px 0 6px; font-size: 0.9rem; color: #cbd5e1; }
    input { width: 100%; box-sizing: border-box; background: #0b1220; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; }
    .row { display: flex; gap: 8px; margin-top: 14px; }
    button { border: 1px solid #334155; background: #1d4ed8; color: #eff6ff; border-radius: 8px; padding: 10px 12px; font-weight: 600; cursor: pointer; }
    button.secondary { background: #0b1220; color: #dbeafe; }
    .status { min-height: 22px; margin-top: 12px; color: #93c5fd; font-size: 0.9rem; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <div class="wrap">
    <main class="card">
      <h1 id="title">Sign in</h1>
      <p id="subtitle">Use email/password or a magic link.</p>
      <form id="auth-form" autocomplete="on">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required>
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" required>
        <div class="row">
          <button id="submit" type="submit">Sign in</button>
          <button id="toggle" class="secondary" type="button">Switch to sign up</button>
          <button id="magic" class="secondary" type="button">Send magic link</button>
        </div>
      </form>
      <div id="status" class="status" aria-live="polite"></div>
    </main>
  </div>
  <script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script defer>
    document.addEventListener("DOMContentLoaded", function() {
    const AUTH = /*AUTH_CONFIG_JSON*/;
    const statusEl = document.getElementById("status");
    const titleEl = document.getElementById("title");
    const subtitleEl = document.getElementById("subtitle");
    const form = document.getElementById("auth-form");
    const emailEl = document.getElementById("email");
    const passwordEl = document.getElementById("password");
    const submitEl = document.getElementById("submit");
    const toggleEl = document.getElementById("toggle");
    const magicEl = document.getElementById("magic");
    const supabaseLib = window.supabase;
    const client = (supabaseLib && typeof supabaseLib.createClient === "function")
      ? supabaseLib.createClient(AUTH.supabaseUrl, AUTH.supabaseAnonKey)
      : null;

    let mode = AUTH.initialMode === "sign_up" ? "sign_up" : "sign_in";

    function setStatus(message, isError) {
      statusEl.textContent = message || "";
      statusEl.classList.toggle("error", !!isError);
    }

    function isEmailRateLimited(error) {
      if (!error) return false;
      if (Number(error.status || 0) === 429) return true;
      var raw = [
        error.code || "",
        error.error_code || "",
        error.message || "",
      ].join(" ").toLowerCase();
      return raw.includes("over_email_send_rate_limit")
        || raw.includes("email rate limit")
        || raw.includes("too many requests");
    }

    function rateLimitMessage() {
      return "Too many email attempts right now. Please wait about 60 seconds, then try again.";
    }

    function callbackUrl() {
      var url = new URL(AUTH.callbackUrl, window.location.origin);
      url.searchParams.set("redirect_uri", AUTH.redirectUri || "/");
      return url.toString();
    }

    function setMode(nextMode) {
      mode = nextMode === "sign_up" ? "sign_up" : "sign_in";
      titleEl.textContent = mode === "sign_up" ? "Create account" : "Sign in";
      subtitleEl.textContent = mode === "sign_up"
        ? "Create your account, then confirm by email if prompted."
        : "Use email/password or a magic link.";
      submitEl.textContent = mode === "sign_up" ? "Create account" : "Sign in";
      toggleEl.textContent = mode === "sign_up" ? "Switch to sign in" : "Switch to sign up";
      passwordEl.autocomplete = mode === "sign_up" ? "new-password" : "current-password";
      setStatus("");
    }

    toggleEl.addEventListener("click", function() {
      setMode(mode === "sign_in" ? "sign_up" : "sign_in");
    });

    magicEl.addEventListener("click", async function() {
      if (!client) {
        setStatus("Auth library failed to load.", true);
        return;
      }
      var email = (emailEl.value || "").trim();
      if (!email) {
        setStatus("Enter your email.", true);
        return;
      }
      setStatus("Sending magic link...");
      var result = await client.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (result.error) {
        if (isEmailRateLimited(result.error)) {
          setStatus(rateLimitMessage(), true);
          return;
        }
        setStatus(result.error.message || "Unable to send magic link.", true);
        return;
      }
      setStatus("Check your email for the confirmation link.");
    });

    form.addEventListener("submit", async function(event) {
      event.preventDefault();
      if (!client) {
        setStatus("Auth library failed to load.", true);
        return;
      }
      var email = (emailEl.value || "").trim();
      var password = passwordEl.value || "";
      if (!email || !password) {
        setStatus("Enter email and password.", true);
        return;
      }

      if (mode === "sign_up") {
        setStatus("Creating account...");
        var result = await client.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: callbackUrl() },
        });
        if (result.error) {
          if (isEmailRateLimited(result.error)) {
            setStatus(rateLimitMessage(), true);
            return;
          }
          setStatus(result.error.message || "Unable to create account.", true);
          return;
        }
        setStatus("Account created. Confirm from your email, then sign in.");
        return;
      }

      setStatus("Signing in...");
      var signIn = await client.auth.signInWithPassword({
        email: email,
        password: password,
      });
      if (signIn.error) {
        setStatus(signIn.error.message || "Unable to sign in.", true);
        return;
      }
      var accessToken = signIn.data && signIn.data.session && signIn.data.session.access_token;
      if (!accessToken) {
        setStatus("No access token returned.", true);
        return;
      }
      var exchange = await fetch("/auth/token-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          redirect_uri: AUTH.redirectUri || "/",
        }),
      });
      var payload = {};
      try {
        payload = await exchange.json();
      } catch (_) {
        payload = {};
      }
      if (!exchange.ok) {
        setStatus(payload.message || "Unable to complete session setup.", true);
        return;
      }
      window.location.assign(payload.redirect_uri || "/");
    });

    setMode(mode);
    });
  </script>
</body>
</html>"""

_AUTH_CONFIG_PLACEHOLDER = "/*AUTH_CONFIG_JSON*/"


def _render_supabase_login_html(
    *,
    request: Request,
    config: APIConfig,
    initial_mode: str,
) -> HTMLResponse:
    if not config.supabase_url or not config.supabase_anon_key:
        return HTMLResponse(
            status_code=500,
            content=(
                "<!doctype html><html><body>"
                "<h1>Auth not configured</h1>"
                "<p>SUPABASE_URL and SUPABASE_ANON_KEY are required.</p>"
                "</body></html>"
            ),
        )

    callback = f"{_public_origin(request).rstrip('/')}/auth/callback"
    redirect_after = _safe_redirect_path(request.query_params.get("redirect_uri"))
    cfg = {
        "supabaseUrl": config.supabase_url.rstrip("/"),
        "supabaseAnonKey": config.supabase_anon_key,
        "callbackUrl": callback,
        "redirectUri": redirect_after,
        "initialMode": "sign_up" if initial_mode == "sign_up" else "sign_in",
    }
    cfg_json = json.dumps(cfg, separators=(",", ":"))
    html = _LOGIN_HTML_TEMPLATE.replace(_AUTH_CONFIG_PLACEHOLDER, cfg_json, 1)

    response = HTMLResponse(content=html, status_code=200)
    response.headers["Cache-Control"] = "no-store"
    return response


_CALLBACK_BRIDGE_HTML_TEMPLATE: str = """\
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Completing sign-in...</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { width: min(480px, 100%); background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; }
    h1 { margin: 0 0 8px; font-size: 1.1rem; }
    p { margin: 0; color: #93a3b8; }
    .status { margin-top: 10px; color: #93c5fd; }
    .error { color: #fca5a5; }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <div class="wrap">
    <main class="card">
      <h1>Completing sign-in...</h1>
      <p id="message">Processing authentication response.</p>
      <p id="status" class="status" aria-live="polite"></p>
    </main>
  </div>
  <script defer>
    document.addEventListener("DOMContentLoaded", function() {
    var fallbackRedirect = /*REDIRECT_JSON*/;
    var statusEl = document.getElementById("status");
    var messageEl = document.getElementById("message");

    function setStatus(text, isError) {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("error", !!isError);
    }

    async function run() {
      var query = new URLSearchParams(window.location.search);
      var hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      var redirectUri = query.get("redirect_uri") || fallbackRedirect || "/";

      // If callback params are already present in query, let backend handle them.
      if (query.get("code") || ((query.get("token_hash") || query.get("token")) && query.get("type"))) {
        var url = new URL(window.location.href);
        url.hash = "";
        window.location.replace(url.toString());
        return;
      }

      var accessToken = hash.get("access_token");
      if (!accessToken) {
        var err = hash.get("error_description") || query.get("error_description") || "Missing callback token.";
        messageEl.textContent = "Authentication callback is incomplete.";
        setStatus(err, true);
        var loginUrl = new URL("/auth/login", window.location.origin);
        loginUrl.searchParams.set("redirect_uri", redirectUri);
        statusEl.insertAdjacentHTML("beforeend", ' <a href="' + loginUrl.toString() + '">Go to login</a>');
        return;
      }

      setStatus("Exchanging session token...");
      var resp = await fetch("/auth/token-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          redirect_uri: redirectUri,
        }),
      });
      var payload = {};
      try {
        payload = await resp.json();
      } catch (_) {
        payload = {};
      }
      if (!resp.ok) {
        messageEl.textContent = "Sign-in could not be completed.";
        setStatus(payload.message || "Token exchange failed.", true);
        return;
      }
      window.location.replace(payload.redirect_uri || redirectUri || "/");
    }

    run().catch(function(err) {
      messageEl.textContent = "Sign-in could not be completed.";
      setStatus(err && err.message ? err.message : "Unexpected callback error.", true);
    });
    });
  </script>
</body>
</html>"""

_REDIRECT_JSON_PLACEHOLDER = "/*REDIRECT_JSON*/"


def _render_auth_callback_bridge_html(request: Request) -> HTMLResponse:
    """Render a client-side bridge page that extracts the access token from the
    URL hash fragment (invisible to the server) and exchanges it via the
    ``/auth/token-exchange`` endpoint.  This handles Supabase implicit-grant and
    magic-link flows where the token arrives in the hash."""
    redirect_after = _safe_redirect_path(request.query_params.get("redirect_uri"))
    redirect_json = json.dumps(redirect_after, separators=(",", ":"))
    html = _CALLBACK_BRIDGE_HTML_TEMPLATE.replace(_REDIRECT_JSON_PLACEHOLDER, redirect_json, 1)
    response = HTMLResponse(content=html, status_code=200)
    response.headers["Cache-Control"] = "no-store"
    return response


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

        return _render_supabase_login_html(
            request=request,
            config=config,
            initial_mode="sign_in",
        )

    @router.get("/signup")
    async def auth_signup(request: Request):
        return _render_supabase_login_html(
            request=request,
            config=config,
            initial_mode="sign_up",
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
        token = request.query_params.get("token")
        verify_type = request.query_params.get("type")

        if not code and not ((token_hash or token) and verify_type):
            # Supabase implicit-grant / magic-link flows deliver the token in the
            # URL hash fragment which the server never sees.  Serve a small bridge
            # page that extracts it client-side and posts to /auth/token-exchange.
            accept = (request.headers.get("accept") or "").lower()
            if "text/html" in accept or "*/*" in accept:
                return _render_auth_callback_bridge_html(request)
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
                    verify_payload: dict[str, str] = {"type": str(verify_type)}
                    if token_hash:
                        verify_payload["token_hash"] = str(token_hash)
                    elif token:
                        # Supabase email links currently expose `token=<hash>` in the
                        # URL. The verify endpoint still expects the value under
                        # `token_hash`.
                        verify_payload["token_hash"] = str(token)
                    resp = await client.post(
                        verify_url,
                        json=verify_payload,
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
