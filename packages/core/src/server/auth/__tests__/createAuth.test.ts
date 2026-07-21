import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createAuth, validatePasswordStrength } from '../createAuth'
import type { BetterAuthInstance } from '../createAuth'
import { runMigrations } from '../../db/migrate'
import { createDatabase } from '../../db/connection'
import type { CoreConfig } from '../../../shared/types'
import type { Database } from '../../db/connection'
import postgres from 'postgres'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const MAIL_CAPTURE_PATH = `/tmp/auth-test-mail-${process.pid}.log`

function makeConfig(overrides?: Partial<CoreConfig>): CoreConfig {
  return {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: TEST_DB_URL,
    stores: 'postgres',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'silent' as CoreConfig['logLevel'],
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 's'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
      mail: {
        from: 'noreply@test.dev',
        transportUrl: `console-capture://${MAIL_CAPTURE_PATH}`,
      },
    },
    features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
    ...overrides,
  }
}

function readCapturedEmails(): Array<{ to: string; subject: string; html: string; text: string }> {
  if (!existsSync(MAIL_CAPTURE_PATH)) return []
  const content = readFileSync(MAIL_CAPTURE_PATH, 'utf-8').trim()
  if (!content) return []
  return content.split('\n').map((line) => JSON.parse(line))
}

async function waitForCapturedEmail(
  matcher: (email: { to: string; subject: string; html: string; text: string }) => boolean,
  timeoutMs = 2_000,
): Promise<{ to: string; subject: string; html: string; text: string } | undefined> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const match = readCapturedEmails().find(matcher)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return readCapturedEmails().find(matcher)
}

function clearCapturedEmails() {
  if (existsSync(MAIL_CAPTURE_PATH)) unlinkSync(MAIL_CAPTURE_PATH)
}

let db: Database
let rawSql: postgres.Sql
let auth: BetterAuthInstance

beforeAll(async () => {
  const config = makeConfig()
  await runMigrations(config)
  const conn = createDatabase(config)
  db = conn.db
  rawSql = conn.sql
  auth = createAuth(config, db)
  clearCapturedEmails()
})

afterAll(async () => {
  clearCapturedEmails()
  await rawSql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@auth-test.dev')`
  await rawSql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@auth-test.dev')`
  await rawSql`DELETE FROM verification_tokens WHERE 1=1`
  await rawSql`DELETE FROM users WHERE email LIKE '%@auth-test.dev'`
  await rawSql.end()
})

async function authRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> {
  const url = `http://localhost:3000${path}`
  const req = new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return auth.handler(req)
}

