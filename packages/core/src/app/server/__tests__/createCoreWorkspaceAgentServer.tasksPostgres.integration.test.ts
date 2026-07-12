import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

import { createTasksServerPlugin } from '../../../../../../plugins/tasks/src/server/index'
import { PiSessionStore } from '../../../../../../packages/agent/src/server/harness/pi-coding-agent/sessions'
import { runMigrations } from '../../../server/db/migrate'
import { resolveCoreTestDatabase, type CoreTestDatabase } from '../../../server/db/__tests__/testDatabase'
import type { CoreConfig } from '../../../shared/types'
import { createCoreWorkspaceAgentServer, type CoreWorkspaceAgentServer } from '../createCoreWorkspaceAgentServer'

const TEST_DB: CoreTestDatabase | undefined = await resolveCoreTestDatabase('hosted_tasks')

function baseConfig(databaseUrl: string): CoreConfig {
  return {
    appId: 'hosted-tasks-test',
    appName: 'Hosted Tasks Test',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl,
    stores: 'postgres',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'silent' as CoreConfig['logLevel'],
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 's'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
    },
    features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
  }
}

function requestWorkspaceId(request: { headers?: Record<string, unknown>; query?: unknown }): string {
  const headers = request.headers ?? {}
  const header = headers['x-boring-workspace-id']
    ?? Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-boring-workspace-id')?.[1]
  if (typeof header === 'string' && header.trim()) return header.trim()
  const query = request.query as { workspaceId?: unknown } | undefined
  return typeof query?.workspaceId === 'string' && query.workspaceId.trim() ? query.workspaceId.trim() : 'default'
}

async function createHostedApp(options: {
  databaseUrl: string
  workspaceRoot: string
  sessionRoot: string
}): Promise<CoreWorkspaceAgentServer> {
  return await createCoreWorkspaceAgentServer({
    config: baseConfig(options.databaseUrl),
    serveFrontend: false,
    mode: 'direct',
    workspaceRoot: options.workspaceRoot,
    sessionRoot: options.sessionRoot,
    getWorkspaceId: async (request) => requestWorkspaceId(request),
    plugins: [createTasksServerPlugin({ sources: [] })],
  })
}

