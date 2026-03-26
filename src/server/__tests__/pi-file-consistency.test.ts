/**
 * PI agent ↔ File API consistency & filesystem isolation tests.
 *
 * Verifies:
 * 1. File API and exec (short + long-running) operate on the exact same filesystem
 * 2. Agent exec is fully isolated — cannot escape the workspace root
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createSessionCookie } from '../auth/session.js'
import { hasBwrap } from '../workspace/helpers.js'
import type { FastifyInstance } from 'fastify'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'
const TEST_ROOT = join(tmpdir(), `pi-file-consist-${process.pid}-${Date.now()}`)
const WORKSPACE = join(TEST_ROOT, 'workspace')
const OUTSIDE = join(TEST_ROOT, 'outside')

let app: FastifyInstance
let token: string
let bwrapAvailable: boolean

beforeAll(async () => {
  mkdirSync(WORKSPACE, { recursive: true })
  mkdirSync(OUTSIDE, { recursive: true })
  writeFileSync(join(OUTSIDE, 'secret.txt'), 'TOP-SECRET-DATA')

  app = createApp({
    config: {
      ...loadConfig(),
      workspaceRoot: WORKSPACE,
      sessionSecret: TEST_SECRET,
    } as any,
    skipValidation: true,
  })

  token = await createSessionCookie('test-user', 'test@example.com', TEST_SECRET, {
    ttlSeconds: 3600,
  })

  bwrapAvailable = hasBwrap()
})

afterAll(async () => {
  if (app) await app.close()
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

/** Wait for a long-running job to finish and return joined output. */
async function waitForJob(jobId: string, maxMs = 5000): Promise<{ output: string; exit_code: number }> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exec/jobs/${jobId}`,
      cookies: { boring_session: token },
    })
    const body = JSON.parse(res.payload)
    if (body.done) {
      return { output: body.chunks.join(''), exit_code: body.exit_code }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Job ${jobId} did not finish within ${maxMs}ms`)
}

// ---------------------------------------------------------------------------
// 1. File API → Exec consistency (file API writes, exec reads)
// ---------------------------------------------------------------------------
describe('File API → Exec: same filesystem', () => {
  it('short exec sees files written by file API', async () => {
    // Write via file API
    const writeRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/files/write?path=from-api.txt',
      cookies: { boring_session: token },
      payload: { content: 'written-by-file-api' },
    })
    expect(writeRes.statusCode).toBe(200)

    // Read via short exec
    const execRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'cat from-api.txt' },
    })
    const body = JSON.parse(execRes.payload)
    expect(body.exit_code).toBe(0)
    expect(body.stdout).toContain('written-by-file-api')
  })

  it('long-running exec sees files written by file API', async () => {
    // Write via file API
    await app.inject({
      method: 'PUT',
      url: '/api/v1/files/write?path=for-long-exec.txt',
      cookies: { boring_session: token },
      payload: { content: 'long-exec-can-read-this' },
    })

    // Read via long-running exec
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'cat for-long-exec.txt' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output, exit_code } = await waitForJob(job_id)

    expect(exit_code).toBe(0)
    expect(output).toContain('long-exec-can-read-this')
  })
})

// ---------------------------------------------------------------------------
// 2. Exec → File API consistency (exec writes, file API reads)
// ---------------------------------------------------------------------------
describe('Exec → File API: same filesystem', () => {
  it('file API reads files written by short exec', async () => {
    // Write via short exec
    const execRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'printf "created-by-exec" > from-exec.txt' },
    })
    expect(JSON.parse(execRes.payload).exit_code).toBe(0)

    // Read via file API
    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/read?path=from-exec.txt',
      cookies: { boring_session: token },
    })
    expect(readRes.statusCode).toBe(200)
    expect(JSON.parse(readRes.payload).content).toBe('created-by-exec')
  })

  it('file API reads files written by long-running exec', async () => {
    // Write via long-running exec
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'printf "created-by-long-exec" > from-long-exec.txt' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { exit_code } = await waitForJob(job_id)
    expect(exit_code).toBe(0)

    // Read via file API
    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/read?path=from-long-exec.txt',
      cookies: { boring_session: token },
    })
    expect(readRes.statusCode).toBe(200)
    expect(JSON.parse(readRes.payload).content).toBe('created-by-long-exec')
  })

  it('file API lists files created by exec', async () => {
    // Create via exec
    await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'mkdir -p subdir && printf "nested" > subdir/nested.txt' },
    })

    // List via file API
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/list?path=subdir',
      cookies: { boring_session: token },
    })
    expect(listRes.statusCode).toBe(200)
    const entries = JSON.parse(listRes.payload).entries
    expect(entries.some((e: any) => e.name === 'nested.txt')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Cross-consistency: exec round-trips through both paths
// ---------------------------------------------------------------------------
describe('Round-trip consistency', () => {
  it('short exec write → long-running exec read → file API verify', async () => {
    // Step 1: short exec writes
    await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'printf "round-trip-data" > roundtrip.txt' },
    })

    // Step 2: long-running exec reads
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'cat roundtrip.txt' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output } = await waitForJob(job_id)
    expect(output).toContain('round-trip-data')

    // Step 3: file API confirms
    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/read?path=roundtrip.txt',
      cookies: { boring_session: token },
    })
    expect(JSON.parse(readRes.payload).content).toBe('round-trip-data')
  })
})

