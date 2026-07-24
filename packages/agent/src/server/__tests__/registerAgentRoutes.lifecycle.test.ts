import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyRequest } from 'fastify'
import { afterEach, expect, test, vi } from 'vitest'

import { ErrorCode } from '../../shared/error-codes'
import type { AgentSendInput, RunContext } from '../../shared/harness'
import { HarnessPiChatService } from '../pi-chat/harnessPiChatService'
import { ReadyStatusTracker } from '../runtime/readyStatus'
import type { RuntimeModeAdapter } from '../runtime/mode'
import { registerTestAgentRoutes as registerAgentRoutes } from '@agent-test-host'
import type { WorkspaceAgentDispatcherResolver } from '../workspaceAgentDispatcher'
import { createDispatcherTestHarness } from './workspaceAgentDispatcherTestHarness'

const tempDirs: string[] = []

async function removeDirEventually(dir: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY') throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (lastError) throw lastError
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeDirEventually(dir)))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createDirectRuntimeBundle(
  workspaceRoot: string,
  sessionId: string,
  disposeRuntime?: () => Promise<void>,
) {
  const { createNodeWorkspace } = await import('@agent-test-host')
  const { createDirectSandbox } = await import('@agent-test-host')
  const { createServerFileSearch } = await import('../runtime/createServerFileSearch')
  const workspace = createNodeWorkspace(workspaceRoot)
  const sandbox = createDirectSandbox()
  await sandbox.init?.({ workspace, sessionId })
  return {
    workspace,
    sandbox,
    fileSearch: createServerFileSearch(workspace, sandbox),
    ...(disposeRuntime ? { disposeRuntime } : {}),
  }
}

async function eventually(assertion: () => Promise<void> | void, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  if (lastError) throw lastError
}

test('binding retirement aborts and drains provisioning before provider disposal', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-retired-provisioning-')
  const harness = createDispatcherTestHarness()
  await harness.sessions.create({ workspaceId: 'default' })
  const reloadSession = vi.fn(async () => true)
  const evictCachedRuntime = vi.fn()
  const disposePair = vi.fn(async () => {
    expect(evictCachedRuntime).not.toHaveBeenCalled()
  })
  const disposeAdapter = vi.fn(async () => {})
  let releaseProvisioning!: () => void
  const provisioningGate = new Promise<void>((resolve) => { releaseProvisioning = resolve })
  let markProvisioningStarted!: () => void
  const provisioningStarted = new Promise<void>((resolve) => { markProvisioningStarted = resolve })
  let markProvisioningAborted!: () => void
  const provisioningAborted = new Promise<void>((resolve) => { markProvisioningAborted = resolve })
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter: {
      id: 'retired-provisioning-test',
      workspaceFsCapability: 'strong',
      create: (ctx) => createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId, disposePair),
      evictCachedRuntime,
      dispose: disposeAdapter,
    },
    provisionRuntime: async ({ signal }) => {
      markProvisioningStarted()
      if (signal.aborted) markProvisioningAborted()
      else signal.addEventListener('abort', markProvisioningAborted, { once: true })
      await provisioningGate
      return { changed: true, env: {}, pathEntries: [], skillPaths: [] }
    },
    harnessFactory: async (input) => ({
      ...await harness.factory(input),
      reloadSession,
    }),
  })
  await app.ready()
  await provisioningStarted

  const closing = app.close()
  await provisioningAborted
  expect(evictCachedRuntime).not.toHaveBeenCalled()
  expect(disposeAdapter).not.toHaveBeenCalled()
  releaseProvisioning()
  await closing

  expect(reloadSession).not.toHaveBeenCalled()
  expect(disposePair).toHaveBeenCalledOnce()
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'default' })
  expect(disposeAdapter).toHaveBeenCalledOnce()
})

