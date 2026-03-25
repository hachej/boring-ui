import { createHmac } from 'node:crypto'
import * as jose from 'jose'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createSessionCookie,
  parseSessionCookie,
  appCookieName,
  COOKIE_NAME,
  SessionExpiredError,
  SessionInvalidError,
} from '../auth/session.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'

function encodeSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signPythonStyleSessionCookie(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' })
  const body = encodeSegment(payload)
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

function decodePythonStyleSessionCookie(
  token: string,
  secret: string,
): Record<string, unknown> {
  const [header, body, signature] = token.split('.')
  const expectedSignature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')

  expect(signature).toBe(expectedSignature)

  return JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
}

describe('auth/session', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('COOKIE_NAME', () => {
    it('is boring_session', () => {
      expect(COOKIE_NAME).toBe('boring_session')
    })
  })

  describe('appCookieName', () => {
    it('returns base name when no appId', () => {
      expect(appCookieName()).toBe('boring_session')
      expect(appCookieName(undefined)).toBe('boring_session')
    })

    it('returns scoped name with custom appId', () => {
      expect(appCookieName('custom')).toBe('boring_session_custom')
    })

    it('throws on invalid appId characters', () => {
      expect(() => appCookieName('../evil')).toThrow()
    })
  })

  describe('createSessionCookie', () => {
    it('creates a valid JWT', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
      })

      // JWT format: header.payload.signature
      expect(token.split('.').length).toBe(3)
    })

    it('includes required claims', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
      })

      // Decode payload (no verification)
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
      )
      expect(payload.sub).toBe('user-123')
      expect(payload.email).toBe('test@example.com')
      expect(payload.iat).toBeTypeOf('number')
      expect(payload.exp).toBeTypeOf('number')
      expect(payload.exp - payload.iat).toBe(3600)
    })

    it('creates tokens that remain compatible with Python-style HS256 decoding', async () => {
      const token = await createSessionCookie('user-456', 'Alice@Example.com', TEST_SECRET, {
        ttlSeconds: 86400,
        appId: 'boring-macro',
      })

      const payload = decodePythonStyleSessionCookie(token, TEST_SECRET)
      expect(payload).toMatchObject({
        sub: 'user-456',
        email: 'alice@example.com',
        app_id: 'boring-macro',
      })
      expect(payload.iat).toBeTypeOf('number')
      expect(payload.exp).toBeTypeOf('number')
      expect((payload.exp as number) - (payload.iat as number)).toBe(86400)
    })

    it('lowercases email', async () => {
      const token = await createSessionCookie('user-123', 'Test@EXAMPLE.com', TEST_SECRET, {
        ttlSeconds: 3600,
      })

      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
      )
      expect(payload.email).toBe('test@example.com')
    })

    it('includes app_id when provided', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
        appId: 'my-app',
      })

      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
      )
      expect(payload.app_id).toBe('my-app')
    })

    it('omits app_id when not provided', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
      })

      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
      )
      expect(payload.app_id).toBeUndefined()
    })
  })

  describe('parseSessionCookie', () => {
    it('parses a valid token', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
      })

      const session = await parseSessionCookie(token, TEST_SECRET)
      expect(session.user_id).toBe('user-123')
      expect(session.email).toBe('test@example.com')
      expect(session.exp).toBeTypeOf('number')
    })

    it('returns app_id when present', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
        appId: 'boring-ui',
      })

      const session = await parseSessionCookie(token, TEST_SECRET)
      expect(session.app_id).toBe('boring-ui')
    })

    it('parses Python-style session cookies created before cutover', async () => {
      const now = Math.floor(Date.now() / 1000)
      const token = signPythonStyleSessionCookie(
        {
          sub: 'user-789',
          email: 'legacy@example.com',
          iat: now - 5,
          exp: now + 3600,
          app_id: 'boring-ui',
        },
        TEST_SECRET,
      )

      const session = await parseSessionCookie(token, TEST_SECRET)
      expect(session).toEqual({
        user_id: 'user-789',
        email: 'legacy@example.com',
        exp: now + 3600,
        app_id: 'boring-ui',
      })
    })

    it('throws SessionExpiredError for expired tokens', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: -100, // Already expired
      })

      await expect(parseSessionCookie(token, TEST_SECRET)).rejects.toThrow(
        SessionExpiredError,
      )
    })

    it('throws SessionInvalidError for wrong secret', async () => {
      const token = await createSessionCookie('user-123', 'test@example.com', TEST_SECRET, {
        ttlSeconds: 3600,
      })

      await expect(
        parseSessionCookie(token, 'wrong-secret-that-is-also-long-enough'),
      ).rejects.toThrow(SessionInvalidError)
    })

    it('throws SessionInvalidError for empty token', async () => {
      await expect(parseSessionCookie('', TEST_SECRET)).rejects.toThrow(
        SessionInvalidError,
      )
    })

    it('throws SessionInvalidError for malformed token', async () => {
      await expect(
        parseSessionCookie('not.a.valid.jwt', TEST_SECRET),
      ).rejects.toThrow(SessionInvalidError)
    })

    it('accepts tokens with issued-at slightly in the future', async () => {
      const now = Math.floor(Date.now() / 1000)
      const token = signPythonStyleSessionCookie(
        {
          sub: 'user-123',
          email: 'test@example.com',
          iat: now + 20,
          exp: now + 3600,
        },
        TEST_SECRET,
      )

      const session = await parseSessionCookie(token, TEST_SECRET)
      expect(session.user_id).toBe('user-123')
      expect(session.email).toBe('test@example.com')
    })

    it('wraps non-Error verification failures', async () => {
      vi.spyOn(jose, 'jwtVerify').mockRejectedValueOnce('boom' as never)

      await expect(parseSessionCookie('header.payload.signature', TEST_SECRET)).rejects.toMatchObject(
        {
          name: 'SessionInvalidError',
          message: 'Invalid session token: boom',
        },
      )
    })

    it('roundtrips correctly', async () => {
      const token = await createSessionCookie('user-456', 'alice@example.com', TEST_SECRET, {
        ttlSeconds: 86400,
        appId: 'boring-macro',
      })

      const session = await parseSessionCookie(token, TEST_SECRET)
      expect(session.user_id).toBe('user-456')
      expect(session.email).toBe('alice@example.com')
      expect(session.app_id).toBe('boring-macro')
    })
  })
})
