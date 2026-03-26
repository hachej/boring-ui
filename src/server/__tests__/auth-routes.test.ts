import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as jose from 'jose'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import * as neonAuth from '../auth/neonClient.js'
import { createSessionCookie } from '../auth/session.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'
const NEON_AUTH_BASE_URL = 'https://example.neonauth.test/neondb/auth'
const NEON_JWKS_URL = 'https://example.neonauth.test/neondb/auth/.well-known/jwks.json'

let app: FastifyInstance

function localConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...loadConfig(),
    sessionSecret: TEST_SECRET,
    controlPlaneProvider: 'local' as const,
    ...overrides,
  }
}

function neonConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...loadConfig(),
    sessionSecret: TEST_SECRET,
    controlPlaneProvider: 'neon' as const,
    databaseUrl: 'postgresql://example.invalid/neondb',
    neonAuthBaseUrl: NEON_AUTH_BASE_URL,
    neonAuthJwksUrl: NEON_JWKS_URL,
    corsOrigins: ['http://127.0.0.1:5176', 'http://213.32.19.186:5176'],
    ...overrides,
  }
}

function jsonResponse(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  })
}

async function makePendingLogin(email: string, password: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new jose.EncryptJWT({ email, password })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(now)
    .setExpirationTime(now + 1800)
    .encrypt(createHash('sha256').update(TEST_SECRET).digest())
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (app) {
    await app.close()
    app = undefined as unknown as FastifyInstance
  }
})

describe('local auth routes', () => {
  it('requires identity params for local login', async () => {
    app = createApp({ config: localConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'GET',
      url: '/auth/login',
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).code).toBe('LOGIN_IDENTITY_REQUIRED')
  })

  it('creates a session and redirects for local login', async () => {
    app = createApp({ config: localConfig() as any, skipValidation: true })

    const login = await app.inject({
      method: 'GET',
      url: '/auth/login?user_id=test-user&email=test@example.com&redirect_uri=/w/demo',
    })

    expect(login.statusCode).toBe(302)
    expect(login.headers.location).toBe('/w/demo')
    expect(login.headers['set-cookie']).toContain('boring_session=')

    const session = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: login.headers['set-cookie'] as string },
    })

    expect(session.statusCode).toBe(200)
    expect(JSON.parse(session.payload)).toMatchObject({
      authenticated: true,
      user: {
        user_id: 'test-user',
        email: 'test@example.com',
      },
    })
  })

  it('clears the session cookie on logout', async () => {
    app = createApp({ config: localConfig() as any, skipValidation: true })

    const logout = await app.inject({
      method: 'GET',
      url: '/auth/logout',
    })

    expect(logout.statusCode).toBe(302)
    expect(logout.headers.location).toBe('/auth/login')
    expect(logout.headers['set-cookie']).toContain('boring_session=')
  })
})