test('request abort does not release a deferred raw operation before its handler settles', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-binding-lease-')
  const app = Fastify({ logger: false })
  const evictCachedRuntime = vi.fn()
  const disposeAdapter = vi.fn(async () => {})
  let createCount = 0
  let healthChecks = 0
  let deferredRequest: FastifyRequest | undefined
  let releaseSearch!: () => void
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve })
  let markSearchStarted!: () => void
  const searchStarted = new Promise<void>((resolve) => { markSearchStarted = resolve })
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'binding-lease-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    dispose: disposeAdapter,
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        return { state: healthChecks === 2 ? 'recreate' as const : 'ok' as const }
      },
    },
    async create(ctx) {
      createCount += 1
      const bundle = await createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId)
      if (createCount !== 1) return bundle
      return {
        ...bundle,
        fileSearch: {
          async search() {
            markSearchStarted()
            await searchGate
            return []
          },
        },
      }
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: (request) => {
      deferredRequest ??= request
      return 'workspace-lease'
    },
    getWorkspaceRoot: async () => workspaceRoot,
  })
  await app.ready()

  const search = app.inject({ method: 'GET', url: '/api/v1/files/search?q=held' })
  await searchStarted
  deferredRequest!.raw.emit('aborted')
  const recreate = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  await eventually(() => expect(healthChecks).toBe(2))
  expect(createCount).toBe(1)
  expect(evictCachedRuntime).not.toHaveBeenCalled()

  releaseSearch()
  const responses = await Promise.all([search, recreate])
  expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
  expect(createCount).toBe(2)
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-lease' })
  await app.close()
  expect(disposeAdapter).toHaveBeenCalledOnce()
})

test('hijacked fs-events keeps its request lease until the response stream closes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-fs-events-lease-')
  const app = Fastify({ logger: false })
  const evictCachedRuntime = vi.fn()
  let healthChecks = 0
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'fs-events-lease-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    create: (ctx) => createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId),
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        return { state: healthChecks === 2 ? 'recreate' as const : 'ok' as const }
      },
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: () => 'workspace-fs-events',
    getWorkspaceRoot: async () => workspaceRoot,
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (typeof address !== 'object' || !address) throw new Error('no server address')
  const abort = new AbortController()
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/fs/events`, { signal: abort.signal })
  expect(response.status).toBe(200)

  const recreate = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  await eventually(() => expect(healthChecks).toBe(2))
  expect(evictCachedRuntime).not.toHaveBeenCalled()
  abort.abort()
  await response.body?.cancel().catch(() => {})

  expect((await recreate).statusCode).toBe(200)
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-fs-events' })
  await app.close()
}, 15_000)

test('hijacked stream close before binding resolution does not leak a late lease', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-fs-events-late-close-')
  const app = Fastify({ logger: false })
  const evictCachedRuntime = vi.fn()
  const disposeAdapter = vi.fn(async () => {})
  let releaseCreate!: () => void
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  let markCreateStarted!: () => void
  const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve })
  let markRequestAborted!: () => void
  const requestAborted = new Promise<void>((resolve) => { markRequestAborted = resolve })
  const watcherUnsubscribe = vi.fn()
  const watcherSubscribe = vi.fn(() => watcherUnsubscribe)
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'fs-events-late-close-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    dispose: disposeAdapter,
    async create(ctx) {
      markCreateStarted()
      await createGate
      const bundle = await createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId)
      return {
        ...bundle,
        workspace: {
          ...bundle.workspace,
          watch: () => ({ subscribe: watcherSubscribe, close() {} }),
        },
      }
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: (request) => {
      request.raw.once('aborted', markRequestAborted)
      return 'workspace-fs-events-late'
    },
    getWorkspaceRoot: async () => workspaceRoot,
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (typeof address !== 'object' || !address) throw new Error('no server address')
  const abort = new AbortController()
  const response = fetch(`http://127.0.0.1:${address.port}/api/v1/fs/events`, { signal: abort.signal }).catch(() => undefined)
  await createStarted
  abort.abort()
  await requestAborted
  releaseCreate()
  await response
  await app.close()
  expect(watcherSubscribe).not.toHaveBeenCalled()
  expect(watcherUnsubscribe).not.toHaveBeenCalled()
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-fs-events-late' })
  expect(disposeAdapter).toHaveBeenCalledOnce()
}, 15_000)