async function signUp(app: CoreWorkspaceAgentServer, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: { name: 'Hosted Tasks User', email, password: 'Zk8$mN!qR2xFgWpJ' },
  })
  expect(response.statusCode).toBeGreaterThanOrEqual(200)
  expect(response.statusCode).toBeLessThan(300)
  const setCookie = response.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function createPiSession(app: CoreWorkspaceAgentServer, input: {
  workspaceId?: string
  title: string
  cookie: string
}): Promise<{ id: string; title: string }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agent/pi-chat/sessions${input.workspaceId ? `?workspaceId=${encodeURIComponent(input.workspaceId)}` : ''}`,
    headers: { cookie: input.cookie },
    payload: { title: input.title },
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

afterAll(async () => {
  await TEST_DB?.cleanup()
})

describe.runIf(TEST_DB)('hosted Tasks Postgres composition', () => {
  it('uses real Core + agent routes + Tasks plugin composition and rebinds durable Postgres bindings after runtime replacement', async () => {
    const databaseUrl = TEST_DB!.databaseUrl
    await runMigrations(baseConfig(databaseUrl))
    const sql = postgres(databaseUrl, { max: 2 })
    const tempRoot = await mkdtemp(join(tmpdir(), 'boring-hosted-tasks-'))
    const firstWorkspaceRoot = join(tempRoot, 'workspaces-a')
    const secondWorkspaceRoot = join(tempRoot, 'workspaces-b')
    const sessionRoot = join(tempRoot, 'pi-sessions')

    let firstApp: CoreWorkspaceAgentServer | undefined
    let secondApp: CoreWorkspaceAgentServer | undefined
    try {
      firstApp = await createHostedApp({ databaseUrl, workspaceRoot: firstWorkspaceRoot, sessionRoot })
      const cookie = await signUp(firstApp, `hosted-tasks-${Date.now()}@example.test`)
      const authHeaders = new Headers()
      authHeaders.set('cookie', cookie)
      const authSession = await firstApp.auth.api.getSession({ headers: authHeaders })
      expect(authSession?.user?.id).toEqual(expect.any(String))
      const routedSession = await createPiSession(firstApp, { workspaceId: 'workspace-a', title: 'Workspace A routed session', cookie })
      const workspaceSessions = await firstApp.inject({
        method: 'GET',
        url: `/api/v1/agent/pi-chat/sessions?workspaceId=workspace-a&activeSessionId=${encodeURIComponent(routedSession.id)}`,
        headers: { cookie },
      })
      expect(workspaceSessions.statusCode, workspaceSessions.body).toBe(200)
      expect(workspaceSessions.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: routedSession.id })]))

      const defaultSession = await new PiSessionStore('', { sessionRoot, sessionNamespace: 'default' })
        .create({ workspaceId: 'default' }, { title: 'Default runtime session' })
      const workspaceSeedStore = new PiSessionStore('', { sessionRoot, sessionNamespace: 'workspace-a' })
      const workspaceSession = await workspaceSeedStore.create({ workspaceId: 'workspace-a' }, { title: 'Workspace A session' })
      await expect(workspaceSeedStore.list({ workspaceId: 'workspace-a' }, { includeId: workspaceSession.id })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: workspaceSession.id })]),
      )
      const taskSearch = await firstApp.inject({
        method: 'POST',
        url: '/api/boring-tasks/sessions/search?workspaceId=workspace-a',
        payload: { query: 'Workspace A' },
      })
      expect(taskSearch.statusCode, taskSearch.body).toBe(200)
      expect(taskSearch.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: workspaceSession.id })]))

      const wrongRuntimeLink = await firstApp.inject({
        method: 'POST',
        url: '/api/boring-tasks/sessions/link?workspaceId=workspace-a',
        payload: { adapterId: 'github', taskId: '614', sessionId: defaultSession.id },
      })
      expect(wrongRuntimeLink.statusCode).toBe(404)
      expect(wrongRuntimeLink.json()).toMatchObject({ code: 'TASK_SESSION_NOT_FOUND' })

      const linked = await firstApp.inject({
        method: 'POST',
        url: '/api/boring-tasks/sessions/link?workspaceId=workspace-a',
        payload: { workspaceId: 'workspace-b', adapterId: 'github', taskId: '614', sessionId: workspaceSession.id },
      })
      expect(linked.statusCode, linked.body).toBe(200)
      const link = linked.json().link
      expect(link).toMatchObject({ workspaceId: 'workspace-a', sessionId: workspaceSession.id, title: 'Workspace A session' })

      const persistedRows = await sql`
        SELECT workspace_id, adapter_id, task_id, session_id, title
        FROM boring_task_session_bindings
        WHERE id = ${link.id}
      `
      expect(persistedRows).toEqual([{ workspace_id: 'workspace-a', adapter_id: 'github', task_id: '614', session_id: workspaceSession.id, title: 'Workspace A session' }])

      const workspaceBList = await firstApp.inject({
        method: 'POST',
        url: '/api/boring-tasks/sessions/list?workspaceId=workspace-b',
        payload: { adapterId: 'github', taskId: '614' },
      })
      expect(workspaceBList.statusCode).toBe(200)
      expect(workspaceBList.json().links).toEqual([])

      await firstApp.close()
      firstApp = undefined

      secondApp = await createHostedApp({ databaseUrl, workspaceRoot: secondWorkspaceRoot, sessionRoot })
      const listedAfterRestart = await secondApp.inject({
        method: 'POST',
        url: '/api/boring-tasks/sessions/list?workspaceId=workspace-a',
        payload: { adapterId: 'github', taskId: '614' },
      })
      expect(listedAfterRestart.statusCode).toBe(200)
      expect(listedAfterRestart.json().links).toEqual([expect.objectContaining({ id: link.id, sessionId: workspaceSession.id })])

      const reopened = await secondApp.inject({
        method: 'POST',
        url: '/api/boring-tasks/sessions/link?workspaceId=workspace-a',
        payload: { adapterId: 'github', taskId: '614', sessionId: workspaceSession.id },
      })
      expect(reopened.statusCode).toBe(200)
      expect(reopened.json().link.id).toBe(link.id)
    } finally {
      await secondApp?.close()
      await firstApp?.close()
      await sql.end()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