describe('hosted Neon auth routes', () => {
  it('serves HTML auth shells in neon mode', async () => {
    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const login = await app.inject({ method: 'GET', url: '/auth/login?redirect_uri=/w/demo' })
    const signup = await app.inject({ method: 'GET', url: '/auth/signup?redirect_uri=/w/demo' })
    const reset = await app.inject({
      method: 'GET',
      url: '/auth/reset-password?redirect_uri=/w/demo&token=reset-token&error=invalid_token',
    })

    expect(login.statusCode).toBe(200)
    expect(login.headers['content-type']).toContain('text/html')
    expect(login.payload).toContain('Welcome back')

    expect(signup.statusCode).toBe(200)
    expect(signup.headers['content-type']).toContain('text/html')
    expect(signup.payload).toContain('Create account')

    expect(reset.statusCode).toBe(200)
    expect(reset.headers['content-type']).toContain('text/html')
    expect(reset.payload).toContain('"initialMode":"reset_password"')
    expect(reset.payload).toContain('"resetToken":"reset-token"')
    expect(reset.payload).toContain('"resetError":"invalid_token"')
  })

  it('signs in with email/password and sets the boring session cookie', async () => {
    // Real Neon Auth returns an opaque session ID in body.token AND sets session cookies.
    // The code must use the cookie-based /token endpoint (which returns the real JWT),
    // not the opaque body.token.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'opaque-session-id' }, { 'set-cookie': 'better-auth.session=abc123; Path=/; HttpOnly' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-from-neon' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(neonAuth, 'verifyNeonAccessToken').mockResolvedValue({
      userId: 'user-neon-signin',
      email: 'owner@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: {
        email: 'owner@example.com',
        password: 'password123',
        redirect_uri: '/w/demo',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      ok: true,
      redirect_uri: '/w/demo',
    })
    expect(res.headers['set-cookie']).toContain('boring_session=')
    // Must call both sign-in AND /token (not stop at the opaque body.token)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, tokenInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(tokenInit.headers).toHaveProperty('Cookie')
  })

  it('signs up and auto-sends a verification email using a relative callback path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: { email: 'new@example.com' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      headers: {
        origin: 'https://boring-ui-frontend-agent.fly.dev',
        host: 'boring-ui-frontend-agent.fly.dev',
        'x-forwarded-proto': 'https',
      },
      payload: {
        email: 'new@example.com',
        password: 'password123',
        redirect_uri: '/',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toMatchObject({
      ok: true,
      requires_email_verification: true,
      verification_email_enabled: true,
      verification_email_sent: true,
      redirect_uri: '/',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [signupUrl, signupInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(signupUrl).toBe(`${NEON_AUTH_BASE_URL}/sign-up/email`)
    expect(signupInit.headers).toMatchObject({
      'Content-Type': 'application/json',
      Origin: 'https://example.neonauth.test',
    })
    expect(JSON.parse(String(signupInit.body))).toEqual({
      email: 'new@example.com',
      password: 'password123',
      name: 'new',
    })

    const [verifyUrl, verifyInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(verifyUrl).toBe(`${NEON_AUTH_BASE_URL}/send-verification-email`)
    expect(verifyInit.headers).toMatchObject({
      'Content-Type': 'application/json',
      Origin: 'https://boring-ui-frontend-agent.fly.dev',
    })
    const verificationBody = JSON.parse(String(verifyInit.body))
    expect(verificationBody.email).toBe('new@example.com')
    expect(verificationBody.callbackURL).toMatch(/^\/auth\/callback\?/)
    expect(verificationBody.callbackURL).toContain('redirect_uri=%2F')
    expect(verificationBody.callbackURL).toContain('pending_login=')
  })

  it('uses a trusted absolute callback URL for resend verification', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      headers: {
        origin: 'https://attacker.example',
      },
      payload: {
        email: 'new@example.com',
        redirect_uri: '/w/demo',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toMatchObject({
      ok: true,
      redirect_uri: '/w/demo',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${NEON_AUTH_BASE_URL}/send-verification-email`)
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Origin: 'https://example.neonauth.test',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'new@example.com',
      callbackURL: 'http://127.0.0.1:5176/auth/callback?redirect_uri=%2Fw%2Fdemo',
    })
  })

  it('completes pending login on callback and redirects to the target workspace', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'opaque-session-id' }, { 'set-cookie': 'better-auth.session=abc123; Path=/; HttpOnly' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-from-neon' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(neonAuth, 'verifyNeonAccessToken').mockResolvedValue({
      userId: 'user-neon-1',
      email: 'verified@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    app = createApp({ config: neonConfig() as any, skipValidation: true })
    const pendingLogin = await makePendingLogin('verified@example.com', 'password123')

    const res = await app.inject({
      method: 'GET',
      url: `/auth/callback?redirect_uri=%2Fw%2Fdemo&pending_login=${encodeURIComponent(pendingLogin)}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/w/demo')
    expect(res.headers['set-cookie']).toContain('boring_session=')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [signinUrl, signinInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(signinUrl).toBe(`${NEON_AUTH_BASE_URL}/sign-in/email`)
    expect(JSON.parse(String(signinInit.body))).toEqual({
      email: 'verified@example.com',
      password: 'password123',
    })
  })

  it('exchanges a Neon access token into a boring session cookie', async () => {
    vi.spyOn(neonAuth, 'verifyNeonAccessToken').mockResolvedValue({
      userId: 'user-neon-2',
      email: 'owner@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token-exchange',
      payload: {
        access_token: 'valid-jwt',
        redirect_uri: '/w/demo',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      ok: true,
      redirect_uri: '/w/demo',
    })
    expect(res.headers['set-cookie']).toContain('boring_session=')
  })

  it('returns Python-compatible session payloads and errors', async () => {
    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const missing = await app.inject({
      method: 'GET',
      url: '/auth/session',
    })
    expect(missing.statusCode).toBe(401)
    expect(JSON.parse(missing.payload).code).toBe('SESSION_REQUIRED')

    const invalid = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: 'boring_session=invalid.token' },
    })
    expect(invalid.statusCode).toBe(401)
    expect(JSON.parse(invalid.payload).code).toBe('SESSION_INVALID')

    const token = await createSessionCookie('user-123', 'alice@example.com', TEST_SECRET, {
      ttlSeconds: 3600,
      appId: 'boring-ui',
    })
    const valid = await app.inject({
      method: 'GET',
      url: '/auth/session',
      cookies: { boring_session: token },
    })

    expect(valid.statusCode).toBe(200)
    expect(JSON.parse(valid.payload)).toMatchObject({
      authenticated: true,
      user: {
        user_id: 'user-123',
        email: 'alice@example.com',
      },
    })
  })

  it('masks unknown-email errors for password reset requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { message: 'User not found' }))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: {
        email: 'missing@example.com',
        redirect_uri: '/w/demo',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      ok: true,
      message: 'Password reset email sent. Check your inbox.',
      redirect_uri: '/w/demo',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${NEON_AUTH_BASE_URL}/request-password-reset`)
    const body = JSON.parse(String(init.body))
    expect(body.email).toBe('missing@example.com')
    expect(body.redirectTo).toBe('http://127.0.0.1:5176/auth/reset-password?redirect_uri=%2Fw%2Fdemo')
  })

  it('rejects sign-in with missing email or password', async () => {
    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const noEmail = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { password: 'password123' },
    })
    expect(noEmail.statusCode).toBe(400)
    expect(JSON.parse(noEmail.payload).code).toBe('EMAIL_PASSWORD_REQUIRED')

    const noPassword = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'test@example.com' },
    })
    expect(noPassword.statusCode).toBe(400)
    expect(JSON.parse(noPassword.payload).code).toBe('EMAIL_PASSWORD_REQUIRED')
  })

  it('returns 401 when Neon Auth rejects sign-in credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: 'INVALID_PASSWORD', message: 'Wrong password' }))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'user@test.com', password: 'wrong' },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload).code).toBe('INVALID_PASSWORD')
  })

  it('returns 502 when sign-in succeeds but no access token is available', async () => {
    // Neon returns 200 but no cookies and no body.token
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'user@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.payload).code).toBe('NEON_AUTH_TOKEN_MISSING')
  })

  it('returns 401 when access token fails JWT verification', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'bad-jwt' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(neonAuth, 'verifyNeonAccessToken').mockResolvedValue(null)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'user@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload).code).toBe('TOKEN_INVALID')
  })

  it('rejects sign-up with missing email or password', async () => {
    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email: 'test@example.com' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).code).toBe('EMAIL_PASSWORD_REQUIRED')
  })

  it('forwards Neon Auth sign-up rejection with correct status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(422, { code: 'USER_EXISTS', message: 'Email already registered' }))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      headers: {
        origin: 'https://boring-ui-frontend-agent.fly.dev',
        host: 'boring-ui-frontend-agent.fly.dev',
        'x-forwarded-proto': 'https',
      },
      payload: { email: 'existing@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.payload).code).toBe('USER_EXISTS')
  })

  it('rejects token-exchange with missing access_token', async () => {
    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token-exchange',
      payload: { redirect_uri: '/' },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).code).toBe('MISSING_ACCESS_TOKEN')
  })

  it('rejects token-exchange when JWT verification fails', async () => {
    vi.spyOn(neonAuth, 'verifyNeonAccessToken').mockResolvedValue(null)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token-exchange',
      payload: { access_token: 'forged-jwt' },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload).code).toBe('TOKEN_INVALID')
  })

  it('falls back to callback HTML when pending_login is expired or invalid', async () => {
    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?redirect_uri=%2F&pending_login=garbage',
    })

    // Should render client-side callback page (not crash or redirect)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.payload).toContain('Completing sign-in')
  })

  it('sanitizes redirect_uri to prevent open redirects', async () => {
    app = createApp({ config: localConfig() as any, skipValidation: true })

    const absolute = await app.inject({
      method: 'GET',
      url: '/auth/login?user_id=u&email=e@x.com&redirect_uri=https://evil.com',
    })
    expect(absolute.statusCode).toBe(302)
    expect(absolute.headers.location).toBe('/')

    const proto = await app.inject({
      method: 'GET',
      url: '/auth/login?user_id=u&email=e@x.com&redirect_uri=//evil.com',
    })
    expect(proto.statusCode).toBe(302)
    expect(proto.headers.location).toBe('/')
  })

  it('proxies reset-password updates to Neon Auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    app = createApp({ config: neonConfig() as any, skipValidation: true })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: {
        token: 'reset-token',
        new_password: 'new-password-123',
        redirect_uri: '/w/demo',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      ok: true,
      message: 'Password updated. Sign in with your new password.',
      redirect_uri: '/w/demo',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${NEON_AUTH_BASE_URL}/reset-password`)
    expect(JSON.parse(String(init.body))).toEqual({
      token: 'reset-token',
      newPassword: 'new-password-123',
    })
  })
})
