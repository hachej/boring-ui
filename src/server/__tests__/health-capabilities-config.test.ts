/**
 * TDD tests for bd-rwy92.6: Health + capabilities + config endpoints.
 *
 * Phase 1 scope: Python-compatible response shapes for smoke parity.
 * Abstract vocabulary (workspace.files etc.) is Phase 4 (bd-1wkce.1).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type ServerConfig } from '../config.js'
import type { FastifyInstance } from 'fastify'

/**
 * Build a valid test config with optional overrides.
 * Uses process.cwd() as workspace root to avoid simple-git errors.
 */
function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = loadConfig()
  return { ...base, ...overrides }
}

let app: FastifyInstance

afterEach(async () => {
  if (app) await app.close()
})

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ok')
  })

  it('includes workspace root path', async () => {
    const config = testConfig({ workspaceRoot: '/tmp' })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.payload)
    expect(body.workspace).toBe('/tmp')
  })

  it('includes enabled features map', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.payload)
    expect(body.features).toBeDefined()
    expect(typeof body.features).toBe('object')
    // Must include core feature keys (legacy names)
    expect(body.features).toHaveProperty('files')
    expect(body.features).toHaveProperty('git')
  })
})

// ---------------------------------------------------------------------------
// GET /healthz
// ---------------------------------------------------------------------------
describe('GET /healthz', () => {
  it('returns 200 with detailed checks', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ok')
    expect(body.checks).toBeDefined()
    expect(body.checks.api).toBe('ok')
  })

  it('includes a request_id', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    const body = JSON.parse(res.payload)
    expect(body.request_id).toBeDefined()
    expect(typeof body.request_id).toBe('string')
    expect(body.request_id.length).toBeGreaterThan(0)
  })

  it('includes workspace root', async () => {
    const config = testConfig({ workspaceRoot: '/tmp' })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    const body = JSON.parse(res.payload)
    expect(body.workspace).toBe('/tmp')
  })
})

// ---------------------------------------------------------------------------
// GET /api/capabilities — Python-compatible (legacy vocabulary)
// ---------------------------------------------------------------------------
describe('GET /api/capabilities (Python-compat)', () => {
  it('returns 200 with version and features', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.version).toBeDefined()
    expect(body.features).toBeDefined()
    expect(typeof body.features).toBe('object')
  })

  it('includes legacy feature names (files, git, pty, chat_claude_code)', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' })
    const body = JSON.parse(res.payload)
    // Core features must be present as keys
    expect(body.features).toHaveProperty('files')
    expect(body.features).toHaveProperty('git')
    // These are boolean values
    expect(typeof body.features.files).toBe('boolean')
    expect(typeof body.features.git).toBe('boolean')
  })

  it('includes exec, messaging, ui_state, control_plane features', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' })
    const body = JSON.parse(res.payload)
    expect(body.features).toHaveProperty('exec')
    expect(body.features).toHaveProperty('ui_state')
    expect(body.features).toHaveProperty('control_plane')
  })

  it('includes agents list and agent_mode', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' })
    const body = JSON.parse(res.payload)
    expect(body).toHaveProperty('agents')
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body).toHaveProperty('agent_mode')
    expect(typeof body.agent_mode).toBe('string')
  })

  it('includes routers array with name, prefix, enabled', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' })
    const body = JSON.parse(res.payload)
    expect(body.routers).toBeDefined()
    expect(Array.isArray(body.routers)).toBe(true)
    if (body.routers.length > 0) {
      const router = body.routers[0]
      expect(router).toHaveProperty('name')
      expect(router).toHaveProperty('prefix')
      expect(router).toHaveProperty('enabled')
    }
  })

  it('includes auth config when neon provider', async () => {
    const config = testConfig({
      controlPlaneProvider: 'neon',
      neonAuthBaseUrl: 'https://ep-test.neonauth.example.com',
      databaseUrl: 'postgresql://test',
      authEmailProvider: 'smtp',
      authAppName: 'Test App',
    })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' })
    const body = JSON.parse(res.payload)
    expect(body.auth).toBeDefined()
    expect(body.auth.provider).toBe('neon')
    expect(body.auth.neonAuthUrl).toBe('https://ep-test.neonauth.example.com')
    expect(body.auth.callbackUrl).toBe('/auth/callback')
  })
})

// ---------------------------------------------------------------------------
// GET /__bui/config — Runtime config for frontend boot
// ---------------------------------------------------------------------------
describe('GET /__bui/config', () => {
  it('returns 200 with app section', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/__bui/config' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.app).toBeDefined()
    expect(body.app.id).toBeDefined()
    expect(body.app.name).toBeDefined()
    expect(body.app.logo).toBeDefined()
  })

  it('returns frontend section with branding, data, agents, mode', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/__bui/config' })
    const body = JSON.parse(res.payload)
    expect(body.frontend).toBeDefined()
    expect(body.frontend.branding).toBeDefined()
    expect(body.frontend.data).toBeDefined()
    expect(body.frontend.data.backend).toBeDefined()
    expect(body.frontend.agents).toBeDefined()
    expect(body.frontend.agents.mode).toBeDefined()
    expect(body.frontend.mode).toBeDefined()
    expect(body.frontend.mode.profile).toBeDefined()
  })

  it('returns agents section with mode and available', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/__bui/config' })
    const body = JSON.parse(res.payload)
    expect(body.agents).toBeDefined()
    expect(body.agents.mode).toBeDefined()
    expect(Array.isArray(body.agents.available)).toBe(true)
  })

  it('reflects workspace backend from config', async () => {
    const config = testConfig({ workspaceBackend: 'bwrap' })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/__bui/config' })
    const body = JSON.parse(res.payload)
    // bwrap maps to 'http' for the frontend data backend
    expect(body.frontend.data.backend).toBe('http')
  })

  it('includes auth section when neon provider', async () => {
    const config = testConfig({
      controlPlaneProvider: 'neon',
      neonAuthBaseUrl: 'https://ep-test.neonauth.example.com',
      databaseUrl: 'postgresql://test',
      authAppName: 'Test App',
    })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/__bui/config' })
    const body = JSON.parse(res.payload)
    expect(body.auth).toBeDefined()
    expect(body.auth.provider).toBe('neon')
  })
})

// ---------------------------------------------------------------------------
// GET /api/config — Workspace configuration
// ---------------------------------------------------------------------------
describe('GET /api/config', () => {
  it('returns 200 with workspace_root', async () => {
    const config = testConfig({ workspaceRoot: '/tmp' })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.workspace_root).toBe('/tmp')
  })

  it('includes paths object', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    const body = JSON.parse(res.payload)
    expect(body.paths).toBeDefined()
    expect(body.paths.files).toBe('.')
  })

  it('includes pty_providers list', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    const body = JSON.parse(res.payload)
    expect(body.pty_providers).toBeDefined()
    expect(Array.isArray(body.pty_providers)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET /api/project — Project root
// ---------------------------------------------------------------------------
describe('GET /api/project', () => {
  it('returns 200 with root path', async () => {
    const config = testConfig({ workspaceRoot: '/tmp' })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/api/project' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.root).toBe('/tmp')
  })
})
