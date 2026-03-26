import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { testSessionCookie, TEST_SECRET } from './helpers.js'
import type { FastifyInstance } from 'fastify'

const TEST_WORKSPACE = join(tmpdir(), `exec-test-${Date.now()}`)
const MAX_OUTPUT_BYTES = 512 * 1024
let app: FastifyInstance | undefined

beforeAll(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true })
  writeFileSync(join(TEST_WORKSPACE, 'hello.txt'), 'Hello from workspace')
  mkdirSync(join(TEST_WORKSPACE, 'nested'), { recursive: true })
})

afterAll(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true })
})

afterEach(async () => {
  if (app) {
    await app.close()
    app = undefined
  }
})

function getApp(overrides = {}) {
  const config = { ...loadConfig(), workspaceRoot: TEST_WORKSPACE, sessionSecret: TEST_SECRET }
  app = createApp({ config: { ...config, ...overrides }, skipValidation: true })
  return app
}

describe('POST /api/v1/exec', () => {
  it('runs echo and captures stdout', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'echo hello' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.stdout.trim()).toBe('hello')
    expect(body.exit_code).toBe(0)
  })

  it('captures stderr', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'echo error >&2' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.stderr.trim()).toBe('error')
  })

  it('returns non-zero exit code on failure', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'exit 42' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.exit_code).toBe(42)
  })

  it('rejects empty command', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects missing command', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects cwd path traversal', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'ls', cwd: '../../../etc' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('runs in the requested cwd when it exists', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'pwd', cwd: 'nested' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.stdout.trim()).toContain('/nested')
  })

  it('rejects missing cwd directories', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'pwd', cwd: 'missing-dir' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload)).toMatchObject({
      code: 'CWD_NOT_FOUND',
    })
  })

  it('runs commands through bash shell semantics by design', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'printf left && printf " right"' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.stdout).toBe('left right')
  })

  it('truncates large stdout payloads at 512KB', async () => {
    const app = getApp()
    const token = await testSessionCookie()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: "head -c 600000 /dev/zero | tr '\\0' 'x'" },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.stdout).toContain('[truncated: output exceeded 512KB]')
    expect(Buffer.byteLength(body.stdout)).toBeGreaterThan(MAX_OUTPUT_BYTES)
    expect(Buffer.byteLength(body.stdout)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + 128)
  })

  it('returns 401 without auth', async () => {
    const app = getApp()
    const res = await app.inject({
      method: 'POST', url: '/api/v1/exec',
      payload: { command: 'echo hello' },
    })
    expect(res.statusCode).toBe(401)
  })
})
