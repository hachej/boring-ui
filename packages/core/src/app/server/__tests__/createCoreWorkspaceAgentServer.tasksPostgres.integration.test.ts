// @vitest-environment jsdom
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'

import { type RuntimeModeAdapter } from '@hachej/boring-agent/server'
import { createTasksServerPlugin } from '../../../../../../plugins/tasks/src/server/index'
import { TaskCard } from '../../../../../../plugins/tasks/src/front/TaskCard'
import type { BoringTaskCard } from '../../../../../../plugins/tasks/src/shared'
import { createMockVercelSandboxHarness } from '../../../../../../packages/agent/src/server/workspace/__tests__/helpers/mockVercelSandbox'
import { createVercelSandboxModeAdapter } from '../../../../../../packages/agent/src/server/runtime/modes/vercel-sandbox'
import { runMigrations } from '../../../server/db/migrate'
import { resolveCoreTestDatabase, type CoreTestDatabase } from '../../../server/db/__tests__/testDatabase'
import type { CoreConfig } from '../../../shared/types'
import { WorkspaceRuntimeSandboxHandleStore } from '../../../server/runtime'
import { createCoreWorkspaceAgentServer, type CoreWorkspaceAgentServer } from '../createCoreWorkspaceAgentServer'

const taskCardUi = vi.hoisted(() => ({
  openDetachedChat: vi.fn(),
  pluginClient: {
    postJson: vi.fn(),
    getJson: vi.fn(),
  },
}))

vi.mock('@hachej/boring-workspace', () => ({
  useWorkspacePluginClient: () => taskCardUi.pluginClient,
}))

vi.mock('@hachej/boring-workspace/plugin', () => ({
  useWorkspaceShellCapabilities: () => ({ openArtifact: vi.fn(), openDetachedChat: taskCardUi.openDetachedChat }),
}))

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

type VercelSandboxModeOptions = Parameters<typeof createVercelSandboxModeAdapter>[0]
type SandboxHandleStore = NonNullable<NonNullable<VercelSandboxModeOptions>['store']>
type SandboxHandleRecord = NonNullable<Awaited<ReturnType<SandboxHandleStore['get']>>>
type MockHostedSandbox = Awaited<ReturnType<typeof createMockVercelSandboxHarness>> & {
  sandboxId: string
  snapshotId: string
  expireRuntimeStat(): void
}

function createDeferredSandboxHandleStore(): {
  store: SandboxHandleStore
  bind(store: SandboxHandleStore): void
} {
  let delegate: SandboxHandleStore | undefined
  const requireDelegate = () => {
    if (!delegate) throw new Error('sandbox handle store is not bound to Core workspace store')
    return delegate
  }
  return {
    bind(store) { delegate = store },
    store: {
      async get(workspaceId) { return await requireDelegate().get(workspaceId) },
      async put(record) { await requireDelegate().put(record) },
      async delete(workspaceId) { await requireDelegate().delete(workspaceId) },
      async list() { return await requireDelegate().list() },
    },
  }
}

