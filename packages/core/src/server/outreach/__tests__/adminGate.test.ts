import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerOutreachRoutes } from '../routes.js'
import { registerErrorHandler } from '../../app/errorHandler.js'
import { ERROR_CODES } from '../../../shared/errors.js'
import type { CoreConfig } from '../../../shared/types.js'

// The outreach admin gate must require a verified email whenever email
// verification is enabled, so the claimed-lead authHook exemption (which only
// unlocks workspace access) can never reach admin routes unverified. The gate
// runs before body parsing, so an empty payload reaching `400 validation_failed`
// proves the request passed the admin gate.

const ADMIN_EMAIL = 'gate-admin@example.test'

function makeConfig(mailEnabled: boolean): CoreConfig {
  return {
    appId: 'gate-app',
    port: 0,
    host: '127.0.0.1',
    logLevel: 'error',
    encryption: { workspaceSettingsKey: 'b'.repeat(64) },
    auth: {
      secret: 'o'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
      ...(mailEnabled ? { mail: { from: 'no@reply.test', transportUrl: 'console://' } } : {}),
    },
    features: {
      githubOauth: false,
      googleOauth: false,
      invitesEnabled: true,
      sendWelcomeEmail: false,
      inviteTtlDays: 7,
    },
  } as unknown as CoreConfig
}

async function buildApp(
  mailEnabled: boolean,
  user: { email: string; emailVerified: boolean; isAnonymousLead?: boolean } | null,
): Promise<FastifyInstance> {
  process.env.BORING_OUTREACH_ADMIN_EMAILS = ADMIN_EMAIL
  const app = Fastify({ logger: false })
  app.decorate('config', makeConfig(mailEnabled))
  app.decorate('addRedactionPaths', () => {})
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    request.user = user ? { id: 'u1', name: null, ...user } : null
  })
  await app.register(registerOutreachRoutes, {
    db: {} as never,
    workspaceStore: {} as never,
    creditGrantStore: {} as never,
  })
  await app.ready()
  return app
}

describe('outreach admin gate', () => {
  let app: FastifyInstance
  const restore = process.env.BORING_OUTREACH_ADMIN_EMAILS

  afterEach(async () => {
    await app?.close()
    process.env.BORING_OUTREACH_ADMIN_EMAILS = restore
  })

  it('rejects an unverified allowlisted user when verification is enabled', async () => {
    app = await buildApp(true, { email: ADMIN_EMAIL, emailVerified: false })
    const res = await app.inject({ method: 'POST', url: '/api/v1/outreach/experiences', payload: {} })
    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.code).toBe(ERROR_CODES.FORBIDDEN)
    expect(body.message).toBe('Outreach administration requires a verified email')
  })

  it('lets a verified allowlisted user past the gate when verification is enabled', async () => {
    app = await buildApp(true, { email: ADMIN_EMAIL, emailVerified: true })
    const res = await app.inject({ method: 'POST', url: '/api/v1/outreach/experiences', payload: {} })
    // Past the admin gate → fails on body validation, not authorization.
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe(ERROR_CODES.VALIDATION_FAILED)
  })

  it('does not require a verified email when verification is disabled', async () => {
    app = await buildApp(false, { email: ADMIN_EMAIL, emailVerified: false })
    const res = await app.inject({ method: 'POST', url: '/api/v1/outreach/experiences', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe(ERROR_CODES.VALIDATION_FAILED)
  })
})
