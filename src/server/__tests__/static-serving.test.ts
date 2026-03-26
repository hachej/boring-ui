/**
 * TDD tests for bd-qvv02.6: Static file serving + SPA fallback.
 *
 * Tests use a temporary dist/ directory with test fixtures.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import type { FastifyInstance } from 'fastify'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_STATIC_DIR = join(tmpdir(), `bui-static-test-${process.pid}`)

function testConfig(overrides = {}) {
  return { ...loadConfig(), ...overrides }
}

// Create test fixtures
beforeAll(() => {
  mkdirSync(TEST_STATIC_DIR, { recursive: true })
  mkdirSync(join(TEST_STATIC_DIR, 'assets'), { recursive: true })
  writeFileSync(
    join(TEST_STATIC_DIR, 'index.html'),
    '<!DOCTYPE html><html><body>boring-ui</body></html>',
  )
  writeFileSync(
    join(TEST_STATIC_DIR, 'assets', 'main-abc123.js'),
    'console.log("app")',
  )
  writeFileSync(
    join(TEST_STATIC_DIR, 'assets', 'style-def456.css'),
    'body { color: red; }',
  )
  writeFileSync(
    join(TEST_STATIC_DIR, 'favicon.ico'),
    'fake-icon',
  )
})

afterAll(() => {
  rmSync(TEST_STATIC_DIR, { recursive: true, force: true })
})

let app: FastifyInstance

afterEach(async () => {
  if (app) await app.close()
})

// ---------------------------------------------------------------------------
// Static file serving (when BORING_UI_STATIC_DIR is set)
// ---------------------------------------------------------------------------
describe('Static file serving', () => {
  it('serves index.html at root /', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('boring-ui')
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('serves assets with correct content', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({
      method: 'GET',
      url: '/assets/main-abc123.js',
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('console.log')
  })

  it('serves CSS assets', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({
      method: 'GET',
      url: '/assets/style-def456.css',
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('color: red')
  })

  it('serves static files in root (favicon.ico)', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/favicon.ico' })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------
describe('SPA fallback', () => {
  it('serves index.html for unknown client-side routes', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    // Non-workspace, non-API path should get SPA fallback
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/overview',
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('boring-ui')
  })

  it('serves index.html for unrouted client paths', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    // Use a path that isn't a real route but is a frontend SPA page
    const res = await app.inject({ method: 'GET', url: '/settings/profile' })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('boring-ui')
  })

  it('does NOT intercept /api/* routes', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    // /api/capabilities should return JSON, not index.html
    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('features')
  })

  it('does NOT intercept /health', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ok')
  })

  it('does NOT intercept /__bui/config', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/__bui/config' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.app).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Cache headers
// ---------------------------------------------------------------------------
describe('Cache headers', () => {
  it('sets immutable cache for hashed assets', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({
      method: 'GET',
      url: '/assets/main-abc123.js',
    })
    const cacheControl = res.headers['cache-control'] as string
    expect(cacheControl).toContain('immutable')
    expect(cacheControl).toContain('max-age=31536000')
  })

  it('sets no-cache for index.html', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: '/' })
    const cacheControl = res.headers['cache-control'] as string
    expect(cacheControl).toContain('no-store')
  })

  it('sets no-cache for SPA fallback responses', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/overview',
    })
    const cacheControl = res.headers['cache-control'] as string
    expect(cacheControl).toContain('no-store')
  })
})

// ---------------------------------------------------------------------------
// Workspace asset rewrite
// ---------------------------------------------------------------------------
describe('Workspace asset rewrite', () => {
  it('rewrites /w/{id}/assets/* to /assets/*', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    // Use a valid UUID to avoid workspace boundary 400 validation
    const res = await app.inject({
      method: 'GET',
      url: '/w/00000000-0000-0000-0000-000000000001/assets/main-abc123.js',
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('console.log')
  })
})

// ---------------------------------------------------------------------------
// Workspace boundary serves real index.html (not placeholder)
// ---------------------------------------------------------------------------
describe('Workspace SPA pages serve real index.html', () => {
  const WS_ID = '00000000-0000-0000-0000-000000000001'

  it('serves real index.html at /w/{id} (workspace root)', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: `/w/${WS_ID}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.payload).toContain('boring-ui')
    expect(res.payload).not.toBe('<!DOCTYPE html><html><body>SPA</body></html>')
  })

  it('serves real index.html at /w/{id}/ (empty wildcard)', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: `/w/${WS_ID}/` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.payload).toContain('boring-ui')
  })

  it('serves real index.html at /w/{id}/setup', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: `/w/${WS_ID}/setup` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.payload).toContain('boring-ui')
  })

  it('sets no-cache headers on workspace SPA pages', async () => {
    const config = testConfig({ staticDir: TEST_STATIC_DIR })
    app = createApp({ config })
    const res = await app.inject({ method: 'GET', url: `/w/${WS_ID}` })
    const cc = res.headers['cache-control'] as string
    expect(cc).toContain('no-store')
  })
})

// ---------------------------------------------------------------------------
// No static dir (default behavior)
// ---------------------------------------------------------------------------
describe('Without static dir', () => {
  it('unknown routes return 404 when no static dir configured', async () => {
    app = createApp()
    const res = await app.inject({ method: 'GET', url: '/some/unknown/path' })
    expect(res.statusCode).toBe(404)
  })
})
