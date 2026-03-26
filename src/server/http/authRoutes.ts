/**
 * Auth routes — local dev auth plus hosted Neon Auth flows.
 */
import { createHash } from 'node:crypto'
import * as jose from 'jose'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  SessionExpiredError,
  appCookieName,
  createSessionCookie,
  parseSessionCookie,
} from '../auth/session.js'
import {
  neonOriginFromBaseUrl,
  requestPasswordResetEmail,
  resetPassword,
  sendVerificationEmail,
  signInWithPassword,
  signUpWithPassword,
  verifyNeonAccessToken,
} from '../auth/neonClient.js'
import type { ServerConfig } from '../config.js'
import { validateRedirectUrl } from '../auth/validation.js'

const PENDING_LOGIN_TTL_SECONDS = 30 * 60
const AUTH_CONFIG_PLACEHOLDER = '/*AUTH_CONFIG_JSON*/'
const INVALID_REDIRECT_CHARS_RE = /[\0\r\n<>"'`]/

type JsonRecord = Record<string, unknown>

const HOSTED_AUTH_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0e1412;
      --panel: #161f1a;
      --panel-alt: #111814;
      --text: #f4f6f5;
      --muted: #b7c1bc;
      --accent: #79e0a4;
      --accent-ink: #0b1a11;
      --border: rgba(255,255,255,0.08);
      --danger: #ff8d8d;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #eff4f1;
        --panel: #ffffff;
        --panel-alt: #f4f8f6;
        --text: #112018;
        --muted: #5d6b63;
        --accent: #0c8f50;
        --accent-ink: #ffffff;
        --border: rgba(17,32,24,0.12);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      background:
        radial-gradient(circle at top, rgba(121,224,164,0.18), transparent 35%),
        var(--bg);
      color: var(--text);
    }
    .shell {
      width: min(100%, 900px);
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(320px, 420px);
      gap: 20px;
      align-items: stretch;
    }
    .rail, .card {
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--panel);
      box-shadow: 0 24px 60px rgba(0,0,0,0.18);
    }
    .rail {
      padding: 28px;
      display: grid;
      align-content: end;
      gap: 12px;
      background:
        linear-gradient(135deg, rgba(121,224,164,0.12), transparent 48%),
        var(--panel-alt);
    }
    .rail h1 { margin: 0; font-size: clamp(1.8rem, 3vw, 2.5rem); line-height: 1.08; }
    .rail p { margin: 0; color: var(--muted); line-height: 1.6; max-width: 36ch; }
    .card { padding: 24px; }
    .tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 6px;
      border-radius: 14px;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .tab, .submit, .link-btn {
      font: inherit;
    }
    .tab {
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--muted);
      padding: 10px 12px;
      cursor: pointer;
      font-weight: 700;
    }
    .tab.active {
      background: var(--panel);
      color: var(--text);
    }
    h2 { margin: 0; font-size: 1.5rem; }
    .subtitle { margin: 8px 0 0; color: var(--muted); line-height: 1.55; }
    form { margin-top: 18px; }
    label {
      display: block;
      margin: 14px 0 6px;
      font-size: 0.92rem;
      font-weight: 700;
    }
    input {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 13px;
      background: var(--panel-alt);
      color: var(--text);
    }
    input:focus-visible, button:focus-visible {
      outline: 2px solid rgba(121,224,164,0.4);
      outline-offset: 2px;
    }
    .hidden { display: none; }
    .submit {
      width: 100%;
      margin-top: 18px;
      border: 0;
      border-radius: 12px;
      padding: 12px 14px;
      background: var(--accent);
      color: var(--accent-ink);
      cursor: pointer;
      font-weight: 800;
    }
    .submit:disabled, .tab:disabled, .link-btn:disabled, input:disabled { opacity: 0.7; cursor: not-allowed; }
    .status { min-height: 24px; margin-top: 14px; color: var(--muted); line-height: 1.45; }
    .status.error { color: var(--danger); }
    .actions {
      margin-top: 14px;
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .actions p { margin: 0; color: var(--muted); font-size: 0.92rem; }
    .link-btn {
      border: 0;
      background: transparent;
      color: var(--accent);
      cursor: pointer;
      padding: 0;
      font-weight: 700;
      text-decoration: underline;
    }
    @media (max-width: 860px) {
      .shell { grid-template-columns: 1fr; }
      .rail { min-height: 180px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="rail">
      <p>Hosted authentication</p>
      <h1 id="app-name">Boring UI</h1>
      <p>Sign in, create an account, or recover access without leaving the app origin.</p>
    </aside>
    <main class="card">
      <div id="tabs" class="tabs" role="tablist" aria-label="Authentication mode">
        <button id="tab-signin" class="tab" type="button">Sign in</button>
        <button id="tab-signup" class="tab" type="button">Create account</button>
      </div>
      <h2 id="title">Welcome back</h2>
      <p id="subtitle" class="subtitle">Use your email and password to continue.</p>

      <form id="auth-form" novalidate>
        <div id="email-group">
          <label for="email">Email</label>
          <input id="email" type="email" autocomplete="email" placeholder="you@company.com" required />
        </div>

        <div id="password-group">
          <label id="password-label" for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" placeholder="Enter your password" required />
        </div>

        <div id="confirm-group" class="hidden">
          <label for="confirm-password">Confirm password</label>
          <input id="confirm-password" type="password" autocomplete="new-password" placeholder="Repeat your password" />
        </div>

        <button id="submit" class="submit" type="submit">Continue</button>
      </form>

      <div id="actions" class="actions">
        <p id="actions-copy">Lost access to your password?</p>
        <button id="alt-action" class="link-btn" type="button">Forgot password?</button>
      </div>

      <div id="status" class="status" aria-live="polite"></div>
    </main>
  </div>

  <script>
    (function() {
      var AUTH = /*AUTH_CONFIG_JSON*/;
      var mode = AUTH.initialMode === 'sign_up'
        ? 'sign_up'
        : AUTH.initialMode === 'reset_password'
          ? 'reset_password'
          : 'sign_in';
      var busy = false;

      var appNameEl = document.getElementById('app-name');
      var tabSignInEl = document.getElementById('tab-signin');
      var tabSignUpEl = document.getElementById('tab-signup');
      var tabsEl = document.getElementById('tabs');
      var titleEl = document.getElementById('title');
      var subtitleEl = document.getElementById('subtitle');
      var formEl = document.getElementById('auth-form');
      var emailGroupEl = document.getElementById('email-group');
      var passwordLabelEl = document.getElementById('password-label');
      var emailEl = document.getElementById('email');
      var passwordEl = document.getElementById('password');
      var confirmGroupEl = document.getElementById('confirm-group');
      var confirmPasswordEl = document.getElementById('confirm-password');
      var submitEl = document.getElementById('submit');
      var actionsEl = document.getElementById('actions');
      var actionsCopyEl = document.getElementById('actions-copy');
      var altActionEl = document.getElementById('alt-action');
      var statusEl = document.getElementById('status');

      appNameEl.textContent = AUTH.appName || 'Boring UI';

      function setStatus(message, isError) {
        statusEl.textContent = message || '';
        statusEl.classList.toggle('error', !!isError);
      }

      function setBusy(nextBusy) {
        busy = !!nextBusy;
        emailEl.disabled = busy;
        passwordEl.disabled = busy;
        confirmPasswordEl.disabled = busy;
        submitEl.disabled = busy;
        tabSignInEl.disabled = busy;
        tabSignUpEl.disabled = busy;
        altActionEl.disabled = busy;
      }

      function setMode(nextMode) {
        mode = nextMode;
        var isSignUp = mode === 'sign_up';
        var isReset = mode === 'reset_password';

        tabSignInEl.classList.toggle('active', !isSignUp);
        tabSignUpEl.classList.toggle('active', isSignUp);
        tabsEl.classList.toggle('hidden', isReset);
        emailGroupEl.classList.toggle('hidden', isReset);
        confirmGroupEl.classList.toggle('hidden', !isReset);
        actionsEl.classList.toggle('hidden', false);

        titleEl.textContent = isReset ? 'Set a new password' : isSignUp ? 'Create your account' : 'Welcome back';
        subtitleEl.textContent = isReset
          ? 'Choose a new password for your account.'
          : isSignUp
            ? 'Create your account and verify your email.'
            : 'Use your email and password to continue.';
        passwordLabelEl.textContent = isReset ? 'New password' : 'Password';
        passwordEl.autocomplete = isSignUp || isReset ? 'new-password' : 'current-password';
        passwordEl.placeholder = isReset || isSignUp ? 'Create a password (8+ characters)' : 'Enter your password';
        submitEl.textContent = isReset ? 'Update password' : isSignUp ? 'Create account' : 'Continue';
        actionsCopyEl.textContent = isReset ? 'Need another account?' : 'Lost access to your password?';
        altActionEl.textContent = isReset ? 'Back to sign in' : 'Forgot password?';
        setStatus('');

        if (isReset) {
          if (!AUTH.resetToken) {
            setStatus('Password reset link is missing or invalid. Request a new one.', true);
          } else if (AUTH.resetError) {
            var resetError = String(AUTH.resetError || '').toLowerCase();
            setStatus(
              resetError.indexOf('invalid') >= 0 || resetError.indexOf('expired') >= 0
                ? 'This password reset link is invalid or has expired. Request a new one.'
                : 'Unable to use this reset link: ' + AUTH.resetError,
              true
            );
          }
        }
      }

      async function postJson(path, payload) {
        var response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = {};
        try { data = await response.json(); } catch (_) {}
        return { response: response, data: data };
      }

      tabSignInEl.addEventListener('click', function() { if (!busy) setMode('sign_in'); });
      tabSignUpEl.addEventListener('click', function() { if (!busy) setMode('sign_up'); });

      altActionEl.addEventListener('click', async function() {
        if (busy) return;
        if (mode === 'reset_password') {
          setMode('sign_in');
          return;
        }

        var email = String(emailEl.value || '').trim().toLowerCase();
        if (!email) {
          setStatus('Enter your email to receive a reset link.', true);
          return;
        }

        setBusy(true);
        setStatus('Sending password reset email...');
        try {
          var req = await postJson('/auth/request-password-reset', {
            email: email,
            redirect_uri: AUTH.redirectUri || '/',
          });
          if (!req.response.ok) {
            setStatus(req.data.message || req.data.error || 'Unable to send password reset email.', true);
            return;
          }
          setStatus(req.data.message || 'Password reset email sent. Check your inbox.');
        } finally {
          setBusy(false);
        }
      });

      formEl.addEventListener('submit', async function(event) {
        event.preventDefault();
        if (busy) return;

        var email = String(emailEl.value || '').trim().toLowerCase();
        var password = String(passwordEl.value || '');
        var redirectUri = AUTH.redirectUri || '/';

        if (mode === 'reset_password') {
          var confirmPassword = String(confirmPasswordEl.value || '');
          if (!AUTH.resetToken) {
            setStatus('Password reset link is missing or invalid. Request a new one.', true);
            return;
          }
          if (!password || !confirmPassword) {
            setStatus('Enter and confirm your new password.', true);
            return;
          }
          if (password !== confirmPassword) {
            setStatus('Passwords do not match.', true);
            return;
          }

          setBusy(true);
          setStatus('Updating password...');
          try {
            var resetReq = await postJson('/auth/reset-password', {
              token: AUTH.resetToken,
              new_password: password,
              redirect_uri: redirectUri,
            });
            if (!resetReq.response.ok) {
              setStatus(resetReq.data.message || resetReq.data.error || 'Unable to reset password.', true);
              return;
            }
            passwordEl.value = '';
            confirmPasswordEl.value = '';
            setMode('sign_in');
            setStatus(resetReq.data.message || 'Password updated. Sign in with your new password.');
          } finally {
            setBusy(false);
          }
          return;
        }

        if (!email || !password) {
          setStatus('Enter email and password.', true);
          return;
        }

        setBusy(true);
        try {
          if (mode === 'sign_up') {
            setStatus('Creating account...');
            var signUpReq = await postJson('/auth/sign-up', {
              email: email,
              password: password,
              name: email.split('@')[0] || 'user',
              redirect_uri: redirectUri,
            });
            if (!signUpReq.response.ok) {
              setStatus(signUpReq.data.message || signUpReq.data.error || 'Unable to create account.', true);
              return;
            }
            passwordEl.value = '';
            setMode('sign_in');
            setStatus(signUpReq.data.message || 'Check your email to verify your account.');
            return;
          }

          setStatus('Signing in...');
          var signInReq = await postJson('/auth/sign-in', {
            email: email,
            password: password,
            redirect_uri: redirectUri,
          });
          if (!signInReq.response.ok) {
            setStatus(signInReq.data.message || signInReq.data.error || 'Unable to sign in.', true);
            return;
          }
          window.location.assign(signInReq.data.redirect_uri || redirectUri || '/');
        } finally {
          setBusy(false);
        }
      });

      setMode(mode);
    })();
  </script>
</body>
</html>`

const HOSTED_CALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Completing sign-in...</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0e1412;
      --panel: #161f1a;
      --text: #f4f6f5;
      --muted: #b7c1bc;
      --accent: #79e0a4;
      --danger: #ff8d8d;
      --border: rgba(255,255,255,0.08);
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #eff4f1;
        --panel: #ffffff;
        --text: #112018;
        --muted: #5d6b63;
        --accent: #0c8f50;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(circle at top, rgba(121,224,164,0.14), transparent 35%), var(--bg);
      color: var(--text);
    }
    .card {
      width: min(100%, 420px);
      padding: 28px;
      border-radius: 18px;
      background: var(--panel);
      border: 1px solid var(--border);
    }
    h1 { margin: 0 0 8px; font-size: 1.4rem; }
    p { margin: 0; line-height: 1.5; color: var(--muted); }
    .error { margin-top: 16px; color: var(--danger); }
    .link { display: inline-block; margin-top: 18px; color: var(--accent); font-weight: 700; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Completing sign-in...</h1>
    <p id="status">Finishing email verification.</p>
    <p id="error" class="error" hidden></p>
    <a id="login-link" class="link" href="/auth/login" hidden>Go to login</a>
  </main>

  <script>
    (function() {
      var AUTH = /*AUTH_CONFIG_JSON*/;
      var statusEl = document.getElementById('status');
      var errorEl = document.getElementById('error');
      var loginEl = document.getElementById('login-link');

      function showError(message) {
        statusEl.textContent = 'Sign-in could not be completed.';
        errorEl.hidden = false;
        errorEl.textContent = message || 'Unexpected callback error.';
        loginEl.hidden = false;
        loginEl.href = '/auth/login?redirect_uri=' + encodeURIComponent(AUTH.redirectUri || '/');
      }

      async function run() {
        try {
          var tokenResp = await fetch(AUTH.neonAuthUrl + '/token', { credentials: 'include' });
          var tokenPayload = {};
          try { tokenPayload = await tokenResp.json(); } catch (_) {}
          if (!tokenResp.ok || !tokenPayload.token) {
            showError(tokenPayload.message || 'Verification succeeded, but no session token was returned.');
            return;
          }

          statusEl.textContent = 'Starting your session...';
          var exchangeResp = await fetch('/auth/token-exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: tokenPayload.token,
              redirect_uri: AUTH.redirectUri || '/',
            }),
          });
          var exchangePayload = {};
          try { exchangePayload = await exchangeResp.json(); } catch (_) {}
          if (!exchangeResp.ok) {
            showError(exchangePayload.message || 'Token exchange failed.');
            return;
          }
          window.location.replace(exchangePayload.redirect_uri || AUTH.redirectUri || '/');
        } catch (error) {
          showError(error && error.message ? error.message : 'Unexpected callback error.');
        }
      }

      run();
    })();
  </script>
</body>
</html>`

function cookieName(config: Pick<ServerConfig, 'authSessionCookieName'>): string {
  return config.authSessionCookieName || appCookieName()
}

function setCookie(reply: FastifyReply, name: string, value: string, ttl: number, secure = false): void {
  reply.setCookie(name, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: ttl,
  })
}

function clearCookie(reply: FastifyReply, name: string): void {
  reply.clearCookie(name, { path: '/' })
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] || '') : (value || '')
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  error: string = 'bad_request',
) {
  return reply.code(statusCode).send({ error, code, message })
}

