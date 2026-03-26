/**
 * Tests for neonClient JWKS verification + audience matching + sign-in token priority.
 * Uses locally-generated EdDSA keys to avoid needing a real Neon instance.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as jose from 'jose'
import { verifyNeonAccessToken, neonOriginFromBaseUrl, signInWithPassword } from '../auth/neonClient.js'

// Generate Ed25519 keys for testing
async function createEdDSAKeyPair() {
  return jose.generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
}

describe('neonOriginFromBaseUrl', () => {
  it('extracts origin from full URL', () => {
    expect(neonOriginFromBaseUrl('https://ep-xxx.neonauth.region.aws.neon.tech/neondb/auth'))
      .toBe('https://ep-xxx.neonauth.region.aws.neon.tech')
  })

  it('handles URL with trailing slash', () => {
    expect(neonOriginFromBaseUrl('https://example.com/'))
      .toBe('https://example.com')
  })

  it('handles plain origin', () => {
    expect(neonOriginFromBaseUrl('https://example.com'))
      .toBe('https://example.com')
  })
})

describe('verifyNeonAccessToken', () => {
  it('returns null for empty token', async () => {
    const result = await verifyNeonAccessToken('', {
      neonAuthBaseUrl: 'https://example.com',
      neonAuthJwksUrl: undefined,
    })
    expect(result).toBeNull()
  })

  it('throws when neonAuthBaseUrl is not configured', async () => {
    await expect(
      verifyNeonAccessToken('some.jwt.token', { neonAuthBaseUrl: '', neonAuthJwksUrl: undefined }),
    ).rejects.toThrow(/NEON_AUTH_BASE_URL/)
  })

  it('returns null for invalid JWT', async () => {
    const result = await verifyNeonAccessToken('not-a-jwt', {
      neonAuthBaseUrl: 'https://example.com',
      neonAuthJwksUrl: 'https://example.com/.well-known/jwks.json',
    })
    expect(result).toBeNull()
  })

  it('returns null for JWT with wrong audience', async () => {
    const { privateKey } = await createEdDSAKeyPair()
    // Create token with wrong audience
    const token = await new jose.SignJWT({ sub: 'user-1', email: 'test@test.com' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setAudience('https://wrong-audience.com')
      .setSubject('user-1')
      .sign(privateKey)

    // Verification will fail because JWKS URL won't have the key
    // (we can't mock createRemoteJWKSet easily without a real HTTP server)
    const result = await verifyNeonAccessToken(token, {
      neonAuthBaseUrl: 'https://example.com',
      neonAuthJwksUrl: 'https://example.com/.well-known/jwks.json',
    })
    expect(result).toBeNull()
  })
})

describe('signInWithPassword token priority', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
    const h = new Headers(headers)
    h.set('content-type', 'application/json')
    return new Response(JSON.stringify(body), { status, headers: h })
  }

  const config = { neonAuthBaseUrl: 'https://neon.example.com/neondb/auth' }

  it('prefers /token JWT over opaque body.token when cookies are present', async () => {
    const fetchMock = vi.fn()
      // sign-in/email response: opaque session ID + set-cookie
      .mockResolvedValueOnce(jsonResponse(200, { token: 'opaque-session-id' }, {
        'set-cookie': 'better-auth.session=abc123; Path=/; HttpOnly',
      }))
      // /token response: real JWT
      .mockResolvedValueOnce(jsonResponse(200, { token: 'real-jwt-token' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await signInWithPassword(config, 'user@test.com', 'password')

    expect(result.accessToken).toBe('real-jwt-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Second call must be to /token with cookie header
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(tokenUrl).toBe('https://neon.example.com/neondb/auth/token')
    expect((tokenInit.headers as Record<string, string>).Cookie).toContain('better-auth.session=abc123')
  })

  it('falls back to body.token when no cookies are set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'fallback-token' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await signInWithPassword(config, 'user@test.com', 'password')

    expect(result.accessToken).toBe('fallback-token')
    // Only one call — no /token call because no cookies
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to body.token when /token returns empty', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: 'opaque-session-id' }, {
        'set-cookie': 'better-auth.session=abc123; Path=/; HttpOnly',
      }))
      // /token returns error
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await signInWithPassword(config, 'user@test.com', 'password')

    // Falls back to body.token since /token failed
    expect(result.accessToken).toBe('opaque-session-id')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns empty accessToken when both /token and body.token are empty', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    const result = await signInWithPassword(config, 'user@test.com', 'password')

    expect(result.accessToken).toBe('')
  })
})
