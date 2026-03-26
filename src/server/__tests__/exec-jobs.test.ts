/**
 * TDD tests for bd-qvv02.5: Exec service long-running jobs.
 *
 * Tests the job lifecycle: start → read → cancel, and SSE streaming.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { testSessionCookie, TEST_SECRET } from './helpers.js'
import type { FastifyInstance } from 'fastify'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'

function testConfig(overrides = {}) {
  return { ...loadConfig(), sessionSecret: TEST_SECRET, ...overrides }
}

let app: FastifyInstance
let token: string

afterEach(async () => {
  if (app) await app.close()
})

// ---------------------------------------------------------------------------
// POST /api/v1/exec/start — Start a long-running job
// ---------------------------------------------------------------------------
describe('POST /api/v1/exec/start', () => {
  it('starts a job and returns jobId', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'echo "hello"' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.job_id).toBeDefined()
    expect(typeof body.job_id).toBe('string')
    expect(body.job_id.length).toBeGreaterThan(0)
  })

  it('rejects missing command', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('COMMAND_REQUIRED')
  })

  it('accepts optional cwd', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'ls', cwd: '.' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.job_id).toBeDefined()
  })

  it('rejects missing cwd directories', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'pwd', cwd: 'missing-dir' },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('CWD_NOT_FOUND')
  })

  it('uses the workspace-scoped root when x-workspace-id is present', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-exec-job-workspace-'))
    token = await testSessionCookie()
    app = createApp({ config: testConfig({ workspaceRoot }), skipValidation: true })

    const startRes = await app.inject({
      cookies: { boring_session: token },
      headers: { 'x-workspace-id': WORKSPACE_ID },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'printf async-boundary > async.txt' },
    })
    expect(startRes.statusCode).toBe(200)
    const { job_id } = JSON.parse(startRes.payload)

    let jobData: any
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      const readRes = await app.inject({
        cookies: { boring_session: token },
        method: 'GET',
        url: `/api/v1/exec/jobs/${job_id}`,
      })
      jobData = JSON.parse(readRes.payload)
      if (jobData.done) break
    }

    expect(jobData.done).toBe(true)
    const workspaceDir = join(workspaceRoot, WORKSPACE_ID)
    expect(existsSync(join(workspaceDir, 'async.txt'))).toBe(true)
    expect(readFileSync(join(workspaceDir, 'async.txt'), 'utf-8')).toBe('async-boundary')
    expect(existsSync(join(workspaceRoot, 'async.txt'))).toBe(false)

    rmSync(workspaceRoot, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/exec/jobs/:jobId — Read job output
// ---------------------------------------------------------------------------
describe('GET /api/v1/exec/jobs/:jobId', () => {
  it('reads output from a started job', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })

    // Start a job
    const startRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'echo "test output"' },
    })
    const { job_id } = JSON.parse(startRes.payload)

    // Wait a bit for command to complete
    await new Promise((r) => setTimeout(r, 500))

    // Read output
    const readRes = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: `/api/v1/exec/jobs/${job_id}`,
    })

    expect(readRes.statusCode).toBe(200)
    const body = JSON.parse(readRes.payload)
    expect(body.job_id).toBe(job_id)
    expect(body.chunks).toBeDefined()
    expect(Array.isArray(body.chunks)).toBe(true)
    expect(typeof body.done).toBe('boolean')
  })

  it('returns 404 for unknown job ID', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: '/api/v1/exec/jobs/nonexistent-id',
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('JOB_NOT_FOUND')
  })

  it('supports cursor-based reading', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })

    // Start a job
    const startRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'echo "line1" && echo "line2"' },
    })
    const { job_id } = JSON.parse(startRes.payload)

    await new Promise((r) => setTimeout(r, 500))

    // First read
    const read1 = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: `/api/v1/exec/jobs/${job_id}`,
    })
    const body1 = JSON.parse(read1.payload)
    expect(body1.cursor).toBeDefined()

    // Second read with cursor — should return no new chunks
    const read2 = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: `/api/v1/exec/jobs/${job_id}?after=${body1.cursor}`,
    })
    const body2 = JSON.parse(read2.payload)
    expect(body2.chunks.length).toBe(0)
  })

  it('rejects negative cursor values', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: '/api/v1/exec/jobs/nonexistent-id?after=-1',
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('INVALID_CURSOR')
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/exec/jobs/:jobId/cancel — Cancel a job
// ---------------------------------------------------------------------------
describe('POST /api/v1/exec/jobs/:jobId/cancel', () => {
  it('cancels a running job', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })

    // Start a long-running job
    const startRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'sleep 30' },
    })
    const { job_id } = JSON.parse(startRes.payload)

    // Cancel it
    const cancelRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: `/api/v1/exec/jobs/${job_id}/cancel`,
    })

    expect(cancelRes.statusCode).toBe(200)
    const body = JSON.parse(cancelRes.payload)
    expect(body.cancelled).toBe(true)
  })

  it('returns 404 for unknown job ID', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })
    const res = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/jobs/nonexistent/cancel',
    })

    expect(res.statusCode).toBe(404)
  })

  it('treats cancelling a completed job as a success no-op', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })

    const startRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'echo "done"' },
    })
    const { job_id } = JSON.parse(startRes.payload)

    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      const readRes = await app.inject({
        cookies: { boring_session: token },
        method: 'GET',
        url: `/api/v1/exec/jobs/${job_id}`,
      })
      if (JSON.parse(readRes.payload).done) break
    }

    const cancelRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: `/api/v1/exec/jobs/${job_id}/cancel`,
    })

    expect(cancelRes.statusCode).toBe(200)
    expect(JSON.parse(cancelRes.payload)).toMatchObject({
      cancelled: true,
      job_id,
    })
  })
})

// ---------------------------------------------------------------------------
// Job state transitions
// ---------------------------------------------------------------------------
describe('Job lifecycle', () => {
  it('completed job has done=true and exit_code', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })

    const startRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'echo "done"' },
    })
    const { job_id } = JSON.parse(startRes.payload)

    // Wait for completion
    await new Promise((r) => setTimeout(r, 1000))

    const readRes = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: `/api/v1/exec/jobs/${job_id}`,
    })
    const body = JSON.parse(readRes.payload)
    expect(body.done).toBe(true)
    expect(typeof body.exit_code).toBe('number')
  })

  it('failed command has non-zero exit_code', async () => {
    token = await testSessionCookie(); app = createApp({ config: testConfig(), skipValidation: true })

    const startRes = await app.inject({
      cookies: { boring_session: token },
      method: 'POST',
      url: '/api/v1/exec/start',
      payload: { command: 'exit 42' },
    })
    const { job_id } = JSON.parse(startRes.payload)

    await new Promise((r) => setTimeout(r, 1000))

    const readRes = await app.inject({
      cookies: { boring_session: token },
      method: 'GET',
      url: `/api/v1/exec/jobs/${job_id}`,
    })
    const body = JSON.parse(readRes.payload)
    expect(body.done).toBe(true)
    expect(body.exit_code).toBe(42)
  })
})
