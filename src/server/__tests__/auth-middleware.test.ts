import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { validateRedirectUrl, validateAuthConfig } from '../auth/validation.js'
import { loadConfig } from '../config.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'

describe('Auth middleware (via workspace routes)', () => {
  it('rejects requests without session cookie', async () => {
    const app = createApp({ config: { ...getTestConfig() } })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
    })
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('SESSION_REQUIRED')
    await app.close()
  })

  it('rejects expired session cookies', async () => {
    const token = await createSessionCookie(
      'user-123',
      'test@example.com',
      TEST_SECRET,
      { ttlSeconds: -100 },
    )

    const app = createApp({ config: { ...getTestConfig() } })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('accepts valid session cookies', async () => {
    const token = await createSessionCookie(
      'user-123',
      'test@example.com',
      TEST_SECRET,
      { ttlSeconds: 3600 },
    )

    const app = createApp({ config: { ...getTestConfig() } })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    await app.close()
  })
})

describe('validateRedirectUrl', () => {
  it('allows relative paths', () => {
    expect(validateRedirectUrl('/dashboard')).toBe('/dashboard')
    expect(validateRedirectUrl('/w/abc-123')).toBe('/w/abc-123')
  })

  it('rejects absolute URLs', () => {
    expect(validateRedirectUrl('https://evil.com')).toBe('/')
    expect(validateRedirectUrl('http://evil.com')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    expect(validateRedirectUrl('//evil.com')).toBe('/')
  })

  it('rejects javascript URLs', () => {
    expect(validateRedirectUrl('javascript:alert(1)')).toBe('/')
  })

  it('rejects backslash paths', () => {
    expect(validateRedirectUrl('\\\\evil.com')).toBe('/')
  })

  it('uses fallback for empty/null', () => {
    expect(validateRedirectUrl('')).toBe('/')
    expect(validateRedirectUrl(null)).toBe('/')
    expect(validateRedirectUrl(undefined)).toBe('/')
  })

  it('uses custom fallback', () => {
    expect(validateRedirectUrl('', '/home')).toBe('/home')
  })
})

describe('validateAuthConfig', () => {
  it('passes for local provider', () => {
    expect(() =>
      validateAuthConfig({
        controlPlaneProvider: 'local',
        sessionSecret: 'test-secret',
      }),
    ).not.toThrow()
  })

  it('passes for neon with all required fields', () => {
    expect(() =>
      validateAuthConfig({
        controlPlaneProvider: 'neon',
        neonAuthBaseUrl: 'https://neon.example.com',
        sessionSecret: 'test-secret',
      }),
    ).not.toThrow()
  })

  it('throws for neon without NEON_AUTH_BASE_URL', () => {
    expect(() =>
      validateAuthConfig({
        controlPlaneProvider: 'neon',
        sessionSecret: 'test-secret',
      }),
    ).toThrow(/NEON_AUTH_BASE_URL/)
  })

  it('throws without session secret', () => {
    expect(() =>
      validateAuthConfig({
        controlPlaneProvider: 'local',
      }),
    ).toThrow(/session secret/i)
  })
})

// Helper to create test config
function getTestConfig() {
  const config = loadConfig()
  return {
    ...config,
    sessionSecret: TEST_SECRET,
  }
}
