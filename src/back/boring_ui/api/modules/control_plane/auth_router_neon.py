"""Neon Auth (Better Auth) backed auth/session routes for boring-ui control-plane.

This module mirrors the Supabase auth router but uses Neon Auth endpoints
(email/password only, no magic-link/PKCE).  The flow is:

1. Frontend renders a login/signup form.
2. On submit the form POSTs to the Neon Auth ``/sign-up/email`` or
   ``/sign-in/email`` endpoint directly via ``fetch()``.
3. On success the frontend calls ``/auth/token-exchange`` with the session token.
4. The backend validates the token via ``GET {neon_auth_base}/get-session`` and
   issues a boring-ui session cookie.
"""

from __future__ import annotations

import json
import logging
from urllib.parse import unquote, urlparse
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from ...config import APIConfig
from .auth_session import create_session_cookie, parse_session_cookie, SessionExpired, SessionInvalid

_logger = logging.getLogger(__name__)


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


def _public_origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


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
          var signupBody = { email: email, password: password, name: (nameEl.value || "").trim() || email.split("@")[0] };
          var signupResp = await fetch(AUTH.neonAuthUrl + "/sign-up/email", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Origin": window.location.origin },
            body: JSON.stringify(signupBody),
            credentials: "include",
          });
          if (!signupResp.ok) {
            var signupErr = {};
            try { signupErr = await signupResp.json(); } catch(_) {}
            setStatus(signupErr.message || signupErr.error || "Unable to create account.", true);
            return;
          }
          var signupData = await signupResp.json();
          // Fetch JWT using the session cookie set by sign-up
          var jwtResp = await fetch(AUTH.neonAuthUrl + "/token", { credentials: "include" });
          var jwtData = {};
          try { jwtData = await jwtResp.json(); } catch(_) {}
          var signupToken = jwtData.token || signupData.token;
          if (!signupToken) {
            setStatus("Account created but no session token returned. Please sign in.", false);
            setMode("sign_in");
            return;
          }
          // Exchange JWT for boring-ui session
          setStatus("Setting up session...");
          var exchResp = await fetch("/auth/token-exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: signupToken, redirect_uri: AUTH.redirectUri || "/" }),
          });
          var exchData = {};
          try { exchData = await exchResp.json(); } catch(_) {}
          if (!exchResp.ok) {
            setStatus(exchData.message || "Unable to complete session setup.", true);
            return;
          }
          window.location.assign(exchData.redirect_uri || "/");
          return;
        }

        // sign_in mode
        setStatus("Signing in...");
        var signinResp = await fetch(AUTH.neonAuthUrl + "/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Origin": window.location.origin },
          body: JSON.stringify({ email: email, password: password }),
          credentials: "include",
        });
        if (!signinResp.ok) {
          var signinErr = {};
          try { signinErr = await signinResp.json(); } catch(_) {}
          setStatus(signinErr.message || signinErr.error || "Unable to sign in.", true);
          return;
        }
        var signinData = await signinResp.json();
        // Fetch JWT using the session cookie set by sign-in
        var jwtResp2 = await fetch(AUTH.neonAuthUrl + "/token", { credentials: "include" });
        var jwtData2 = {};
        try { jwtData2 = await jwtResp2.json(); } catch(_) {}
        var sessionToken = jwtData2.token || signinData.token;
        if (!sessionToken) {
          setStatus("No session token returned.", true);
          return;
        }

        setStatus("Setting up session...");
        var exchange = await fetch("/auth/token-exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: sessionToken, redirect_uri: AUTH.redirectUri || "/" }),
        });
        var payload = {};
        try { payload = await exchange.json(); } catch(_) {}
        if (!exchange.ok) {
          setStatus(payload.message || "Unable to complete session setup.", true);
          return;
        }
        window.location.assign(payload.redirect_uri || "/");
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

    @router.get("/callback")
    async def auth_callback(request: Request):
        """Neon Auth callback handler.

        For Neon Auth the primary flow goes through ``/auth/token-exchange``,
        so this endpoint mostly exists for dev-login compatibility and as a
        no-op landing that redirects to login.
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

        # For browser requests without callback parameters, redirect to login.
        return RedirectResponse(url="/auth/login", status_code=302)

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

        # Validate the JWT via JWKS
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

        redirect_uri = _safe_redirect_path(body.get("redirect_uri"))
        response = JSONResponse(
            status_code=200,
            content={"ok": True, "redirect_uri": redirect_uri},
        )
        _set_session_cookie(response, session_value, config)
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