test('ready-status socket close before tracker resolution does not subscribe or leak its binding lease', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-ready-status-late-close-')
  const app = Fastify({ logger: false })
  const evictCachedRuntime = vi.fn()
  const disposeAdapter = vi.fn(async () => {})
  let releaseCreate!: () => void
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  let markCreateStarted!: () => void
  const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve })
  let markRequestAborted!: () => void
  const requestAborted = new Promise<void>((resolve) => { markRequestAborted = resolve })
  let releaseProvisioning!: () => void
  const provisioningGate = new Promise<void>((resolve) => { releaseProvisioning = resolve })
  let markProvisioningStarted!: () => void
  const provisioningStarted = new Promise<void>((resolve) => { markProvisioningStarted = resolve })
  const trackerSubscribe = vi.spyOn(ReadyStatusTracker.prototype, 'subscribe')
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'ready-status-late-close-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    dispose: disposeAdapter,
    async create(ctx) {
      markCreateStarted()
      await createGate
      return await createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId)
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: (request) => {
      request.raw.once('aborted', markRequestAborted)
      return 'workspace-ready-status-late'
    },
    getWorkspaceRoot: async () => workspaceRoot,
    provisionRuntime: async () => {
      markProvisioningStarted()
      await provisioningGate
      return { changed: false, env: {}, pathEntries: [], skillPaths: [] }
    },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (typeof address !== 'object' || !address) throw new Error('no server address')
  const abort = new AbortController()
  const response = fetch(`http://127.0.0.1:${address.port}/api/v1/ready-status`, { signal: abort.signal }).catch(() => undefined)
  await createStarted
  abort.abort()
  await requestAborted
  releaseCreate()
  await provisioningStarted
  await response
  releaseProvisioning()

  await app.close()
  expect(trackerSubscribe).not.toHaveBeenCalled()
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-ready-status-late' })
  expect(disposeAdapter).toHaveBeenCalledOnce()
  trackerSubscribe.mockRestore()
}, 15_000)

test('pi-chat socket close before service resolution does not subscribe or leak its binding lease', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-pi-chat-late-close-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const evictCachedRuntime = vi.fn()
  const disposeAdapter = vi.fn(async () => {})
  let releaseCreate!: () => void
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  let markCreateStarted!: () => void
  const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve })
  let markRequestAborted!: () => void
  const requestAborted = new Promise<void>((resolve) => { markRequestAborted = resolve })
  const serviceSubscribe = vi.spyOn(HarnessPiChatService.prototype, 'subscribe')
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'pi-chat-late-close-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    dispose: disposeAdapter,
    async create(ctx) {
      markCreateStarted()
      await createGate
      return await createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId)
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    harnessFactory: harness.factory,
    getWorkspaceId: (request) => {
      request.raw.once('aborted', markRequestAborted)
      return 'workspace-pi-chat-late'
    },
    getWorkspaceRoot: async () => workspaceRoot,
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (typeof address !== 'object' || !address) throw new Error('no server address')
  const abort = new AbortController()
  const response = fetch(
    `http://127.0.0.1:${address.port}/api/v1/agent/pi-chat/late-session/events?cursor=0`,
    { signal: abort.signal },
  ).catch(() => undefined)
  await createStarted
  abort.abort()
  await requestAborted
  releaseCreate()
  await response

  await app.close()
  expect(serviceSubscribe).not.toHaveBeenCalled()
  expect(harness.sendInputs).toEqual([])
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-pi-chat-late' })
  expect(disposeAdapter).toHaveBeenCalledOnce()
  serviceSubscribe.mockRestore()
}, 15_000)

