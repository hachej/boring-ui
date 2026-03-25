/**
 * Comprehensive workspace unit tests for bd-vbrp4.
 *
 * Tests workspace CRUD, membership, encrypted settings, and boundary routing.
 * Uses Fastify inject with session cookies for authenticated requests.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createSessionCookie, appCookieName } from '../auth/session.js'
import type { FastifyInstance } from 'fastify'

function testConfig(overrides = {}) {
  return { ...loadConfig(), ...overrides }
}

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001'
const TEST_EMAIL = 'test@example.com'
const TEST_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'

let app: FastifyInstance

afterEach(async () => {
  if (app) await app.close()
})

/** Create a valid session cookie for authenticated requests. */
async function makeSessionCookie(
  secret: string,
  userId = TEST_USER_ID,
  email = TEST_EMAIL,
): Promise<string> {
  const token = await createSessionCookie(userId, email, secret)
  return `${appCookieName()}=${token}`
}

// ---------------------------------------------------------------------------
// Workspace CRUD
// ---------------------------------------------------------------------------
describe('Workspace CRUD', () => {
  it('POST /workspaces creates workspace with valid session', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { name: 'My Project' },
      headers: { cookie },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.workspace).toBeDefined()
    expect(body.workspace.name).toBe('My Project')
    expect(body.workspace.created_by).toBe(TEST_USER_ID)
    // UUID format
    expect(body.workspace.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('POST /workspaces generates default name when not provided', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: {},
      headers: { cookie },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.workspace.name).toMatch(/^Workspace \d{4}-\d{2}-\d{2}/)
  })

  it('POST /workspaces rejects names > 100 chars', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { name: 'x'.repeat(101) },
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('WORKSPACE_NAME_TOO_LONG')
  })

  it('GET /workspaces lists workspaces for authenticated user', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.workspaces)).toBe(true)
  })

  it('PATCH /workspaces/:id validates UUID format', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workspaces/not-a-uuid',
      payload: { name: 'New Name' },
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('INVALID_WORKSPACE_ID')
  })

  it('PATCH /workspaces/:id requires name', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}`,
      payload: {},
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('NAME_REQUIRED')
  })

  it('DELETE /workspaces/:id with valid UUID', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.deleted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Auth enforcement
// ---------------------------------------------------------------------------
describe('Auth enforcement', () => {
  it('all workspace routes return 401 without session', async () => {
    app = createApp()
    const routes = [
      { method: 'GET' as const, url: '/api/v1/workspaces' },
      { method: 'POST' as const, url: '/api/v1/workspaces' },
      { method: 'GET' as const, url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/runtime` },
      { method: 'GET' as const, url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings` },
      { method: 'PUT' as const, url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings` },
      { method: 'PATCH' as const, url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}` },
      { method: 'DELETE' as const, url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}` },
    ]

    for (const route of routes) {
      const res = await app.inject(route)
      expect(res.statusCode).toBe(401)
    }
  })
})

// ---------------------------------------------------------------------------
// Encrypted settings
// ---------------------------------------------------------------------------
describe('Encrypted settings', () => {
  it('GET /workspaces/:id/settings returns settings', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.settings).toBeDefined()
  })

  it('PUT /workspaces/:id/settings validates request body', async () => {
    const config = testConfig({ settingsKey: 'test-key' })
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings`,
      payload: { github_token: 'ghp_test123' },
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
  })

  it('PUT /settings returns 500 when BORING_SETTINGS_KEY not configured', async () => {
    const config = testConfig({ settingsKey: undefined })
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings`,
      payload: { key: 'value' },
      headers: { cookie },
    })

    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('SETTINGS_KEY_NOT_CONFIGURED')
  })

  it('PUT /settings rejects > 50 keys', async () => {
    const config = testConfig({ settingsKey: 'test-key' })
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const tooManyKeys: Record<string, string> = {}
    for (let i = 0; i < 51; i++) {
      tooManyKeys[`key_${i}`] = 'value'
    }

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings`,
      payload: tooManyKeys,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('TOO_MANY_SETTINGS')
  })

  it('PUT /settings rejects key > 128 chars', async () => {
    const config = testConfig({ settingsKey: 'test-key' })
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/settings`,
      payload: { ['k'.repeat(129)]: 'value' },
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('INVALID_SETTING_KEY')
  })
})

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
describe('Workspace runtime', () => {
  it('GET /workspaces/:id/runtime returns runtime state', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/runtime`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.runtime).toBeDefined()
    expect(body.runtime.workspace_id).toBe(TEST_WORKSPACE_ID)
    expect(body.runtime.state).toBeDefined()
  })

  it('POST /workspaces/:id/runtime/retry retries provisioning', async () => {
    const config = testConfig()
    app = createApp({ config })
    const cookie = await makeSessionCookie(config.sessionSecret)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/runtime/retry`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.retried).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Boundary routing
// ---------------------------------------------------------------------------
describe('Workspace boundary routing', () => {
  it('/w/{uuid} serves SPA page', async () => {
    app = createApp()
    const res = await app.inject({
      method: 'GET',
      url: `/w/${TEST_WORKSPACE_ID}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('/w/{invalid-id}/* returns 400 for invalid UUID', async () => {
    app = createApp()
    const res = await app.inject({
      method: 'GET',
      url: '/w/not-a-uuid/api/v1/files/list',
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('INVALID_WORKSPACE_ID')
  })
})