function safeRedirectPath(raw: unknown, fallback = '/'): string {
  const fallbackPath = validateRedirectUrl(fallback, '/')
  const candidate = String(raw ?? fallbackPath).trim()
  if (!candidate) return fallbackPath
  if (candidate.includes('\\')) return fallbackPath
  const validated = validateRedirectUrl(candidate, fallbackPath)
  if (validated !== candidate) return fallbackPath
  try {
    const decoded = decodeURIComponent(candidate)
    if (decoded.startsWith('//')) return fallbackPath
    if (INVALID_REDIRECT_CHARS_RE.test(decoded)) return fallbackPath
  } catch {
    return fallbackPath
  }
  return candidate
}

function normalizeOrigin(raw: unknown): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

function buildRequestOrigin(request: FastifyRequest): string {
  const forwardedProto = getHeader(request.headers['x-forwarded-proto'] as string | string[] | undefined)
  const forwardedHost = getHeader(request.headers['x-forwarded-host'] as string | string[] | undefined)
  const protocol = forwardedProto || request.protocol || 'http'
  const host = forwardedHost || getHeader(request.headers.host as string | string[] | undefined) || request.hostname || ''
  return host ? normalizeOrigin(`${protocol}://${host}`) : ''
}

function publicOrigin(request: FastifyRequest, config: ServerConfig): string {
  if (config.publicAppOrigin) return config.publicAppOrigin

  const requestHeaderOrigin = normalizeOrigin(request.headers.origin)
  const requestOrigin = buildRequestOrigin(request)
  const allowedOrigins = [...new Set((config.corsOrigins || []).map((origin) => normalizeOrigin(origin)).filter(Boolean))]

  if (requestHeaderOrigin && allowedOrigins.includes(requestHeaderOrigin)) {
    return requestHeaderOrigin
  }

  if (
    requestHeaderOrigin
    && requestOrigin
    && requestHeaderOrigin === requestOrigin
    && requestOrigin.startsWith('https://')
  ) {
    return requestOrigin
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin
  }

  if (allowedOrigins.length > 0) {
    return [...allowedOrigins].sort()[0] || ''
  }

  return requestOrigin || requestHeaderOrigin
}