test('pi-chat event stream leases its binding until the NDJSON response closes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-pi-chat-stream-lease-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const evictCachedRuntime = vi.fn()
  const createRuntime = vi.fn((workspace: string, session: string) => createDirectRuntimeBundle(workspace, session))
  let healthChecks = 0
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'pi-chat-stream-lease-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    create: (ctx) => createRuntime(ctx.workspaceRoot, ctx.sessionId),
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        return { state: healthChecks === 3 ? 'recreate' as const : 'ok' as const }
      },
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    harnessFactory: harness.factory,
    getWorkspaceId: () => 'workspace-pi-chat-stream',
    getWorkspaceRoot: async () => workspaceRoot,
  })
  await app.ready()
  const created = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/sessions', payload: {} })
  expect(created.statusCode).toBe(201)
  const sessionId = created.json().id as string

  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (typeof address !== 'object' || !address) throw new Error('no server address')
  const abort = new AbortController()
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/agent/pi-chat/${sessionId}/events?cursor=0`,
    { signal: abort.signal },
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/x-ndjson')

  const recreate = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  await eventually(() => expect(healthChecks).toBe(3))
  expect(createRuntime).toHaveBeenCalledOnce()
  expect(evictCachedRuntime).not.toHaveBeenCalled()
  abort.abort()
  await response.body?.cancel().catch(() => {})

  expect((await recreate).statusCode).toBe(200)
  expect(createRuntime).toHaveBeenCalledTimes(2)
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-pi-chat-stream' })
  await app.close()
}, 15_000)

test('retirement lets a leased reload finish before aborting provisioning', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-binding-reload-lease-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const reloadSession = vi.fn(async () => true)
  const evictCachedRuntime = vi.fn()
  let healthChecks = 0
  let provisionCalls = 0
  let reloadProvisionSignal: AbortSignal | undefined
  let releaseProvisioning!: () => void
  const provisioningGate = new Promise<void>((resolve) => { releaseProvisioning = resolve })
  let markReloadProvisioningStarted!: () => void
  const reloadProvisioningStarted = new Promise<void>((resolve) => { markReloadProvisioningStarted = resolve })
  let releaseBeforeReload!: () => void
  const beforeReloadGate = new Promise<void>((resolve) => { releaseBeforeReload = resolve })
  let markBeforeReloadStarted!: () => void
  const beforeReloadStarted = new Promise<void>((resolve) => { markBeforeReloadStarted = resolve })
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'binding-reload-lease-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    create: (ctx) => createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId),
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        return { state: healthChecks === 3 ? 'recreate' as const : 'ok' as const }
      },
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: () => 'workspace-reload-lease',
    getWorkspaceRoot: async () => workspaceRoot,
    provisionRuntime: async ({ signal }) => {
      provisionCalls += 1
      if (provisionCalls === 2) {
        reloadProvisionSignal = signal
        markReloadProvisioningStarted()
        await provisioningGate
      }
      return { changed: true, env: {}, pathEntries: [], skillPaths: [] }
    },
    beforeReload: async () => {
      markBeforeReloadStarted()
      await beforeReloadGate
    },
    harnessFactory: async (input) => ({
      ...await harness.factory(input),
      reloadSession,
    }),
  })
  await app.ready()
  expect((await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })).statusCode).toBe(200)
  await new Promise((resolve) => setTimeout(resolve, 0))

  const reload = app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: {} })
  await reloadProvisioningStarted
  const recreate = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  await eventually(() => expect(healthChecks).toBe(3))
  releaseProvisioning()
  await beforeReloadStarted

  expect(reloadProvisionSignal?.aborted).toBe(false)
  expect(evictCachedRuntime).not.toHaveBeenCalled()
  releaseBeforeReload()
  const responses = await Promise.all([reload, recreate])

  expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
  expect(reloadSession).toHaveBeenCalledWith('default')
  expect(reloadProvisionSignal?.aborted).toBe(true)
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-reload-lease' })
  await app.close()
})

test('request-scoped binding recreation awaits local retirement without disposing the shared adapter', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-binding-recreate-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const evictCachedRuntime = vi.fn()
  const disposeAdapter = vi.fn(async () => {})
  let healthChecks = 0
  let releaseRecreateChecks!: () => void
  const recreateChecks = new Promise<void>((resolve) => { releaseRecreateChecks = resolve })
  const createRuntime = vi.fn((workspace: string, session: string) => createDirectRuntimeBundle(workspace, session))
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'binding-recreate-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    dispose: disposeAdapter,
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        if (healthChecks === 1 || healthChecks > 3) return { state: 'ok' as const }
        await recreateChecks
        return { state: 'recreate' as const }
      },
    },
    create: (ctx) => createRuntime(ctx.workspaceRoot, ctx.sessionId),
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    harnessFactory: harness.factory,
    getWorkspaceId: () => 'workspace-health',
    getTrustedWorkspaceRoot: async () => workspaceRoot,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  await app.ready()

  const dispatcher = await resolver!.resolve({ workspaceId: 'workspace-health', userId: 'user-health' })
  const events = []
  for await (const event of dispatcher.send({ content: 'health binding' })) events.push(event)
  const activeSessionId = events[0]?.sessionId
  const first = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  const second = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  await eventually(() => expect(healthChecks).toBe(3))
  releaseRecreateChecks()
  const responses = await Promise.all([first, second])

  expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
  expect(createRuntime).toHaveBeenCalledTimes(2)
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-health' })
  expect(harness.adapters.get(activeSessionId!)?.abortCount).toBe(1)
  expect(disposeAdapter).not.toHaveBeenCalled()
  await app.close()
  expect(disposeAdapter).toHaveBeenCalledOnce()
})

test('one request pins one runtime recipe while a later identity creates a new binding', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-runtime-recipe-lease-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const evictCachedRuntime = vi.fn()
  const createRuntime = vi.fn((root: string, sessionId: string) => createDirectRuntimeBundle(root, sessionId))
  const resolveContribution = vi.fn(async () => Object.freeze({ identity: activeIdentity }))
  let activeIdentity = 'digest-1'
  let releaseCommands!: () => void
  const commandsGate = new Promise<void>((resolve) => { releaseCommands = resolve })
  let markCommandsStarted!: () => void
  const commandsStarted = new Promise<void>((resolve) => { markCommandsStarted = resolve })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    externalPlugins: false,
    getWorkspaceId: () => 'workspace-recipe',
    getWorkspaceRoot: async () => workspaceRoot,
    getRuntimeScopeContribution: resolveContribution,
    runtimeModeAdapter: {
      id: 'runtime-recipe-lease-test', workspaceFsCapability: 'strong', evictCachedRuntime,
      create: (ctx) => createRuntime(ctx.workspaceRoot, ctx.sessionId),
    },
    harnessFactory: async (input) => ({
      ...await harness.factory(input),
      async getSlashCommands() { markCommandsStarted(); await commandsGate; return [] },
    }),
  })
  await app.ready()

  const oldRequest = app.inject({ method: 'GET', url: '/api/v1/agent/commands' })
  await commandsStarted
  expect(resolveContribution).toHaveBeenCalledTimes(1)
  expect(createRuntime).toHaveBeenCalledTimes(1)

  activeIdentity = 'digest-2'
  expect((await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })).statusCode).toBe(200)
  expect(resolveContribution).toHaveBeenCalledTimes(2)
  expect(createRuntime).toHaveBeenCalledTimes(2)

  const closing = app.close()
  expect(evictCachedRuntime).not.toHaveBeenCalled()
  releaseCommands()
  expect((await oldRequest).statusCode).toBe(200)
  expect(resolveContribution).toHaveBeenCalledTimes(2)
  await closing
  expect(resolveContribution).toHaveBeenCalledTimes(2)
  expect(evictCachedRuntime).toHaveBeenCalledTimes(2)
})

test('requestless dispatcher send leases its binding until iteration completes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-dispatcher-operation-lease-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const evictCachedRuntime = vi.fn()
  let healthChecks = 0
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  let releasePrompt!: () => void
  const promptGate = new Promise<void>((resolve) => { releasePrompt = resolve })
  let markPromptStarted!: () => void
  const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve })
  let patchedAdapter = false
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'dispatcher-operation-lease-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    create: (ctx) => createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId),
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        return { state: healthChecks === 2 ? 'recreate' as const : 'ok' as const }
      },
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: () => 'workspace-dispatcher-operation',
    getTrustedWorkspaceRoot: async () => workspaceRoot,
    harnessFactory: async (input) => {
      const base = await harness.factory(input)
      return {
        ...base,
        async getPiSessionAdapter(sendInput: AgentSendInput, ctx: RunContext) {
          const adapter = await base.getPiSessionAdapter(sendInput, ctx)
          if (!patchedAdapter) {
            patchedAdapter = true
            const prompt = adapter.prompt.bind(adapter)
            adapter.prompt = async (promptInput) => {
              markPromptStarted()
              await promptGate
              await prompt(promptInput)
            }
          }
          return adapter
        },
      }
    },
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  await app.ready()

  const dispatcher = await resolver!.resolve({ workspaceId: 'workspace-dispatcher-operation', userId: 'user-operation' })
  const send = (async () => {
    const events = []
    for await (const event of dispatcher.send({ content: 'held operation' })) events.push(event)
    return events
  })()
  await promptStarted
  const recreate = app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  await eventually(() => expect(healthChecks).toBe(2))
  expect(evictCachedRuntime).not.toHaveBeenCalled()

  releasePrompt()
  expect((await send).at(-1)?.chunk).toMatchObject({ type: 'agent-end', status: 'ok' })
  expect((await recreate).statusCode).toBe(200)
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-dispatcher-operation' })
  await app.close()
})

test('static dispatcher resolution fails after host shutdown starts', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-static-dispatcher-close-')
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  await app.ready()
  const retained = await resolver!.resolve({ workspaceId: 'default', userId: 'user-close' })
  await app.close()

  await expect(resolver!.resolve({ workspaceId: 'default', userId: 'user-close' })).rejects.toMatchObject({
    code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
  })
  await expect(retained.interrupt('retained-session')).rejects.toMatchObject({
    code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
  })
})

test('plugin shutdown drains outside preClose timeout before dispatcher admission closes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-plugin-shutdown-drain-')
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  let releaseDrain!: () => void
  const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve })
  const begin = vi.fn()
  const drain = vi.fn(async () => await drainGate)
  const app = Fastify({ logger: false, pluginTimeout: 1_000 })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    shutdownParticipants: [{ begin, drain }],
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  await app.ready()

  let closeSettled = false
  const closing = app.close().then(() => { closeSettled = true })
  await eventually(() => expect(drain).toHaveBeenCalledOnce())
  await new Promise<void>((resolve) => setTimeout(resolve, 1_100))
  expect(begin).toHaveBeenCalledOnce()
  expect(closeSettled).toBe(false)
  await expect(resolver!.resolve({ workspaceId: 'default', userId: 'user-during-drain' })).resolves.toBeDefined()

  releaseDrain()
  await expect(closing).resolves.toBeUndefined()
  expect(closeSettled).toBe(true)
  await expect(resolver!.resolve({ workspaceId: 'default', userId: 'user-after-close' })).rejects.toMatchObject({
    code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
  })
})

test('shutdown rejects new dispatcher work while an admitted HTTP request drains', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-dispatcher-drain-')
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  let releaseSearch!: () => void
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve })
  let markSearchStarted!: () => void
  const searchStarted = new Promise<void>((resolve) => { markSearchStarted = resolve })
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'dispatcher-drain-test',
    workspaceFsCapability: 'strong',
    async create(ctx) {
      const bundle = await createDirectRuntimeBundle(ctx.workspaceRoot, ctx.sessionId)
      return {
        ...bundle,
        fileSearch: {
          async search() {
            markSearchStarted()
            await searchGate
            return []
          },
        },
      }
    },
  }
  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: () => 'workspace-drain',
    getWorkspaceRoot: async () => workspaceRoot,
    getTrustedWorkspaceRoot: async () => workspaceRoot,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  await app.ready()
  const retained = await resolver!.resolve({ workspaceId: 'workspace-drain', userId: 'user-drain' })
  const search = app.inject({ method: 'GET', url: '/api/v1/files/search?q=held' })
  await searchStarted

  let closeSettled = false
  const close = app.close().then(() => { closeSettled = true })
  await eventually(async () => {
    await expect(resolver!.resolve({ workspaceId: 'workspace-drain', userId: 'user-drain' })).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    })
  })
  await expect(retained.interrupt('retained-session')).rejects.toMatchObject({
    code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
  })
  expect(closeSettled).toBe(false)

  releaseSearch()
  expect((await search).statusCode).toBe(200)
  await close
})

test('failed local disposal removes its tombstone and stays primary when provider eviction also fails', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-binding-dispose-failure-')
  const app = Fastify({ logger: false })
  const harness = createDispatcherTestHarness()
  const evictCachedRuntime = vi.fn()
    .mockImplementationOnce(() => { throw new Error('provider eviction failed') })
  const disposePair = vi.fn()
    .mockRejectedValueOnce(new Error('runtime pair disposal failed'))
    .mockResolvedValue(undefined)
  const createRuntime = vi.fn((workspace: string, session: string) => (
    createDirectRuntimeBundle(workspace, session, disposePair)
  ))
  let healthChecks = 0
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'binding-dispose-failure-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    create: (ctx) => createRuntime(ctx.workspaceRoot, ctx.sessionId),
    cachedBindingHealthCheck: {
      intervalMs: 0,
      async check() {
        healthChecks += 1
        return { state: healthChecks === 2 ? 'recreate' as const : 'ok' as const }
      },
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    harnessFactory: harness.factory,
    getWorkspaceId: () => 'workspace-dispose-failure',
    getTrustedWorkspaceRoot: async () => workspaceRoot,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  await app.ready()

  const dispatcher = await resolver!.resolve({ workspaceId: 'workspace-dispose-failure', userId: 'user-dispose-failure' })
  const events = []
  for await (const event of dispatcher.send({ content: 'active binding' })) events.push(event)
  const adapter = harness.adapters.get(events[0]!.sessionId)!
  adapter.abort = vi.fn(async () => { throw new Error('local disposal failed') })

  const failedReplacement = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(failedReplacement.statusCode).toBe(500)
  expect(failedReplacement.body).toContain('local disposal failed')
  expect(failedReplacement.body).not.toContain('runtime pair disposal failed')
  expect(failedReplacement.body).not.toContain('provider eviction failed')
  expect(disposePair).toHaveBeenCalledOnce()
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-dispose-failure' })
  const replacement = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(replacement.statusCode).toBe(200)
  expect(createRuntime).toHaveBeenCalledTimes(2)
  await app.close()
})

test('binding creation preserves its original error when provider cleanup throws', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-binding-failure-')
  const app = Fastify({ logger: false })
  const evictCachedRuntime = vi.fn(() => { throw new Error('provider cleanup failed') })
  const disposeAdapter = vi.fn(async () => {})
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'binding-failure-test',
    workspaceFsCapability: 'strong',
    evictCachedRuntime,
    dispose: disposeAdapter,
    async create() {
      throw new Error('binding creation failed')
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    externalPlugins: false,
    getWorkspaceId: () => 'workspace-failure',
  })
  await app.ready()

  const response = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(response.statusCode).toBe(500)
  expect(response.body).toContain('binding creation failed')
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'workspace-failure' })
  expect(evictCachedRuntime).toHaveBeenCalledOnce()
  expect(disposeAdapter).not.toHaveBeenCalled()
  await app.close()
  expect(disposeAdapter).toHaveBeenCalledOnce()
})