// ---------------------------------------------------------------------------
// 4. Filesystem isolation — agent cannot escape workspace
// ---------------------------------------------------------------------------
describe('Filesystem isolation', () => {
  // These tests assert hard isolation when bwrap is available.
  // Without bwrap, exec has no sandbox — skip isolation assertions.

  it('short exec cannot read files outside workspace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: `cat ${OUTSIDE}/secret.txt 2>&1` },
    })
    const body = JSON.parse(res.payload)

    if (bwrapAvailable) {
      expect(body.stdout).not.toContain('TOP-SECRET-DATA')
    }
    // Without bwrap, this is a known limitation — skip hard assertion
  })

  it('long-running exec cannot read files outside workspace', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: `cat ${OUTSIDE}/secret.txt 2>&1 || echo "BLOCKED"` },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output } = await waitForJob(job_id)

    if (bwrapAvailable) {
      expect(output).not.toContain('TOP-SECRET-DATA')
    }
  })

  it('short exec cannot list root filesystem directories', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'ls /app 2>&1 || echo "NO-ACCESS"' },
    })
    const body = JSON.parse(res.payload)

    if (bwrapAvailable) {
      // /app should not exist in the sandbox (only /workspace, system dirs)
      expect(body.stdout).toContain('No such file or directory')
    }
  })

  it('long-running exec cannot list root filesystem directories', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'ls /app 2>&1 || echo "NO-ACCESS"' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output } = await waitForJob(job_id)

    if (bwrapAvailable) {
      expect(output).toContain('No such file or directory')
    }
  })

  it('short exec cannot write outside workspace', async () => {
    const escapePath = join(OUTSIDE, 'escaped.txt')

    await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: `printf "escaped" > ${escapePath} 2>&1 || true` },
    })

    if (bwrapAvailable) {
      expect(existsSync(escapePath)).toBe(false)
    }
  })

  it('long-running exec cannot write outside workspace', async () => {
    const escapePath = join(OUTSIDE, 'escaped-long.txt')

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: `printf "escaped" > ${escapePath} 2>&1 || true` },
    })
    const { job_id } = JSON.parse(startRes.payload)
    await waitForJob(job_id)

    if (bwrapAvailable) {
      expect(existsSync(escapePath)).toBe(false)
    }
  })

  it('file API rejects path traversal to outside workspace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/read?path=../outside/secret.txt',
      cookies: { boring_session: token },
    })
    // Must be rejected regardless of bwrap
    expect(res.statusCode).toBe(400)
    expect(res.payload).not.toContain('TOP-SECRET-DATA')
  })

  it('short exec sees only workspace contents with pwd', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'pwd' },
    })
    const body = JSON.parse(res.payload)

    if (bwrapAvailable) {
      // Inside bwrap, cwd is /workspace
      expect(body.stdout.trim()).toBe('/workspace')
    } else {
      // Without bwrap, cwd is the actual workspace path
      expect(body.stdout.trim()).toBe(WORKSPACE)
    }
  })

  it('long-running exec sees only workspace contents with pwd', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'pwd' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output } = await waitForJob(job_id)

    if (bwrapAvailable) {
      expect(output.trim()).toBe('/workspace')
    } else {
      expect(output.trim()).toBe(WORKSPACE)
    }
  })

  it('exec cannot read /etc/shadow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'cat /etc/shadow 2>&1 || echo "BLOCKED"' },
    })
    const body = JSON.parse(res.payload)

    // Even outside bwrap, /etc/shadow requires root and should fail.
    // Inside bwrap, /etc is read-only bind so shadow is either missing or unreadable.
    expect(body.stdout).not.toMatch(/^root:/)
  })
})

// ---------------------------------------------------------------------------
// 5. Isolation parity: short exec and long-running exec see same sandbox
// ---------------------------------------------------------------------------
describe('Short ↔ long-running exec parity', () => {
  it('both exec paths see the same HOME', async () => {
    // Short exec
    const shortRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'echo $HOME' },
    })
    const shortHome = JSON.parse(shortRes.payload).stdout.trim()

    // Long-running exec
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'echo $HOME' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output } = await waitForJob(job_id)
    const longHome = output.trim()

    expect(shortHome).toBe(longHome)
  })

  it('both exec paths see the same filesystem root listing', async () => {
    // Short exec
    const shortRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec',
      cookies: { boring_session: token },
      payload: { command: 'ls / | sort' },
    })
    const shortLs = JSON.parse(shortRes.payload).stdout.trim()

    // Long-running exec
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exec/start',
      cookies: { boring_session: token },
      payload: { command: 'ls / | sort' },
    })
    const { job_id } = JSON.parse(startRes.payload)
    const { output } = await waitForJob(job_id)
    const longLs = output.trim()

    expect(shortLs).toBe(longLs)
  })
})
