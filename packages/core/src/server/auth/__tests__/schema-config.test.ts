import { betterAuth } from 'better-auth'
import { describe, expect, it } from 'vitest'

describe('better-auth schema config', () => {
  it('builds a valid better-auth instance for CLI schema generation', async () => {
    process.env.BETTER_AUTH_SCHEMA_GEN = '1'

    const { auth, closeSchemaDb, schemaAuthConfig } = await import('../schema-config')

    expect(auth).toBeDefined()
    expect(() => betterAuth(schemaAuthConfig)).not.toThrow()
    expect(schemaAuthConfig.user?.fields?.emailVerified).toBe('email_verified')
    expect(schemaAuthConfig.session?.fields?.userAgent).toBe('user_agent')
    expect(schemaAuthConfig.account?.fields?.providerId).toBe('provider_id')
    expect(schemaAuthConfig.verification?.fields?.expiresAt).toBe('expires_at')

    await closeSchemaDb()
  })
})
