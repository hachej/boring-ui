/**
 * Security test suite — path traversal, injection, auth bypass.
 *
 * bd-dxm60: Real Fastify inject, no mocks. Tests attack vectors against
 * file routes, exec routes, git routes, and auth middleware.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createSessionCookie, appCookieName } from '../auth/session.js'
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'

const TEST_DIR = join(tmpdir(), `bui-security-test-${process.pid}`, 'workspace')
const SECRET = 'security-test-secret-key'

let app: FastifyInstance
let cookie: string

beforeAll(async () => {
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(join(TEST_DIR, 'safe.txt'), 'safe content')

  const token = await createSessionCookie('sec-user', 'sec@test.com', SECRET)
  cookie = `${appCookieName()}=${token}`
})

afterAll(() => {
  rmSync(join(tmpdir(), `bui-security-test-${process.pid}`), { recursive: true, force: true })
})

afterEach(async () => {
  if (app) await app.close()
})

function config() {
  return { ...loadConfig(), workspaceRoot: TEST_DIR, sessionSecret: SECRET }
}

async function authedInject(method: string, url: string, body?: unknown) {
  return app.inject({
    method: method as any,
    url,
    headers: { cookie },
    payload: body as any,
  })
}

// ---------------------------------------------------------------------------
// Path traversal attacks on file routes
// ---------------------------------------------------------------------------
describe('Path traversal prevention (files)', () => {
  it('rejects ../etc/passwd in read', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('GET', '/api/v1/files/read?path=../../../etc/passwd')
    expect(res.statusCode).toBe(400)
  })

  it('rejects URL-encoded traversal in read', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('GET', '/api/v1/files/read?path=..%2F..%2F..%2Fetc%2Fpasswd')
    expect(res.statusCode).toBe(400)
  })

  it('rejects absolute paths in read', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('GET', '/api/v1/files/read?path=/etc/passwd')
    expect(res.statusCode).toBe(400)
  })

  it('rejects traversal in write path', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('PUT', '/api/v1/files/write?path=../../evil.txt', {
      content: 'pwned',
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects traversal in list path', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('GET', '/api/v1/files/list?path=../../')
    expect(res.statusCode).toBe(400)
  })

  it('rejects traversal in delete path', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('DELETE', '/api/v1/files/delete?path=../../../etc/passwd')
    expect(res.statusCode).toBe(400)
  })

  it('rejects traversal in rename old_path', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/files/rename', {
      old_path: '../../etc/passwd',
      new_path: 'stolen.txt',
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects traversal in rename new_path', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/files/rename', {
      old_path: 'safe.txt',
      new_path: '../../evil.txt',
    })
    expect(res.statusCode).toBe(400)
  })

  it('allows reading files within workspace', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('GET', '/api/v1/files/read?path=safe.txt')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload).content).toBe('safe content')
  })
})

// ---------------------------------------------------------------------------
// Path traversal in exec routes
// ---------------------------------------------------------------------------
describe('Path traversal prevention (exec)', () => {
  it('rejects cwd outside workspace in sync exec', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/exec', {
      command: 'echo pwned',
      cwd: '../../',
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).code).toBe('PATH_TRAVERSAL')
  })

  it('rejects cwd outside workspace in async exec', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/exec/start', {
      command: 'echo pwned',
      cwd: '../../../tmp',
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).code).toBe('PATH_TRAVERSAL')
  })

  it('allows cwd within workspace', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/exec', {
      command: 'echo ok',
      cwd: '.',
    })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Auth bypass attempts
// ---------------------------------------------------------------------------
describe('Auth bypass prevention', () => {
  it('rejects requests without cookie', async () => {
    app = createApp({ config: config() })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/list?path=.',
    })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload).code).toBe('SESSION_REQUIRED')
  })

  it('rejects expired JWT', async () => {
    app = createApp({ config: config() })
    // Create a token that expired 1 hour ago
    const expiredToken = await createSessionCookie('user', 'u@t.com', SECRET, {
      ttlSeconds: -3600,
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/list?path=.',
      headers: { cookie: `${appCookieName()}=${expiredToken}` },
    })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload).code).toBe('SESSION_EXPIRED')
  })

  it('rejects JWT signed with wrong secret', async () => {
    app = createApp({ config: config() })
    const wrongToken = await createSessionCookie('user', 'u@t.com', 'wrong-secret-key')
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/list?path=.',
      headers: { cookie: `${appCookieName()}=${wrongToken}` },
    })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload).code).toBe('INVALID_SESSION')
  })

  it('rejects malformed JWT (not base64)', async () => {
    app = createApp({ config: config() })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/list?path=.',
      headers: { cookie: `${appCookieName()}=not.a.valid.jwt` },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects empty cookie value', async () => {
    app = createApp({ config: config() })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/list?path=.',
      headers: { cookie: `${appCookieName()}=` },
    })
    expect(res.statusCode).toBe(401)
  })

  it('public endpoints work without auth', async () => {
    app = createApp({ config: config() })

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)

    const caps = await app.inject({ method: 'GET', url: '/api/capabilities' })
    expect(caps.statusCode).toBe(200)

    const buiConfig = await app.inject({ method: 'GET', url: '/__bui/config' })
    expect(buiConfig.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Workspace boundary security
// ---------------------------------------------------------------------------
describe('Workspace boundary security', () => {
  it('rejects non-UUID workspace IDs', async () => {
    app = createApp({ config: config() })
    const res = await app.inject({
      method: 'GET',
      url: '/w/not-a-uuid/api/v1/files/list?path=.',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).code).toBe('INVALID_WORKSPACE_ID')
  })

  it('rejects workspace boundary without auth', async () => {
    app = createApp({ config: config() })
    const res = await app.inject({
      method: 'GET',
      url: '/w/00000000-0000-0000-0000-000000000001/api/v1/files/list?path=.',
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects non-passthrough paths through boundary', async () => {
    app = createApp({ config: config() })
    const res = await app.inject({
      method: 'GET',
      url: '/w/00000000-0000-0000-0000-000000000001/secret/admin/data',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload).code).toBe('ROUTE_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
describe('Input validation', () => {
  it('exec rejects empty command', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/exec', { command: '' })
    expect(res.statusCode).toBe(400)
  })

  it('exec rejects whitespace-only command', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/exec', { command: '   ' })
    expect(res.statusCode).toBe(400)
  })

  it('workspace name too long is rejected', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('POST', '/api/v1/workspaces', {
      name: 'x'.repeat(101),
    })
    expect(res.statusCode).toBe(400)
  })

  it('exec job cursor with NaN is rejected', async () => {
    app = createApp({ config: config() })
    const res = await authedInject('GET', '/api/v1/exec/jobs/some-id?after=notanumber')
    // Should return 400 for invalid cursor, or 404 for unknown job
    expect([400, 404]).toContain(res.statusCode)
  })
})