function buildCallbackQuery(redirectUri: string, pendingLogin?: string): string {
  const params = new URLSearchParams()
  params.set('redirect_uri', redirectUri)
  if (pendingLogin) params.set('pending_login', pendingLogin)
  return params.toString()
}

function buildCallbackPath(redirectUri: string, pendingLogin?: string): string {
  return `/auth/callback?${buildCallbackQuery(redirectUri, pendingLogin)}`
}

function buildCallbackUrl(request: FastifyRequest, config: ServerConfig, redirectUri: string): string {
  const base = publicOrigin(request, config)
  if (!base) return buildCallbackPath(redirectUri)
  return `${base}/auth/callback?${buildCallbackQuery(redirectUri)}`
}

function buildPasswordResetUrl(request: FastifyRequest, config: ServerConfig, redirectUri: string): string {
  const params = new URLSearchParams()
  params.set('redirect_uri', redirectUri)
  const base = publicOrigin(request, config)
  if (!base) return `/auth/reset-password?${params.toString()}`
  return `${base}/auth/reset-password?${params.toString()}`
}

function pendingLoginKey(config: Pick<ServerConfig, 'sessionSecret'>): Uint8Array {
  return createHash('sha256').update(config.sessionSecret, 'utf8').digest()
}

async function encodePendingLogin(
  config: Pick<ServerConfig, 'sessionSecret'>,
  email: string,
  password: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new jose.EncryptJWT({ email, password })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(now)
    .setExpirationTime(now + PENDING_LOGIN_TTL_SECONDS)
    .encrypt(pendingLoginKey(config))
}