async function createHostedVercelRuntimeFixture(): Promise<{
  adapter: RuntimeModeAdapter
  bindTo(app: CoreWorkspaceAgentServer): void
  expirePrimaryRuntime(): MockHostedSandbox
  getStoredHandle(workspaceId: string): Promise<SandboxHandleRecord | null>
  createCalls: ReturnType<typeof vi.fn>
  getCalls: ReturnType<typeof vi.fn>
  cleanup(): Promise<void>
}> {
  const deferredStore = createDeferredSandboxHandleStore()
  const hostedSandboxes: MockHostedSandbox[] = []
  const hostedSandboxesById = new Map<string, MockHostedSandbox>()
  let primaryRuntime: MockHostedSandbox | undefined
  let sandboxSeq = 0

  const makeSandbox = async (snapshotId?: string): Promise<MockHostedSandbox> => {
    const harness = await createMockVercelSandboxHarness()
    const sandboxId = `sb-hosted-${++sandboxSeq}`
    const resolvedSnapshotId = snapshotId ?? `snap-hosted-${sandboxSeq}`
    let expired = false
    const sandbox = harness.sandbox as typeof harness.sandbox & {
      sandboxId: string
      name: string
      status: string
      sourceSnapshotId: string
      persistent: boolean
      fs: typeof harness.sandbox.fs & { stat: typeof harness.sandbox.fs.stat }
    }
    const stat = sandbox.fs.stat.bind(sandbox.fs)
    sandbox.sandboxId = sandboxId
    sandbox.name = sandboxId
    sandbox.status = 'running'
    sandbox.sourceSnapshotId = resolvedSnapshotId
    sandbox.persistent = true
    sandbox.fs.stat = (async (...args: Parameters<typeof sandbox.fs.stat>) => {
      if (expired) {
        const error = new Error('sandbox expired') as Error & { code: string }
        error.code = 'SANDBOX_EXPIRED'
        throw error
      }
      return await stat(...args)
    }) as typeof sandbox.fs.stat

    const hosted = Object.assign(harness, {
      sandboxId,
      snapshotId: resolvedSnapshotId,
      expireRuntimeStat() {
        expired = true
        sandbox.status = 'stopped'
      },
    })
    hostedSandboxes.push(hosted)
    hostedSandboxesById.set(sandboxId, hosted)
    if (!primaryRuntime) primaryRuntime = hosted
    return hosted
  }

  // Test seam: Core's hosted app owns the production Postgres-backed workspace
  // store, so the sandbox handle store is bound after boot. The runtime/sandbox
  // itself is the existing Vercel mode adapter plus its mock Vercel sandbox
  // fixture from agent tests; replacement still flows through the real adapter
  // health-check, eviction, resolve-handle, and bundle recreation hooks.
  const createCalls = vi.fn(async (params?: { source?: { type?: string; snapshotId?: string } }) => {
    const hosted = await makeSandbox(params?.source?.snapshotId)
    return hosted.sandbox
  })
  const getCalls = vi.fn(async (params: { sandboxId?: string; name?: string }) => {
    const sandboxId = params.sandboxId ?? params.name
    const hosted = sandboxId ? hostedSandboxesById.get(sandboxId) : undefined
    if (!hosted) {
      const error = new Error(`unknown sandbox: ${sandboxId ?? 'missing'}`) as Error & { status: number }
      error.status = 404
      throw error
    }
    return hosted.sandbox
  })
  const adapter = createVercelSandboxModeAdapter({
    store: deferredStore.store,
    vercelClient: { create: createCalls, get: getCalls },
    orphanGuardMaxIdleMs: null,
    getEnvVar(name) {
      if (name === 'VERCEL_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
    logger: { info: vi.fn(), warn: vi.fn() },
  })

  return {
    adapter,
    bindTo(app) {
      deferredStore.bind(new WorkspaceRuntimeSandboxHandleStore(app.workspaceStore))
    },
    expirePrimaryRuntime() {
      if (!primaryRuntime) throw new Error('primary hosted runtime was not created')
      primaryRuntime.expireRuntimeStat()
      return primaryRuntime
    },
    async getStoredHandle(workspaceId) {
      return await deferredStore.store.get(workspaceId)
    },
    createCalls,
    getCalls,
    async cleanup() {
      await Promise.all(hostedSandboxes.map((hosted) => hosted.cleanup()))
    },
  }
}

async function createHostedApp(options: {
  databaseUrl: string
  workspaceRoot: string
  sessionRoot: string
  runtimeModeAdapter: RuntimeModeAdapter
}): Promise<CoreWorkspaceAgentServer> {
  return await createCoreWorkspaceAgentServer({
    config: baseConfig(options.databaseUrl),
    serveFrontend: false,
    runtimeModeAdapter: options.runtimeModeAdapter,
    workspaceRoot: options.workspaceRoot,
    sessionRoot: options.sessionRoot,
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

async function defaultWorkspaceId(app: CoreWorkspaceAgentServer, cookie: string): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/workspaces',
    headers: { cookie },
  })
  expect(response.statusCode, response.body).toBe(200)
  const body = response.json() as { workspaces?: Array<{ id?: unknown }> }
  const workspaceId = body.workspaces?.[0]?.id
  expect(workspaceId).toEqual(expect.any(String))
  return workspaceId as string
}

function workspaceQuery(workspaceId?: string): string {
  return workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
}

function appendWorkspaceQuery(path: string, workspaceId: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`
}

function useHostedTaskCardClient(app: CoreWorkspaceAgentServer, input: { cookie: string; workspaceId: string }): void {
  taskCardUi.pluginClient.postJson.mockImplementation(async (path: string, payload: unknown) => {
    const response = await app.inject({
      method: 'POST',
      url: appendWorkspaceQuery(path, input.workspaceId),
      headers: { cookie: input.cookie },
      payload: payload as Record<string, unknown>,
    })
    if (response.statusCode >= 400) throw new Error(response.body)
    return response.json()
  })
  taskCardUi.pluginClient.getJson.mockImplementation(async (path: string) => {
    const response = await app.inject({
      method: 'GET',
      url: appendWorkspaceQuery(path, input.workspaceId),
      headers: { cookie: input.cookie },
    })
    if (response.statusCode >= 400) throw new Error(response.body)
    return response.json()
  })
}

async function createPiSession(app: CoreWorkspaceAgentServer, input: {
  workspaceId?: string
  title: string
  cookie: string
}): Promise<{ id: string; title: string }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agent/pi-chat/sessions${workspaceQuery(input.workspaceId)}`,
    headers: { cookie: input.cookie },
    payload: { title: input.title },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json()
}

async function renamePiSession(app: CoreWorkspaceAgentServer, input: {
  workspaceId: string
  sessionId: string
  title: string
  cookie: string
}): Promise<{ id: string; title: string }> {
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/agent/pi-chat/sessions/${encodeURIComponent(input.sessionId)}${workspaceQuery(input.workspaceId)}`,
    headers: { cookie: input.cookie },
    payload: { title: input.title },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

async function listPiSessions(app: CoreWorkspaceAgentServer, input: {
  workspaceId: string
  activeSessionId: string
  cookie: string
}) {
  return await app.inject({
    method: 'GET',
    url: `/api/v1/agent/pi-chat/sessions?workspaceId=${encodeURIComponent(input.workspaceId)}&activeSessionId=${encodeURIComponent(input.activeSessionId)}`,
    headers: { cookie: input.cookie },
  })
}

async function readPiSessionState(app: CoreWorkspaceAgentServer, input: {
  workspaceId: string
  sessionId: string
  cookie: string
}) {
  return await app.inject({
    method: 'GET',
    url: `/api/v1/agent/pi-chat/${encodeURIComponent(input.sessionId)}/state${workspaceQuery(input.workspaceId)}`,
    headers: { cookie: input.cookie },
  })
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
    let runtimeFixture: Awaited<ReturnType<typeof createHostedVercelRuntimeFixture>> | undefined
    try {
      taskCardUi.openDetachedChat.mockReset()
      taskCardUi.pluginClient.postJson.mockReset()
      taskCardUi.pluginClient.getJson.mockReset()

      runtimeFixture = await createHostedVercelRuntimeFixture()
      firstApp = await createHostedApp({
        databaseUrl,
        workspaceRoot: firstWorkspaceRoot,
        sessionRoot,
        runtimeModeAdapter: runtimeFixture.adapter,
      })
      runtimeFixture.bindTo(firstApp)
      const cookie = await signUp(firstApp, `hosted-tasks-${Date.now()}@example.test`)
      const outsiderCookie = await signUp(firstApp, `hosted-tasks-outsider-${Date.now()}@example.test`)
      const authHeaders = new Headers()
      authHeaders.set('cookie', cookie)
      const authSession = await firstApp.auth.api.getSession({ headers: authHeaders })
      expect(authSession?.user?.id).toEqual(expect.any(String))
      const workspaceA = await defaultWorkspaceId(firstApp, cookie)
      const workspaceB = await defaultWorkspaceId(firstApp, outsiderCookie)
      expect(workspaceB).not.toBe(workspaceA)

      const createdSession = await createPiSession(firstApp, { workspaceId: workspaceA, title: 'Workspace A routed session', cookie })
      const workspaceSession = await renamePiSession(firstApp, {
        workspaceId: workspaceA,
        sessionId: createdSession.id,
        title: 'Workspace A routed session renamed',
        cookie,
      })
      expect(workspaceSession).toMatchObject({ id: createdSession.id, title: 'Workspace A routed session renamed' })
      const workspaceBSession = await createPiSession(firstApp, { workspaceId: workspaceB, title: 'Workspace B session', cookie: outsiderCookie })
      const unlinkProofSession = await createPiSession(firstApp, { workspaceId: workspaceA, title: 'Workspace A unlink proof', cookie })

      const workspaceSessions = await listPiSessions(firstApp, {
        workspaceId: workspaceA,
        activeSessionId: workspaceSession.id,
        cookie,
      })
      expect(workspaceSessions.statusCode, workspaceSessions.body).toBe(200)
      expect(workspaceSessions.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: workspaceSession.id, title: 'Workspace A routed session renamed' }),
      ]))

      const taskSearch = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/search?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { query: 'renamed' },
      })
      expect(taskSearch.statusCode, taskSearch.body).toBe(200)
      expect(taskSearch.json().sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: workspaceSession.id, title: 'Workspace A routed session renamed' }),
      ]))

      const unauthenticatedList = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/list?workspaceId=${encodeURIComponent(workspaceA)}`,
        payload: { adapterId: 'github', taskId: '614' },
      })
      expect(unauthenticatedList.statusCode).toBe(401)
      expect(unauthenticatedList.json()).toMatchObject({ code: 'unauthorized' })

      const crossMemberList = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/list?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie: outsiderCookie },
        payload: { adapterId: 'github', taskId: '614' },
      })
      expect(crossMemberList.statusCode).toBe(403)
      expect(crossMemberList.json()).toMatchObject({ code: 'forbidden' })

      const wrongRuntimeLink = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/link?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { adapterId: 'github', taskId: '614', sessionId: workspaceBSession.id },
      })
      expect(wrongRuntimeLink.statusCode).toBe(404)
      expect(wrongRuntimeLink.json()).toMatchObject({ code: 'TASK_SESSION_NOT_FOUND' })

      const linked = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/link?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { workspaceId: workspaceB, adapterId: 'github', taskId: '614', sessionId: workspaceSession.id },
      })
      expect(linked.statusCode, linked.body).toBe(200)
      const link = linked.json().link
      expect(link).toMatchObject({ workspaceId: workspaceA, sessionId: workspaceSession.id, title: 'Workspace A routed session renamed' })

      const unlinkProofLinkResponse = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/link?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { adapterId: 'github', taskId: '614-unlink', sessionId: unlinkProofSession.id },
      })
      expect(unlinkProofLinkResponse.statusCode, unlinkProofLinkResponse.body).toBe(200)
      const unlinkProofLink = unlinkProofLinkResponse.json().link

      const crossMemberUnlink = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/unlink?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie: outsiderCookie },
        payload: { bindingId: unlinkProofLink.id },
      })
      expect(crossMemberUnlink.statusCode).toBe(403)
      expect(crossMemberUnlink.json()).toMatchObject({ code: 'forbidden' })

      const authorizedUnlink = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/unlink?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { bindingId: unlinkProofLink.id },
      })
      expect(authorizedUnlink.statusCode, authorizedUnlink.body).toBe(200)

      const persistedRows = await sql`
        SELECT workspace_id, adapter_id, task_id, session_id, title
        FROM boring_task_session_bindings
        WHERE id = ${link.id}
      `
      expect(persistedRows).toEqual([{ workspace_id: workspaceA, adapter_id: 'github', task_id: '614', session_id: workspaceSession.id, title: 'Workspace A routed session renamed' }])

      const workspaceBList = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/list?workspaceId=${encodeURIComponent(workspaceB)}`,
        headers: { cookie: outsiderCookie },
        payload: { adapterId: 'github', taskId: '614' },
      })
      expect(workspaceBList.statusCode).toBe(200)
      expect(workspaceBList.json().links).toEqual([])

      const storedSandboxBeforeReplacement = await runtimeFixture.getStoredHandle(workspaceA)
      expect(storedSandboxBeforeReplacement).toMatchObject({ workspaceId: workspaceA, sandboxId: expect.stringMatching(/^sb-hosted-/) })
      const expiredSandbox = runtimeFixture.expirePrimaryRuntime()
      const replacementNow = Date.now() + 20_000
      const replacementClock = vi.spyOn(Date, 'now').mockReturnValue(replacementNow)
      try {
        const searchAfterSandboxReplacement = await firstApp.inject({
          method: 'POST',
          url: `/api/boring-tasks/sessions/search?workspaceId=${encodeURIComponent(workspaceA)}`,
          headers: { cookie },
          payload: { query: 'renamed' },
        })
        expect(searchAfterSandboxReplacement.statusCode, searchAfterSandboxReplacement.body).toBe(200)
        expect(searchAfterSandboxReplacement.json().sessions).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: workspaceSession.id, title: 'Workspace A routed session renamed' }),
        ]))
      } finally {
        replacementClock.mockRestore()
      }
      const storedSandboxAfterReplacement = await runtimeFixture.getStoredHandle(workspaceA)
      expect(storedSandboxAfterReplacement).toMatchObject({ workspaceId: workspaceA, snapshotId: expiredSandbox.snapshotId })
      expect(storedSandboxAfterReplacement?.sandboxId).not.toBe(expiredSandbox.sandboxId)
      expect(runtimeFixture.getCalls).toHaveBeenCalledWith(expect.objectContaining({ sandboxId: expiredSandbox.sandboxId, resume: true }))
      expect(runtimeFixture.createCalls).toHaveBeenCalledWith(expect.objectContaining({
        name: expiredSandbox.sandboxId,
        persistent: true,
        snapshotExpiration: 0,
        source: { type: 'snapshot', snapshotId: expiredSandbox.snapshotId },
      }))

      const reopenedThroughTaskPort = await firstApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/link?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { adapterId: 'github', taskId: '614', sessionId: workspaceSession.id },
      })
      expect(reopenedThroughTaskPort.statusCode, reopenedThroughTaskPort.body).toBe(200)
      expect(reopenedThroughTaskPort.json().link.id).toBe(link.id)

      useHostedTaskCardClient(firstApp, { cookie, workspaceId: workspaceA })
      const task: BoringTaskCard = {
        id: '614',
        number: '#614',
        title: 'Hosted task session binding',
        statusId: 'ready',
        adapterId: 'github',
      }
      const ui = render(createElement(TaskCard, {
        task,
        draggable: false,
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
      }))
      try {
        expect(await screen.findByLabelText('1 linked chats')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /open chat/i }))
        expect(await screen.findByRole('region', { name: /linked chat sessions/i })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Open' }))
        await waitFor(() => expect(taskCardUi.openDetachedChat).toHaveBeenCalledWith(
          workspaceSession.id,
          expect.objectContaining({ title: 'Workspace A routed session renamed', composingEnabled: true }),
        ))
      } finally {
        ui.unmount()
      }

      runtimeFixture.adapter.evictCachedRuntime?.({ workspaceId: workspaceA })
      await firstApp.close()
      firstApp = undefined

      secondApp = await createHostedApp({
        databaseUrl,
        workspaceRoot: secondWorkspaceRoot,
        sessionRoot,
        runtimeModeAdapter: runtimeFixture.adapter,
      })
      runtimeFixture.bindTo(secondApp)
      const listedAfterRestart = await secondApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/list?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { adapterId: 'github', taskId: '614' },
      })
      expect(listedAfterRestart.statusCode, listedAfterRestart.body).toBe(200)
      expect(listedAfterRestart.json().links).toEqual([
        expect.objectContaining({ id: link.id, sessionId: workspaceSession.id, title: 'Workspace A routed session renamed' }),
      ])

      const listedSessionsAfterRestart = await listPiSessions(secondApp, {
        workspaceId: workspaceA,
        activeSessionId: workspaceSession.id,
        cookie,
      })
      expect(listedSessionsAfterRestart.statusCode, listedSessionsAfterRestart.body).toBe(200)
      expect(listedSessionsAfterRestart.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: workspaceSession.id, title: 'Workspace A routed session renamed' }),
      ]))

      const reopenedState = await readPiSessionState(secondApp, {
        workspaceId: workspaceA,
        sessionId: workspaceSession.id,
        cookie,
      })
      expect(reopenedState.statusCode, reopenedState.body).toBe(200)
      expect(reopenedState.json()).toMatchObject({ sessionId: workspaceSession.id, status: 'idle' })

      const reopened = await secondApp.inject({
        method: 'POST',
        url: `/api/boring-tasks/sessions/link?workspaceId=${encodeURIComponent(workspaceA)}`,
        headers: { cookie },
        payload: { adapterId: 'github', taskId: '614', sessionId: workspaceSession.id },
      })
      expect(reopened.statusCode).toBe(200)
      expect(reopened.json().link.id).toBe(link.id)

    } finally {
      await secondApp?.close()
      await firstApp?.close()
      await runtimeFixture?.cleanup()
      await sql.end()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
