import { mkdtempSync, existsSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { loadConfig } from '../config.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'

function getApp(overrides = {}) {
  return createApp({ config: { ...loadConfig(), sessionSecret: TEST_SECRET, ...overrides } as any })
}

async function getToken() {
  return createSessionCookie('user-123', 'alice@example.com', TEST_SECRET, { ttlSeconds: 3600 })
}

describe('Workspace boundary routing', () => {
  it('rejects invalid workspace ID', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: '/w/not-a-uuid/api/v1/files/list',
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 401 without session cookie', async () => {
    const app = getApp()
    const res = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_ID}/api/v1/files/list`,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 401 with expired session cookie', async () => {
    const app = getApp()
    const expiredToken = await createSessionCookie(
      'user-123',
      'alice@example.com',
      TEST_SECRET,
      { ttlSeconds: -120 },
    )
    const res = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_ID}/api/v1/files/list`,
      cookies: { boring_session: expiredToken },
    })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.payload)).toMatchObject({
      code: 'SESSION_EXPIRED',
    })
    await app.close()
  })

  it('rejects non-passthrough paths', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_ID}/admin/secret`,
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('redirects allowed paths to actual routes', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-boundary-files-'))
    const workspaceDir = join(workspaceRoot, WORKSPACE_ID)
    mkdirSync(workspaceDir, { recursive: true })
    const app = getApp({ workspaceRoot })
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_ID}/api/v1/files/list?path=.`,
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toMatchObject({
      path: '.',
    })
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('proxies agent routes through the workspace boundary', async () => {
    const app = getApp({
      workspaceBackend: 'bwrap',
      agentPlacement: 'server',
      agentRuntime: 'ai-sdk',
      databaseUrl: 'postgres://test',
      controlPlaneProvider: 'local',
    })
    const token = await getToken()
    const res = await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_ID}/api/v1/agent/chat`,
      cookies: { boring_session: token },
      payload: { messages: [] },
    })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.payload)).toMatchObject({
      code: 'ANTHROPIC_API_KEY_REQUIRED',
    })
    await app.close()
  })

  it('preserves POST bodies when proxying workspace routes', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_ID}/api/v1/workspaces`,
      cookies: { boring_session: token },
      payload: { name: 'Boundary Body Workspace' },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.payload)).toMatchObject({
      ok: true,
      workspace: {
        name: 'Boundary Body Workspace',
      },
    })
    await app.close()
  })

  it('materializes the workspace directory on first boundary file write after workspace creation', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-boundary-create-'))
    const app = getApp({ workspaceRoot })
    const token = await getToken()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      cookies: { boring_session: token },
      payload: { name: 'Boundary Created Workspace' },
    })
    expect(createRes.statusCode).toBe(201)
    const createdWorkspaceId = JSON.parse(createRes.payload).workspace.id as string

    const writeRes = await app.inject({
      method: 'PUT',
      url: `/w/${createdWorkspaceId}/api/v1/files/write?path=boundary-created.txt`,
      cookies: { boring_session: token },
      payload: { content: 'created after workspace record' },
    })
    expect(writeRes.statusCode).toBe(200)
    expect(readFileSync(join(workspaceRoot, createdWorkspaceId, 'boundary-created.txt'), 'utf-8')).toBe(
      'created after workspace record',
    )

    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('routes exec through the workspace boundary into the workspace-specific directory', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-boundary-exec-'))
    const app = getApp({ workspaceRoot })
    const token = await getToken()

    const execRes = await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_ID}/api/v1/exec`,
      cookies: { boring_session: token },
      payload: { command: 'printf boundary-exec > boundary-exec.txt' },
    })
    expect(execRes.statusCode).toBe(200)

    const workspaceDir = join(workspaceRoot, WORKSPACE_ID)
    expect(existsSync(join(workspaceDir, 'boundary-exec.txt'))).toBe(true)
    expect(readFileSync(join(workspaceDir, 'boundary-exec.txt'), 'utf-8')).toBe('boundary-exec')
    expect(existsSync(join(workspaceRoot, 'boundary-exec.txt'))).toBe(false)

    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('routes file and git mutations into the workspace-specific directory', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'bui-boundary-git-'))
    const app = getApp({ workspaceRoot })
    const token = await getToken()

    const initRes = await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_ID}/api/v1/git/init`,
      cookies: { boring_session: token },
    })
    expect(initRes.statusCode).toBe(200)

    const writeRes = await app.inject({
      method: 'PUT',
      url: `/w/${WORKSPACE_ID}/api/v1/files/write?path=boundary.txt`,
      cookies: { boring_session: token },
      payload: { content: 'workspace boundary git test' },
    })
    expect(writeRes.statusCode).toBe(200)

    const addRes = await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_ID}/api/v1/git/add`,
      cookies: { boring_session: token },
      payload: { paths: ['boundary.txt'] },
    })
    expect(addRes.statusCode).toBe(200)

    const commitRes = await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_ID}/api/v1/git/commit`,
      cookies: { boring_session: token },
      payload: {
        message: 'boundary commit',
        author: { name: 'Boundary Test', email: 'boundary@test.local' },
      },
    })
    expect(commitRes.statusCode).toBe(200)

    const statusRes = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_ID}/api/v1/git/status`,
      cookies: { boring_session: token },
    })
    expect(statusRes.statusCode).toBe(200)
    expect(JSON.parse(statusRes.payload)).toMatchObject({
      is_repo: true,
      available: true,
      files: [],
    })

    const workspaceDir = join(workspaceRoot, WORKSPACE_ID)
    expect(existsSync(join(workspaceDir, '.git'))).toBe(true)
    expect(existsSync(join(workspaceDir, 'boundary.txt'))).toBe(true)
    expect(readFileSync(join(workspaceDir, 'boundary.txt'), 'utf-8')).toBe('workspace boundary git test')
    expect(existsSync(join(workspaceRoot, '.git'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'boundary.txt'))).toBe(false)

    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('serves workspace root as SPA page', async () => {
    const app = getApp()
    const res = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_ID}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    await app.close()
  })

  it('serves setup, settings, and runtime workspace SPA pages', async () => {
    const app = getApp()
    const token = await getToken()

    for (const page of ['setup', 'settings', 'runtime']) {
      const res = await app.inject({
        method: 'GET',
        url: `/w/${WORKSPACE_ID}/${page}`,
        cookies: { boring_session: token },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
    }

    await app.close()
  })
})