async function decodePendingLogin(
  config: Pick<ServerConfig, 'sessionSecret'>,
  token: string,
): Promise<{ email: string; password: string } | null> {
  try {
    const { payload } = await jose.jwtDecrypt(token, pendingLoginKey(config), { clockTolerance: 30 })
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    const password = typeof payload.password === 'string' ? payload.password.trim() : ''
    if (!email || !password) return null
    return { email, password }
  } catch {
    return null
  }
}

function parseNeonErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string') {
    const text = body.trim()
    return text || fallback
  }
  if (isRecord(body)) {
    const message = body.message
    if (typeof message === 'string' && message.trim()) return message.trim()
    if (isRecord(body.error)) {
      const nestedMessage = body.error.message
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim()
    }
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    if (typeof body.statusText === 'string' && body.statusText.trim()) return body.statusText.trim()
  }
  return fallback
}

function authHtmlConfig(
  config: ServerConfig,
  request: FastifyRequest,
  initialMode: 'sign_in' | 'sign_up' | 'reset_password',
): JsonRecord {
  return {
    appName: config.authAppName || 'Boring UI',
    neonAuthUrl: String(config.neonAuthBaseUrl || '').trim().replace(/\/+$/, ''),
    redirectUri: safeRedirectPath((request.query as JsonRecord | undefined)?.redirect_uri),
    initialMode,
    resetToken: String((request.query as JsonRecord | undefined)?.token || '').trim(),
    resetError: String((request.query as JsonRecord | undefined)?.error || '').trim(),
    verificationEmailEnabled: config.authEmailProvider !== 'none',
  }
}

