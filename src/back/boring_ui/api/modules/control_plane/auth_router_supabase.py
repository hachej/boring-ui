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
      /* Slightly darker than accent token for AA text contrast on white. */
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
        --color-text-secondary: #a8a8a8;
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
    .submit:focus-visible,
    .link-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 4px var(--focus);
      border-radius: 8px;
    }
    .alt-actions {
      margin-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .muted {
      margin: 0;
      color: var(--color-text-secondary);
      font-size: 0.87rem;
    }
    .link-btn {
      border: 0;
      background: transparent;
      color: var(--color-link);
      font-weight: 700;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
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
          <label for="email">Work email</label>
          <input id="email" type="email" autocomplete="email" placeholder="you@company.com" required>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" placeholder="Enter your password" required>
          <button id="submit" class="submit" type="submit">Continue</button>
        </form>
        <div class="alt-actions">
          <p class="muted">Prefer a one-time link?</p>
          <button id="magic" class="link-btn" type="button">Use magic link instead</button>
        </div>
        <div id="status" class="status" aria-live="polite"></div>
        </div>
      </main>
    </div>
  </div>
  <script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js" integrity="sha384-z2hqtpr/vSDZ8zSjLOiNgnR/mpU799AD93s6rvkNJLI6Hl0YlKXEhDtREzNT749S" crossorigin="anonymous"></script>
  <script defer>
    document.addEventListener("DOMContentLoaded", function() {
    const AUTH = /*AUTH_CONFIG_JSON*/;
    const statusEl = document.getElementById("status");
    const appNameEl = document.getElementById("app-name");
    const appDescriptionEl = document.getElementById("app-description");
    const panelEl = document.getElementById("auth-panel");
    const titleEl = document.getElementById("title");
    const subtitleEl = document.getElementById("subtitle");
    const form = document.getElementById("auth-form");
    const emailEl = document.getElementById("email");
    const passwordEl = document.getElementById("password");
    const submitEl = document.getElementById("submit");
    const magicEl = document.getElementById("magic");
    const tabSignInEl = document.getElementById("tab-signin");
    const tabSignUpEl = document.getElementById("tab-signup");
    const supabaseLib = window.supabase;
    const client = (supabaseLib && typeof supabaseLib.createClient === "function")
      ? supabaseLib.createClient(AUTH.supabaseUrl, AUTH.supabaseAnonKey)
      : null;

    let mode = AUTH.initialMode === "sign_up" ? "sign_up" : "sign_in";
    let busy = false;

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
    }

    function setBusy(isBusy) {
      busy = !!isBusy;
      form.setAttribute("aria-busy", busy ? "true" : "false");
      emailEl.disabled = busy;
      passwordEl.disabled = busy;
      submitEl.disabled = busy;
      magicEl.disabled = busy;
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
      if (busy) return;
      mode = nextMode === "sign_up" ? "sign_up" : "sign_in";
      var signUp = mode === "sign_up";
      setTabState(signUp);
      titleEl.textContent = signUp ? "Create your account" : "Welcome back";
      subtitleEl.textContent = mode === "sign_up"
        ? "Get started in minutes. You may be asked to confirm from your email."
        : "Use your email and password to continue.";
      submitEl.textContent = signUp ? "Create account" : "Continue";
      magicEl.textContent = signUp ? "Email me a signup link" : "Use magic link instead";
      passwordEl.autocomplete = signUp ? "new-password" : "current-password";
      passwordEl.placeholder = signUp ? "Create a password (8+ characters)" : "Enter your password";
      setStatus("");
    }

    tabSignInEl.addEventListener("click", function() { setMode("sign_in"); });
    tabSignUpEl.addEventListener("click", function() { setMode("sign_up"); });

    magicEl.addEventListener("click", async function() {
      if (busy) return;
      if (!client) {
        setStatus("Auth library failed to load.", true);
        return;
      }
      var email = (emailEl.value || "").trim();
      if (!email) {
        setStatus("Enter your email.", true);
        return;
      }
      setBusy(true);
      setStatus("Sending magic link...");
      try {
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
        setStatus(mode === "sign_up"
          ? "Check your email to confirm your account."
          : "Check your email for the sign-in link.");
      } finally {
        setBusy(false);
      }
    });

    form.addEventListener("submit", async function(event) {
      event.preventDefault();
      if (busy) return;
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

      setBusy(true);
      if (mode === "sign_up") {
        try {
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
          passwordEl.value = "";
          setMode("sign_in");
          setStatus("Account created. Confirm from your email, then sign in.");
        } finally {
          setBusy(false);
        }
        return;
      }

      try {
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
        "appName": config.auth_app_name,
        "appDescription": config.auth_app_description,
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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&family=Fira+Code:wght@500;600&display=swap');
    :root {
      --color-bg-primary: #ffffff;
      --color-bg-secondary: #f8f8f8;
      --color-text-primary: #1a1a1a;
      --color-text-secondary: #6b6b6b;
      --color-border: #e0e0e0;
      --color-accent: #007aff;
      --color-accent-light: rgba(0, 122, 255, 0.1);
      /* Slightly darker than accent token for AA text contrast on white. */
      --color-link: #005bcc;
      --focus: rgba(0, 91, 204, 0.18);
      --color-error: #dc3545;
      --color-info: #17a2b8;
      --font-mono: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
      --shadow-auth: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-bg-primary: #1f1f1f;
        --color-bg-secondary: #242424;
        --color-text-primary: #e0e0e0;
        --color-text-secondary: #a8a8a8;
        --color-border: #404040;
        --color-accent: #61dafb;
        --color-accent-light: rgba(97, 218, 251, 0.15);
        --color-link: #61dafb;
        --focus: rgba(97, 218, 251, 0.22);
        --color-error: #e74c3c;
        --color-info: #3498db;
        --shadow-auth: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 20px -10px rgb(0 0 0 / 0.58), 0 2px 8px -4px rgb(0 0 0 / 0.42);
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
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card {
      width: min(480px, 100%);
      background: var(--color-bg-primary);
      border: 1px solid var(--color-border);
      border-radius: 18px;
      padding: 28px;
      box-shadow: var(--shadow-auth);
      text-align: center;
      animation: enter 260ms ease-out both;
    }
    .spinner {
      display: inline-block;
      width: 32px;
      height: 32px;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      font-family: var(--font-mono);
    }
    p { margin: 0; color: var(--color-text-secondary); line-height: 1.5; }
    .status { margin-top: 14px; font-size: 0.9rem; color: var(--color-info); line-height: 1.4; }
    .error { color: var(--color-error); }
    a { color: var(--color-link); font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
    a:focus-visible {
      outline: none;
      box-shadow: 0 0 0 4px var(--focus);
      border-radius: 8px;
    }
    @keyframes enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <main class="card">
      <div id="spinner" class="spinner" aria-hidden="true"></div>
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
    var spinnerEl = document.getElementById("spinner");

    function setStatus(text, isError) {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("error", !!isError);
      if (isError && spinnerEl) spinnerEl.style.display = "none";
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
        app_id=config.control_plane_app_id,
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
        app_id=config.control_plane_app_id,
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
