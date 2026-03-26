/**
 * Workspace runtime state in backend mode.
 *
 * Verifies that workspaces are created with 'ready' runtime state
 * when agentsMode === 'backend' (no Fly Machine provisioning needed).
 * Regression test for: setup page stuck at "Preparing your workspace".
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { testSessionCookie, TEST_SECRET } from './helpers.js'
import type { FastifyInstance } from 'fastify'

function testConfig(overrides = {}) {
  return { ...loadConfig(), sessionSecret: TEST_SECRET, ...overrides }
}

let app: FastifyInstance
let workspaceRoot: string

afterEach(async () => {
  if (app) await app.close()
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('Workspace runtime in backend mode', () => {
  it('creates workspace with runtime state "ready" when agentsMode is backend', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-ws-backend-'))
    const token = await testSessionCookie()

    app = createApp({
      config: testConfig({
        workspaceRoot,
        agentsMode: 'backend',
      }),
      skipValidation: true,
    })

    // Create workspace
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
      payload: { name: 'Backend Test Workspace' },
    })
    expect(createRes.statusCode).toBe(201)
    const { workspace } = JSON.parse(createRes.payload)
    expect(workspace.id).toBeDefined()

    // Check runtime state — should be "ready" immediately, not "pending"
    const runtimeRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspace.id}/runtime`,
      cookies: { boring_session: token },
    })
    expect(runtimeRes.statusCode).toBe(200)
    const { runtime } = JSON.parse(runtimeRes.payload)
    expect(runtime.state).toBe('ready')
    expect(runtime.status).toBe('ready')
  })

  it('creates workspace with runtime state "ready" in frontend mode too (TS backend has no provisioner)', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-ws-frontend-'))
    const token = await testSessionCookie()

    app = createApp({
      config: testConfig({
        workspaceRoot,
        agentsMode: 'frontend',
      }),
      skipValidation: true,
    })

    // Create workspace
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
      payload: { name: 'Frontend Test Workspace' },
    })
    expect(createRes.statusCode).toBe(201)
    const { workspace } = JSON.parse(createRes.payload)

    // The TS backend never provisions Fly Machines — runtime is always ready
    const runtimeRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspace.id}/runtime`,
      cookies: { boring_session: token },
    })
    expect(runtimeRes.statusCode).toBe(200)
    const { runtime } = JSON.parse(runtimeRes.payload)
    expect(runtime.state).toBe('ready')
  })

  it('setup page auto-advances when runtime is ready', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-ws-setup-'))
    const token = await testSessionCookie()

    app = createApp({
      config: testConfig({
        workspaceRoot,
        agentsMode: 'backend',
      }),
      skipValidation: true,
    })

    // Create workspace
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
      payload: { name: 'Setup Auto-advance' },
    })
    const { workspace } = JSON.parse(createRes.payload)

    // The frontend setup page polls this endpoint.
    // When runtime.state is "ready", the page auto-advances.
    // Verify the response shape matches what WorkspaceSetupPage expects.
    const runtimeRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspace.id}/runtime`,
      cookies: { boring_session: token },
    })
    const body = JSON.parse(runtimeRes.payload)

    // WorkspaceSetupPage extracts: setupPayload?.runtime || setupPayload?.data?.runtime || setupPayload
    // isRuntimeReady checks: status === 'ready' || 'running' || 'active'
    expect(body.ok).toBe(true)
    expect(body.runtime).toBeDefined()
    expect(body.runtime.state).toBe('ready')
    expect(body.runtime.workspace_id).toBe(workspace.id)
  })

  it('retry endpoint works for backend mode workspaces', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-ws-retry-'))
    const token = await testSessionCookie()

    app = createApp({
      config: testConfig({
        workspaceRoot,
        agentsMode: 'backend',
      }),
      skipValidation: true,
    })

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
      payload: { name: 'Retry Test' },
    })
    const { workspace } = JSON.parse(createRes.payload)

    // Retry should succeed (returns ready for local persistence)
    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspace.id}/runtime/retry`,
      cookies: { boring_session: token },
    })
    expect(retryRes.statusCode).toBe(200)
    const retryBody = JSON.parse(retryRes.payload)
    expect(retryBody.ok).toBe(true)
    expect(retryBody.runtime.state).toBe('ready')
  })
})