function renderInlineHtml(template: string, payload: JsonRecord): string {
  return template.replace(
    AUTH_CONFIG_PLACEHOLDER,
    JSON.stringify(payload).replace(/</g, '\\u003c'),
  )
}

function renderHostedAuthPage(
  reply: FastifyReply,
  config: ServerConfig,
  request: FastifyRequest,
  initialMode: 'sign_in' | 'sign_up' | 'reset_password',
) {
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  return reply.send(renderInlineHtml(HOSTED_AUTH_HTML, authHtmlConfig(config, request, initialMode)))
}

function renderHostedCallbackPage(
  reply: FastifyReply,
  config: ServerConfig,
  request: FastifyRequest,
) {
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  return reply.send(renderInlineHtml(HOSTED_CALLBACK_HTML, {
    neonAuthUrl: String(config.neonAuthBaseUrl || '').trim().replace(/\/+$/, ''),
    redirectUri: safeRedirectPath((request.query as JsonRecord | undefined)?.redirect_uri),
  }))
}

async function buildSessionFromNeonAccessToken(
  accessToken: string,
  config: ServerConfig,
): Promise<{ userId: string; email: string; cookie: string } | null> {
  const verified = await verifyNeonAccessToken(accessToken, config)
  if (!verified) return null
  const cookie = await createSessionCookie(verified.userId, verified.email, config.sessionSecret, {
    ttlSeconds: config.authSessionTtlSeconds,
    appId: config.controlPlaneAppId,
  })
  return {
    userId: verified.userId,
    email: verified.email,
    cookie,
  }
}

