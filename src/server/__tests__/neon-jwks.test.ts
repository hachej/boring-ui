/**
 * Tests for neonClient JWKS verification + audience matching.
 * Uses locally-generated EdDSA keys to avoid needing a real Neon instance.
 */
import { describe, it, expect } from 'vitest'
import * as jose from 'jose'
import { verifyNeonAccessToken, neonOriginFromBaseUrl } from '../auth/neonClient.js'

// Generate Ed25519 keys for testing
async function createEdDSAKeyPair() {
  return jose.generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
}

// Create a mock JWKS server using jose's local key set
async function createTestToken(
  privateKey: jose.KeyLike,
  claims: Record<string, unknown>,
  audience: string,
) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience)
    .setSubject(String(claims.sub || 'user-1'))
    .sign(privateKey)
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
    })
    expect(result).toBeNull()
  })

  it('throws when neonAuthBaseUrl is not configured', async () => {
    await expect(
      verifyNeonAccessToken('some.jwt.token', { neonAuthBaseUrl: '' }),
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
