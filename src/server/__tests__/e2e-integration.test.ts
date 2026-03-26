/**
 * Comprehensive E2E integration test — exercises the full critical user workflow.
 *
 * bd-6c9z2: 30 sequential steps, real Fastify inject, no mocks.
 * Each step logs structured data (step name, timing, status, request/response).
 *
 * Flow: health → capabilities → config → auth → workspace → files →
 *       git → exec → settings → ui_state → cleanup → logout
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createSessionCookie, appCookieName } from '../auth/session.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'

// --- Setup ---
const TEST_DIR = join(tmpdir(), `bui-e2e-${process.pid}`, 'workspace')
const SECRET = 'e2e-test-secret-key-for-jwt'
const APP_ID = 'boring-ui'

let app: FastifyInstance
let cookie: string
let workspaceId: string

interface StepLog {
  step: number
  name: string
  method: string
  url: string
  status: number
  ok: boolean
  ms: number
  body?: unknown
}

const log: StepLog[] = []
let stepNum = 0

async function step(
  name: string,
  method: string,
  url: string,
  opts?: { body?: unknown; expectStatus?: number | number[]; headers?: Record<string, string> },
) {
  stepNum++
  const start = performance.now()
  const expected = opts?.expectStatus
    ? Array.isArray(opts.expectStatus) ? opts.expectStatus : [opts.expectStatus]
    : [200, 201, 302]

  const res = await app.inject({
    method: method as any,
    url,
    headers: { cookie, ...(opts?.headers || {}) },
    payload: opts?.body as any,
  })

  const ms = Math.round((performance.now() - start) * 10) / 10
  const ok = expected.includes(res.statusCode)
  let body: unknown
  try { body = JSON.parse(res.payload) } catch { body = res.payload.slice(0, 200) }

  log.push({ step: stepNum, name, method, url, status: res.statusCode, ok, ms, body })

  if (!ok) {
    console.error(`[E2E] FAIL step ${stepNum}: ${name} — expected ${expected}, got ${res.statusCode}`)
    console.error(`  Body: ${res.payload.slice(0, 300)}`)
  }

  expect(res.statusCode, `Step ${stepNum} "${name}": expected ${expected}`).toSatisfy(
    (s: number) => expected.includes(s),
  )

  return { res, body: body as any, statusCode: res.statusCode }
}

beforeAll(async () => {
  mkdirSync(TEST_DIR, { recursive: true })
  const config = {
    ...loadConfig(),
    workspaceRoot: TEST_DIR,
    sessionSecret: SECRET,
    controlPlaneProvider: 'local' as const,
    controlPlaneAppId: APP_ID,
    settingsKey: 'test-settings-key',
  }
  app = createApp({ config })

  // Create auth cookie
  const token = await createSessionCookie('e2e-user', 'e2e@test.com', SECRET, {
    appId: APP_ID,
  })
  cookie = `${config.authSessionCookieName || appCookieName()}=${token}`
})

afterAll(async () => {
  if (app) await app.close()
  rmSync(join(tmpdir(), `bui-e2e-${process.pid}`), { recursive: true, force: true })

  // Print structured report
  const passed = log.filter((s) => s.ok).length
  const failed = log.filter((s) => !s.ok).length
  console.log(`\n[E2E] REPORT: ${passed} passed, ${failed} failed, ${log.length} total`)
  console.log(JSON.stringify({ passed, failed, total: log.length, steps: log }, null, 2))
})

// ---------------------------------------------------------------------------
// The full E2E flow — sequential, each step depends on the previous
// ---------------------------------------------------------------------------
describe('E2E: Full user workflow', () => {
  // --- Phase 1: Boot endpoints (no auth needed) ---

  it('01. Health check', async () => {
    const { body } = await step('health', 'GET', '/health')
    expect(body.status).toBe('ok')
    expect(body.features).toBeDefined()
    expect(body.workspace).toBe(TEST_DIR)
  })

  it('02. Capabilities', async () => {
    const { body } = await step('capabilities', 'GET', '/api/capabilities')
    expect(body.version).toBe('0.1.0')
    expect(body.features.files).toBe(true)
    expect(body.features.git).toBe(true)
    expect(body.routers.length).toBeGreaterThan(0)
  })

  it('03. Runtime config', async () => {
    const { body } = await step('bui-config', 'GET', '/__bui/config')
    expect(body.app.id).toBe(APP_ID)
    expect(body.frontend.data.backend).toBeDefined()
  })

  it('04. API config', async () => {
    const { body } = await step('api-config', 'GET', '/api/config')
    expect(body.workspace_root).toBe(TEST_DIR)
    expect(body.paths.files).toBe('.')
  })

  it('05. Project root', async () => {
    const { body } = await step('project', 'GET', '/api/project')
    expect(body.root).toBe(TEST_DIR)
  })

  // --- Phase 2: Auth ---

  it('06. Dev login', async () => {
    await step('dev-login', 'GET', '/auth/login?user_id=e2e-user&email=e2e@test.com', {
      expectStatus: 302,
    })
  })

  it('07. Session check', async () => {
    const { body } = await step('session-check', 'GET', '/auth/session')
    expect(body.authenticated).toBe(true)
    expect(body.user_id).toBe('e2e-user')
  })

  // --- Phase 3: Workspace ---

  it('08. Create workspace', async () => {
    const { body } = await step('create-workspace', 'POST', '/api/v1/workspaces', {
      body: { name: 'E2E Test Workspace' },
      expectStatus: 201,
    })
    expect(body.ok).toBe(true)
    workspaceId = body.workspace.id
    expect(workspaceId).toBeDefined()
  })

  it('09. List workspaces', async () => {
    const { body } = await step('list-workspaces', 'GET', '/api/v1/workspaces')
    expect(body.ok).toBe(true)
    const ids = body.workspaces.map((w: any) => w.id || w.workspace_id)
    expect(ids).toContain(workspaceId)
  })

  // --- Phase 4: Files ---

  it('10. Write file', async () => {
    const { body } = await step('write-file', 'PUT', '/api/v1/files/write?path=hello.txt', {
      body: { content: 'Hello from E2E test!' },
    })
    expect(body.success).toBe(true)
  })

  it('11. Read file', async () => {
    const { body } = await step('read-file', 'GET', '/api/v1/files/read?path=hello.txt')
    expect(body.content).toBe('Hello from E2E test!')
  })

  it('12. List directory', async () => {
    const { body } = await step('list-dir', 'GET', '/api/v1/files/list?path=.')
    expect(body.entries.some((e: any) => e.name === 'hello.txt')).toBe(true)
  })

  it('13. Rename file', async () => {
    const { body } = await step('rename-file', 'POST', '/api/v1/files/rename', {
      body: { old_path: 'hello.txt', new_path: 'renamed.txt' },
    })
    expect(body.success).toBe(true)
  })

  it('14. Verify rename', async () => {
    const { body } = await step('verify-rename', 'GET', '/api/v1/files/read?path=renamed.txt')
    expect(body.content).toBe('Hello from E2E test!')
  })

  it('15. Delete file', async () => {
    const { body } = await step('delete-file', 'DELETE', '/api/v1/files/delete?path=renamed.txt')
    expect(body.success).toBe(true)
  })

  it('16. Verify delete', async () => {
    await step('verify-delete', 'GET', '/api/v1/files/read?path=renamed.txt', {
      expectStatus: 404,
    })
  })

  // --- Phase 5: Git ---

  it('17. Git init', async () => {
    const { body } = await step('git-init', 'POST', '/api/v1/git/init')
    expect(body.initialized).toBe(true)
  })

  it('18. Write + git add + commit', async () => {
    await step('write-for-git', 'PUT', '/api/v1/files/write?path=tracked.txt', {
      body: { content: 'tracked file' },
    })
    await step('git-add', 'POST', '/api/v1/git/add', {
      body: { paths: ['tracked.txt'] },
    })
    await step('git-commit', 'POST', '/api/v1/git/commit', {
      body: { message: 'E2E commit', author_name: 'E2E Bot', author_email: 'e2e@test.com' },
    })
  })

  it('19. Git status (clean)', async () => {
    const { body } = await step('git-status', 'GET', '/api/v1/git/status')
    expect(body.is_repo).toBe(true)
  })

  // --- Phase 6: Exec ---

  it('20. Sync exec', async () => {
    const { body } = await step('exec-sync', 'POST', '/api/v1/exec', {
      body: { command: 'echo "E2E exec test"' },
    })
    expect(body.stdout).toContain('E2E exec test')
    expect(body.exit_code).toBe(0)
  })

  it('21. Async exec (start + read)', async () => {
    const { body: startBody } = await step('exec-start', 'POST', '/api/v1/exec/start', {
      body: { command: 'echo "async output"' },
    })
    expect(startBody.job_id).toBeDefined()

    // Wait for completion
    await new Promise((r) => setTimeout(r, 500))

    const { body: readBody } = await step('exec-read', 'GET', `/api/v1/exec/jobs/${startBody.job_id}`)
    expect(readBody.done).toBe(true)
    expect(readBody.chunks.join('')).toContain('async output')
  })

  // --- Phase 7: Settings ---

  it('22. Update user settings', async () => {
    const { body } = await step('put-user-settings', 'PUT', '/api/v1/me/settings', {
      body: { display_name: 'E2E User', theme: 'dark' },
    })
    expect(body.ok).toBe(true)
  })

  it('23. Read user settings', async () => {
    const { body } = await step('get-user-settings', 'GET', '/api/v1/me/settings')
    expect(body.display_name).toBe('E2E User')
    expect(body.settings.theme).toBe('dark')
  })

  it('24. Get user identity', async () => {
    const { body } = await step('get-me', 'GET', '/api/v1/me')
    expect(body.user.display_name).toBe('E2E User')
    expect(body.user.email).toBe('e2e@test.com')
  })

  it('25. Workspace settings', async () => {
    await step('put-ws-settings', 'PUT', `/api/v1/workspaces/${workspaceId}/settings`, {
      body: { api_key: 'test-key-123' },
    })
    const { body } = await step('get-ws-settings', 'GET', `/api/v1/workspaces/${workspaceId}/settings`)
    expect(body.settings.api_key).toBe('test-key-123')
  })

  // --- Phase 8: UI State ---

  it('26. Save UI state', async () => {
    await step('put-ui-state', 'PUT', '/api/v1/ui/state', {
      body: {
        client_id: 'e2e-client',
        active_panel_id: 'editor',
        open_panels: [{ id: 'filetree' }, { id: 'editor' }],
      },
    })
  })

  it('27. Read UI state', async () => {
    const { body } = await step('get-ui-state', 'GET', '/api/v1/ui/state/e2e-client')
    expect(body.state).toBeDefined()
    expect(body.state.client_id).toBe('e2e-client')
  })

  // --- Phase 9: Cleanup ---

  it('28. Workspace rename', async () => {
    const { body } = await step('rename-workspace', 'PATCH', `/api/v1/workspaces/${workspaceId}`, {
      body: { name: 'E2E Renamed' },
    })
    expect(body.ok).toBe(true)
  })

  it('29. Workspace delete', async () => {
    const { body } = await step('delete-workspace', 'DELETE', `/api/v1/workspaces/${workspaceId}`)
    expect(body.ok).toBe(true)
  })

  it('30. Logout', async () => {
    await step('logout', 'GET', '/auth/logout', { expectStatus: 302 })
  })
})