describe('createAuth', () => {
  it('shares one explicitly scoped secure session across trusted product subdomains', async () => {
    const sharedConfig = makeConfig({
      cors: {
        origins: ['https://legal.products.example', 'https://research.products.example'],
        credentials: true,
      },
      auth: {
        ...makeConfig().auth,
        url: 'https://legal.products.example',
        sessionCookieSecure: true,
        mail: undefined,
      },
    })
    const createWorkspace = vi.fn()
    const sharedAuth = createAuth(sharedConfig, db, {
      workspaceStore: { create: createWorkspace } as never,
      disableDefaultWorkspaceCreation: true,
      disableInviteAcceptance: true,
      sharedAuthCookieDomain: 'products.example',
    })
    const request = (
      hostname: string,
      method: string,
      path: string,
      init: { body?: Record<string, unknown>; cookie?: string; origin?: string } = {},
    ) => sharedAuth.handler(new Request(`https://${hostname}${path}`, {
      method,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.origin ? { origin: init.origin } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }))

    const signup = await request(
      'legal.products.example',
      'POST',
      '/auth/sign-up/email',
      {
        origin: 'https://legal.products.example',
        body: {
          name: 'Shared Domain User',
          email: 'shared-domain@auth-test.dev',
          password: 'Zk8$mN!qR2xFgWpJ',
        },
      },
    )
    expect(signup.status).toBe(200)
    const setCookie = signup.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/Domain=products\.example/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    const sessionCookie = setCookie.match(/(?:^|,\s*)(__Secure-test-app\.session_token=[^;]+)/)?.[1]
    expect(sessionCookie).toBeDefined()
    expect(createWorkspace).not.toHaveBeenCalled()

    const sessionOnB = await request(
      'research.products.example',
      'GET',
      '/auth/get-session',
      { cookie: sessionCookie, origin: 'https://research.products.example' },
    )
    expect(sessionOnB.status).toBe(200)
    expect((await sessionOnB.json()).user.email).toBe('shared-domain@auth-test.dev')

    const allowedRelativeCallback = await request(
      'research.products.example',
      'POST',
      '/auth/sign-in/email',
      {
        origin: 'https://research.products.example',
        body: {
          email: 'shared-domain@auth-test.dev',
          password: 'Zk8$mN!qR2xFgWpJ',
          callbackURL: '/',
        },
      },
    )
    expect(allowedRelativeCallback.status).toBe(200)

    const hostileOrigin = await request(
      'legal.products.example',
      'POST',
      '/auth/sign-in/email',
      {
        origin: 'https://hostile.example',
        body: { email: 'shared-domain@auth-test.dev', password: 'Zk8$mN!qR2xFgWpJ' },
      },
    )
    expect(hostileOrigin.status).toBe(403)

    const missingOrigin = await request(
      'legal.products.example',
      'POST',
      '/auth/sign-in/email',
      { body: { email: 'shared-domain@auth-test.dev', password: 'Zk8$mN!qR2xFgWpJ' } },
    )
    expect(missingOrigin.status).toBe(403)

    const hostileCallback = await request(
      'research.products.example',
      'POST',
      '/auth/sign-in/email',
      {
        origin: 'https://research.products.example',
        body: {
          email: 'shared-domain@auth-test.dev',
          password: 'Zk8$mN!qR2xFgWpJ',
          callbackURL: 'https://hostile.example/callback',
        },
      },
    )
    expect(hostileCallback.status).toBe(403)

    const logout = await request(
      'research.products.example',
      'POST',
      '/auth/sign-out',
      {
        body: {},
        cookie: sessionCookie,
        origin: 'https://research.products.example',
      },
    )
    expect(logout.status).toBe(200)

    const sessionAfterLogout = await request(
      'legal.products.example',
      'GET',
      '/auth/get-session',
      { cookie: sessionCookie, origin: 'https://legal.products.example' },
    )
    expect(sessionAfterLogout.status).toBe(200)
    expect(await sessionAfterLogout.json()).toBeNull()
    expect(createWorkspace).not.toHaveBeenCalled()
  })

  it('boots without throwing', () => {
    expect(auth).toBeDefined()
    expect(auth.handler).toBeTypeOf('function')
  })

  describe('signup happy path', () => {
    it('creates user and sends verification email', async () => {
      clearCapturedEmails()

      const res = await authRequest('POST', '/auth/sign-up/email', {
        name: 'Test User',
        email: 'signup-happy@auth-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.user).toBeDefined()
      expect(data.user.email).toBe('signup-happy@auth-test.dev')

      const verifyEmail = await waitForCapturedEmail((email) =>
        email.subject.includes('Verify'),
      )
      expect(verifyEmail).toBeDefined()
      expect(verifyEmail!.to).toBe('signup-happy@auth-test.dev')
    })
  })

  describe('signup weak password', () => {
    it('rejects common passwords', async () => {
      const res = await authRequest('POST', '/auth/sign-up/email', {
        name: 'Weak Pwd',
        email: 'weak-pwd@auth-test.dev',
        password: 'password',
      })

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.code).toBe('WEAK_PASSWORD')
    })

    it('rejects simple sequential passwords', async () => {
      const res = await authRequest('POST', '/auth/sign-up/email', {
        name: 'Weak Pwd 2',
        email: 'weak-pwd2@auth-test.dev',
        password: '12345678',
      })

      expect(res.status).toBe(400)
    })
  })

  describe('signup duplicate email', () => {
    it('rejects duplicate email signup', async () => {
      await authRequest('POST', '/auth/sign-up/email', {
        name: 'Dup User',
        email: 'dup-email@auth-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      })

      const res = await authRequest('POST', '/auth/sign-up/email', {
        name: 'Dup User 2',
        email: 'dup-email@auth-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      })

      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.code).toMatch(/USER_ALREADY_EXISTS/)
    })
  })

  describe('forgot password flow', () => {
    it('sends reset password email', async () => {
      await authRequest('POST', '/auth/sign-up/email', {
        name: 'Reset User',
        email: 'reset-pwd@auth-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      })

      clearCapturedEmails()

      const res = await authRequest('POST', '/auth/request-password-reset', {
        email: 'reset-pwd@auth-test.dev',
        redirectTo: '/',
      })

      expect(res.status).toBe(200)

      const resetEmail = await waitForCapturedEmail((email) =>
        email.subject.includes('Reset'),
      )
      expect(resetEmail).toBeDefined()
      expect(resetEmail!.to).toBe('reset-pwd@auth-test.dev')
    })
  })

  describe('magic link flow', () => {
    it('sends magic link email', async () => {
      await authRequest('POST', '/auth/sign-up/email', {
        name: 'Magic User',
        email: 'magic-link@auth-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      })

      clearCapturedEmails()

      const res = await authRequest('POST', '/auth/sign-in/magic-link', {
        email: 'magic-link@auth-test.dev',
        callbackURL: '/',
      })

      expect(res.status).toBe(200)

      const magicEmail = await waitForCapturedEmail((email) =>
        email.subject.includes('Sign in'),
      )
      expect(magicEmail).toBeDefined()
      expect(magicEmail!.to).toBe('magic-link@auth-test.dev')
    })
  })

  describe('boot without mail config', () => {
    it('creates auth without email flows', () => {
      const config = makeConfig({
        auth: {
          secret: 's'.repeat(64),
          url: 'http://localhost:3000',
          sessionTtlSeconds: 3600,
          sessionCookieSecure: false,
        },
      })

      const noMailAuth = createAuth(config, db)
      expect(noMailAuth).toBeDefined()
      expect(noMailAuth.handler).toBeTypeOf('function')
    })

    it('signup succeeds without mail but no verification email sent', async () => {
      const config = makeConfig({
        auth: {
          secret: 's'.repeat(64),
          url: 'http://localhost:3000',
          sessionTtlSeconds: 3600,
          sessionCookieSecure: false,
        },
      })

      const noMailAuth = createAuth(config, db)
      clearCapturedEmails()

      const res = await noMailAuth.handler(
        new Request('http://localhost:3000/auth/sign-up/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'No Mail',
            email: 'no-mail@auth-test.dev',
            password: 'Zk8$mN!qR2xFgWpJ',
          }),
        }),
      )

      expect(res.status).toBe(200)
      const emails = readCapturedEmails()
      expect(emails.length).toBe(0)
    })

    it('magic link endpoint not available without mail', async () => {
      const config = makeConfig({
        auth: {
          secret: 's'.repeat(64),
          url: 'http://localhost:3000',
          sessionTtlSeconds: 3600,
          sessionCookieSecure: false,
        },
      })

      const noMailAuth = createAuth(config, db)

      const res = await noMailAuth.handler(
        new Request('http://localhost:3000/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'no-mail-magic@auth-test.dev',
            callbackURL: '/',
          }),
        }),
      )

      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })
})

describe('validatePasswordStrength', () => {
  it('rejects "password"', () => {
    const result = validatePasswordStrength('password')
    expect(result.valid).toBe(false)
    expect(result.message).toContain('too common')
  })

  it('rejects "12345678"', () => {
    expect(validatePasswordStrength('12345678').valid).toBe(false)
  })

  it('rejects "qwerty123"', () => {
    expect(validatePasswordStrength('qwerty123').valid).toBe(false)
  })

  it('accepts strong passwords', () => {
    expect(validatePasswordStrength('Zk8$mN!qR2xFgWpJ').valid).toBe(true)
  })

  it('accepts passphrase-style passwords', () => {
    expect(validatePasswordStrength('correct-horse-battery-staple').valid).toBe(true)
  })
})