async function handleLocalCallback(
  reply: FastifyReply,
  config: ServerConfig,
  userId: string,
  email: string,
  redirectUri: string,
): Promise<void> {
  const token = await createSessionCookie(userId, email, config.sessionSecret, {
    ttlSeconds: config.authSessionTtlSeconds,
    appId: config.controlPlaneAppId,
  })
  setCookie(reply, cookieName(config), token, config.authSessionTtlSeconds, config.authSessionSecureCookie)
  await reply.redirect(redirectUri)
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const config = app.config
  const cName = cookieName(config)

  app.get('/auth/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[cName]

    if (!token) {
      if (config.controlPlaneProvider === 'neon') {
        return sendError(reply, 401, 'SESSION_REQUIRED', 'Authentication required', 'unauthorized')
      }
      return {
        authenticated: false,
        user_id: null,
        email: null,
        user: null,
        expires_at: null,
      }
    }

    try {
      const session = await parseSessionCookie(token, config.sessionSecret)
      return {
        authenticated: true,
        user_id: session.user_id,
        email: session.email,
        user: {
          user_id: session.user_id,
          email: session.email,
        },
        expires_at: session.exp ? new Date(session.exp * 1000).toISOString() : null,
      }
    } catch (error) {
      if (config.controlPlaneProvider === 'neon') {
        if (error instanceof SessionExpiredError) {
          return sendError(reply, 401, 'SESSION_EXPIRED', 'Session has expired. Please sign in again.', 'unauthorized')
        }
        return sendError(reply, 401, 'SESSION_INVALID', 'Invalid session', 'unauthorized')
      }

      return {
        authenticated: false,
        user_id: null,
        email: null,
        user: null,
        expires_at: null,
      }
    }
  })

  app.post('/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    clearCookie(reply, cName)
    return { ok: true }
  })

  app.get('/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    clearCookie(reply, cName)
    return reply.redirect('/auth/login')
  })

  if (config.controlPlaneProvider === 'local') {
    app.get('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query as JsonRecord | undefined) || {}
      const userId = String(query.user_id || '').trim()
      const email = String(query.email || '').trim().toLowerCase()
      if (!userId || !email) {
        return sendError(reply, 400, 'LOGIN_IDENTITY_REQUIRED', 'user_id and email query params are required')
      }
      const redirectUri = safeRedirectPath(query.redirect_uri)
      await handleLocalCallback(reply, config, userId, email, redirectUri)
    })

    app.get('/auth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query as JsonRecord | undefined) || {}
      const userId = String(query.user_id || '').trim()
      const email = String(query.email || '').trim().toLowerCase()
      if (!userId || !email) {
        return sendError(reply, 400, 'LOGIN_IDENTITY_REQUIRED', 'user_id and email query params are required')
      }
      const redirectUri = safeRedirectPath(query.redirect_uri)
      await handleLocalCallback(reply, config, userId, email, redirectUri)
    })

    return
  }

  if (config.controlPlaneProvider !== 'neon') return

  app.get('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    // NOTE: No user_id/email shortcut in Neon mode — that would bypass auth.
    // The local-mode shortcut is in the `if (config.controlPlaneProvider === 'local')` block above.
    return renderHostedAuthPage(reply, config, request, 'sign_in')
  })

  app.get('/auth/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    return renderHostedAuthPage(reply, config, request, 'sign_up')
  })

  app.get('/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    return renderHostedAuthPage(reply, config, request, 'reset_password')
  })

  app.post('/auth/sign-in', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, 'INVALID_JSON', 'Expected JSON object')
    }

    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '').trim()
    if (!email || !password) {
      return sendError(reply, 400, 'EMAIL_PASSWORD_REQUIRED', 'email and password are required')
    }

    const redirectUri = safeRedirectPath(request.body.redirect_uri)
    const result = await signInWithPassword(config, email, password)

    if (!result.response.ok) {
      const statusCode = result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502
      return sendError(
        reply,
        statusCode,
        String((isRecord(result.body) ? result.body.code : '') || 'NEON_AUTH_REJECTED'),
        parseNeonErrorMessage(result.body, 'Unable to sign in.'),
        'auth_failed',
      )
    }

    if (!result.accessToken) {
      return sendError(
        reply,
        502,
        'NEON_AUTH_TOKEN_MISSING',
        'Neon Auth did not return a session token.',
        'upstream_error',
      )
    }

    const session = await buildSessionFromNeonAccessToken(result.accessToken, config)
    if (!session) {
      return sendError(reply, 401, 'TOKEN_INVALID', 'Neon Auth JWT verification failed', 'unauthorized')
    }

    setCookie(reply, cName, session.cookie, config.authSessionTtlSeconds, config.authSessionSecureCookie)
    return {
      ok: true,
      redirect_uri: redirectUri,
    }
  })

  app.post('/auth/sign-up', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, 'INVALID_JSON', 'Expected JSON object')
    }

    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '').trim()
    if (!email || !password) {
      return sendError(reply, 400, 'EMAIL_PASSWORD_REQUIRED', 'email and password are required')
    }

    const redirectUri = safeRedirectPath(request.body.redirect_uri)
    const name = String(request.body.name || '').trim() || email.split('@')[0] || 'user'
    const signUpResult = await signUpWithPassword(config, email, password, name)

    if (!signUpResult.response.ok) {
      const statusCode = signUpResult.response.status >= 400 && signUpResult.response.status < 500
        ? signUpResult.response.status
        : 502
      return sendError(
        reply,
        statusCode,
        String((isRecord(signUpResult.body) ? signUpResult.body.code : '') || 'NEON_AUTH_REJECTED'),
        parseNeonErrorMessage(signUpResult.body, 'Unable to create account.'),
        'auth_failed',
      )
    }

    const verificationEnabled = config.authEmailProvider !== 'none'
    let verificationSent = false

    if (verificationEnabled) {
      const pendingLogin = await encodePendingLogin(config, email, password)
      const callbackPath = buildCallbackPath(redirectUri, pendingLogin)
      const origin = publicOrigin(request, config) || buildRequestOrigin(request)
      try {
        const verificationResult = await sendVerificationEmail(
          config,
          email,
          callbackPath,
          origin,
        )
        verificationSent = verificationResult.response.ok
      } catch {
        verificationSent = false
      }
    }

    return {
      ok: true,
      requires_email_verification: true,
      verification_email_enabled: verificationEnabled,
      verification_email_sent: verificationSent,
      message: verificationEnabled
        ? (
          verificationSent
            ? 'Check your email to verify your account.'
            : 'Account created, but we could not send the verification email. Try again later or contact the administrator.'
        )
        : 'Account created, but verification email delivery is not configured for this deployment.',
      redirect_uri: redirectUri,
    }
  })

  app.post('/auth/resend-verification', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, 'INVALID_JSON', 'Expected JSON object')
    }

    const email = String(request.body.email || '').trim().toLowerCase()
    if (!email) {
      return sendError(reply, 400, 'EMAIL_REQUIRED', 'email is required')
    }

    const redirectUri = safeRedirectPath(request.body.redirect_uri)
    const callbackUrl = buildCallbackUrl(request, config, redirectUri)
    const origin = config.neonAuthBaseUrl ? neonOriginFromBaseUrl(config.neonAuthBaseUrl) : ''

    const resendResult = await sendVerificationEmail(config, email, callbackUrl, origin)
    if (!resendResult.response.ok) {
      const statusCode = resendResult.response.status >= 400 && resendResult.response.status < 500
        ? resendResult.response.status
        : 502
      return sendError(
        reply,
        statusCode,
        String((isRecord(resendResult.body) ? resendResult.body.code : '') || 'NEON_AUTH_REJECTED'),
        parseNeonErrorMessage(resendResult.body, 'Unable to resend verification email.'),
        'auth_failed',
      )
    }

    return {
      ok: true,
      message: 'Verification email sent. Check your inbox.',
      redirect_uri: redirectUri,
    }
  })

  app.post('/auth/request-password-reset', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, 'INVALID_JSON', 'Expected JSON object')
    }

    const email = String(request.body.email || '').trim().toLowerCase()
    if (!email) {
      return sendError(reply, 400, 'EMAIL_REQUIRED', 'email is required')
    }

    const redirectUri = safeRedirectPath(request.body.redirect_uri)
    const redirectTo = buildPasswordResetUrl(request, config, redirectUri)
    const result = await requestPasswordResetEmail(config, email, redirectTo)

    if (!result.response.ok) {
      if (result.response.status >= 400 && result.response.status < 500 && result.response.status !== 429) {
        return {
          ok: true,
          message: 'Password reset email sent. Check your inbox.',
          redirect_uri: redirectUri,
        }
      }
      const statusCode = result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502
      return sendError(
        reply,
        statusCode,
        String((isRecord(result.body) ? result.body.code : '') || 'NEON_AUTH_REJECTED'),
        parseNeonErrorMessage(result.body, 'Unable to send password reset email.'),
        'auth_failed',
      )
    }

    return {
      ok: true,
      message: 'Password reset email sent. Check your inbox.',
      redirect_uri: redirectUri,
    }
  })

  app.post('/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, 'INVALID_JSON', 'Expected JSON object')
    }

    const token = String(request.body.token || '').trim()
    const newPassword = String(request.body.new_password || request.body.newPassword || '').trim()
    if (!token || !newPassword) {
      return sendError(reply, 400, 'TOKEN_PASSWORD_REQUIRED', 'token and new_password are required')
    }

    const redirectUri = safeRedirectPath(request.body.redirect_uri)
    const result = await resetPassword(config, token, newPassword)

    if (!result.response.ok) {
      const statusCode = result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502
      return sendError(
        reply,
        statusCode,
        String((isRecord(result.body) ? result.body.code : '') || 'NEON_AUTH_REJECTED'),
        parseNeonErrorMessage(result.body, 'Unable to reset password.'),
        'auth_failed',
      )
    }

    return {
      ok: true,
      message: 'Password updated. Sign in with your new password.',
      redirect_uri: redirectUri,
    }
  })

  app.get('/auth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query as JsonRecord | undefined) || {}
    // NOTE: No user_id/email shortcut in Neon callback — that would bypass auth.
    const redirectUri = safeRedirectPath(query.redirect_uri)

    const pendingLoginToken = String(query.pending_login || '').trim()
    if (pendingLoginToken) {
      const credentials = await decodePendingLogin(config, pendingLoginToken)
      if (credentials) {
        const signInResult = await signInWithPassword(config, credentials.email, credentials.password)
        if (signInResult.response.ok && signInResult.accessToken) {
          const session = await buildSessionFromNeonAccessToken(signInResult.accessToken, config)
          if (session) {
            setCookie(reply, cName, session.cookie, config.authSessionTtlSeconds, config.authSessionSecureCookie)
            await reply.redirect(redirectUri)
            return
          }
        }
      }
    }

    return renderHostedCallbackPage(reply, config, request)
  })

  app.post('/auth/token-exchange', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, 'INVALID_JSON', 'Expected JSON object')
    }

    const accessToken = String(
      request.body.access_token
      || request.body.session_token
      || request.body.token
      || '',
    ).trim()
    if (!accessToken) {
      return sendError(reply, 400, 'MISSING_ACCESS_TOKEN', 'access_token is required')
    }

    const session = await buildSessionFromNeonAccessToken(accessToken, config)
    if (!session) {
      return sendError(reply, 401, 'TOKEN_INVALID', 'Neon Auth JWT verification failed', 'unauthorized')
    }

    const redirectUri = safeRedirectPath(request.body.redirect_uri)
    setCookie(reply, cName, session.cookie, config.authSessionTtlSeconds, config.authSessionSecureCookie)
    return {
      ok: true,
      redirect_uri: redirectUri,
    }
  })
}
