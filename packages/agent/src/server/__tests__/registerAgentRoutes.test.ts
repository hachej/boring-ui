import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'

import { AgentEffectAdmissionError } from '../../core/piChatSessionService'
import {
  createTestRuntimeModeAdapter,
  registerTestAgentRoutes as registerAgentRoutes,
  testRuntimeHostOperations,
} from '@agent-test-host'
import { provisionWorkspaceRuntime } from '../workspace/provisioning'
import { ErrorCode } from '../../shared/error-codes'
import type { RuntimeModeAdapter } from '../runtime/mode'
import type { WorkspaceAgentDispatcherResolver } from '../workspaceAgentDispatcher'
import { createDispatcherTestHarness } from './workspaceAgentDispatcherTestHarness'

const tempDirs: string[] = []
const ADMISSION_ERROR_CODE = 'AGENT_HOST_ADMISSION_RECORD_FAILED'

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
  await Promise.all(
    tempDirs.splice(0).map((dir) => removeDirEventually(dir)),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
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

async function createDummyNodeSdkPackage(): Promise<string> {
  const root = await makeTempDir('boring-dummy-node-sdk-')
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dummy-node-sdk',
    version: '1.0.0',
    bin: { 'dummy-sdk': 'bin/dummy-sdk.js' },
  }, null, 2))
  await writeFile(join(root, 'bin', 'dummy-sdk.js'), '#!/usr/bin/env node\nprocess.stdout.write("dummy-sdk\\n")\n')
  return root
}

async function createDummySkill(): Promise<string> {
  const root = await makeTempDir('boring-dummy-skill-')
  await writeFile(join(root, 'SKILL.md'), '---\nname: dummy-sdk-skill\ndescription: Dummy SDK skill\n---\n# Dummy SDK\n')
  return root
}

test('registerAgentRoutes stamps the explicit caller runtime host over the adapter host', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-routes-runtime-host-')
  const adapterBuildBwrapArgs = vi.fn(() => [])
  const callerBuildBwrapArgs = vi.fn(() => [])
  const adapterHost = { ...testRuntimeHostOperations, buildBwrapArgs: adapterBuildBwrapArgs }
  const callerHost = { ...testRuntimeHostOperations, buildBwrapArgs: callerBuildBwrapArgs }
  const directAdapter = createTestRuntimeModeAdapter('direct')
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'runtime-host-precedence-test',
    runtimeHost: adapterHost,
    workspaceFsCapability: 'strong',
    async create(context) {
      return {
        ...await directAdapter.create(context),
        runtimeHost: adapterHost,
        bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
      }
    },
  }
  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter,
    runtimeHost: callerHost,
    externalPlugins: false,
  })
  await app.ready()

  try {
    expect(callerBuildBwrapArgs).toHaveBeenCalledWith(workspaceRoot)
    expect(adapterBuildBwrapArgs).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('registerAgentRoutes composes a trusted dispatcher over the workspace runtime', async () => {
  const harness = createDispatcherTestHarness()
  const workspaceRoot = await makeTempDir('boring-agent-dispatcher-workspace-')
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    sessionId: 'workspace-dispatcher',
    sessionRoot: await makeTempDir('boring-agent-dispatcher-sessions-'),
    harnessFactory: harness.factory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })

  try {
    expect(resolver).toBeDefined()
    const binding = await resolver!.resolveWithWorkspace!({ workspaceId: 'workspace-dispatcher', userId: 'user-dispatcher' })
    expect(binding.workspace.root).toBe(workspaceRoot)
    const dispatcher = binding.dispatcher
    const events = []
    for await (const event of dispatcher.send({
      content: 'workspace prompt',
      model: { provider: 'test', id: 'gpt-5.5' },
    })) events.push(event)

    expect(harness.factoryInputs).toHaveLength(1)
    expect(harness.sessions.createContexts).toEqual([{ workspaceId: 'workspace-dispatcher', userId: 'user-dispatcher' }])
    expect(harness.sendInputs.find((input) => input.model)).toMatchObject({
      ctx: { workspaceId: 'workspace-dispatcher', userId: 'user-dispatcher' },
      model: { provider: 'test', id: 'gpt-5.5' },
    })
    expect(events.some((event) => event.chunk.type === 'usage')).toBe(true)
    expect(events.at(-1)?.chunk).toMatchObject({ type: 'agent-end', status: 'ok' })
    const sessionId = events[0]?.sessionId
    expect(sessionId).toBe('dispatcher-session-1')
    await expect(dispatcher.interrupt(sessionId!)).resolves.toMatchObject({ accepted: true })
    await expect(dispatcher.stop(sessionId!)).resolves.toMatchObject({ accepted: true, stopped: true })
    expect(harness.factoryInputs).toHaveLength(1)
    await expect(resolver!.resolve({ workspaceId: 'wrong-workspace', userId: 'user-dispatcher' })).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
  } finally {
    await app.close()
  }
})

test('registerAgentRoutes externalPlugins=false keeps local plugin files out of catalog', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-plugin-disabled-')
  const pluginDir = join(workspaceRoot, '.pi', 'extensions')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'hidden.mjs'),
    [
      'export default {',
      "  name: 'a4s_embed_plugin_hidden',",
      "  description: 'hidden embedded plugin tool',",
      "  parameters: { type: 'object', properties: {} },",
      '  async execute() { return { content: [{ type: \'text\', text: \'hidden\' }] } },',
      '}',
      '',
    ].join('\n'),
  )
  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    externalPlugins: false,
  })

  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
    expect(res.statusCode).toBe(200)
    const names = res.json().tools.map((tool: { name: string }) => tool.name)
    expect(names).not.toContain('a4s_embed_plugin_hidden')
    expect(names).not.toContain('plugin_diagnostics')
    expect(names).toContain('bash')
    const catalogText = JSON.stringify(res.json()).toLowerCase()
    expect(catalogText).not.toContain('boring-ui-plugin')
    expect(catalogText).not.toContain('boring-plugin-authoring')
    expect(catalogText).not.toContain('plugin-owned')
    expect(catalogText).not.toContain('my-plugin')
  } finally {
    await app.close()
  }
})

test('registerAgentRoutes dispatcher fails closed when dynamic workspace resolution lacks request context', async () => {
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    mode: 'direct',
    workspaceRoot: await makeTempDir('boring-agent-dispatcher-base-'),
    getWorkspaceId: async (request) => String(request.headers['x-boring-workspace-id'] ?? ''),
    getWorkspaceRoot: async () => await makeTempDir('boring-agent-dispatcher-workspace-'),
    harnessFactory: createDispatcherTestHarness().factory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })

  try {
    await expect(resolver!.resolve({ workspaceId: 'workspace-dynamic', userId: 'user-dynamic' })).rejects.toMatchObject({
      code: ErrorCode.enum.WORKSPACE_UNINITIALIZED,
    })
  } finally {
    await app.close()
  }
})

test('registerAgentRoutes dispatcher reuses a dynamic runtime with trusted requestless scope', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-dispatcher-dynamic-')
  const harness = createDispatcherTestHarness()
  const getTrustedWorkspaceRoot = vi.fn(async () => workspaceRoot)
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as FastifyRequest & { user?: { id: string } }).user = { id: 'user-dynamic' }
  })
  await app.register(registerAgentRoutes, {
    mode: 'direct',
    externalPlugins: false,
    workspaceRoot: await makeTempDir('boring-agent-dispatcher-dynamic-base-'),
    sessionRoot: await makeTempDir('boring-agent-dispatcher-dynamic-sessions-'),
    getWorkspaceId: async (request) => String(request.headers['x-boring-workspace-id'] ?? ''),
    getWorkspaceRoot: async () => workspaceRoot,
    getTrustedWorkspaceRoot,
    getSessionNamespace: ({ request, userId }) => {
      const requestUser = (request as FastifyRequest & { user?: { id: string } } | undefined)?.user?.id
      return `actor-${userId ?? requestUser ?? 'anonymous'}`
    },
    harnessFactory: harness.factory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })

  try {
    const catalog = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/catalog',
      headers: { 'x-boring-workspace-id': 'workspace-dynamic' },
    })
    expect(catalog.statusCode).toBe(200)
    expect(harness.factoryInputs).toHaveLength(1)

    await resolver!.resolve({ workspaceId: 'workspace-dynamic', userId: 'user-dynamic' })
    expect(getTrustedWorkspaceRoot).toHaveBeenCalledWith({ workspaceId: 'workspace-dynamic', userId: 'user-dynamic' })
    expect(harness.factoryInputs).toHaveLength(1)

    await expect(resolver!.resolve(
      { workspaceId: 'workspace-dynamic', userId: 'user-dynamic' },
      { request: {} as FastifyRequest },
    )).resolves.toBeDefined()
    expect(harness.factoryInputs).toHaveLength(1)

    await expect(resolver!.resolve(
      { workspaceId: 'workspace-dynamic', userId: 'user-dynamic' },
      { request: { workspaceContext: { workspaceId: 'other-workspace' } } as FastifyRequest },
    )).rejects.toMatchObject({ code: ErrorCode.enum.UNAUTHORIZED })
  } finally {
    await app.close()
  }
})

test('runtime scope contribution pins prompt content to its identity and workspace', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-runtime-recipe-')
  const harness = createDispatcherTestHarness(); const app = Fastify({ logger: false })
  const loadPrompt = vi.fn(async (workspaceId: string, identity: string) => `${workspaceId}:${identity}`)
  const resolveContribution = vi.fn(async (workspaceId: string, identity: string) => Object.freeze({
    identity, loadSystemPromptAppend: async () => loadPrompt(workspaceId, identity),
  }))
  await app.register(registerAgentRoutes, {
    mode: 'direct', externalPlugins: false, workspaceRoot,
    getWorkspaceId: async (request) => String(request.headers['x-workspace'] ?? ''),
    getWorkspaceRoot: async () => workspaceRoot,
    getRuntimeScopeContribution: async ({ workspaceId, request }) => {
      const identity = String(request?.headers['x-recipe'] ?? 'recipe-1')
      return resolveContribution(workspaceId, identity)
    },
    harnessFactory: harness.factory,
  })
  const request = (workspaceId: string, identity: string) => app.inject({ method: 'GET', url: '/api/v1/agent/catalog',
    headers: { 'x-workspace': workspaceId, 'x-recipe': identity } })
  try {
    expect((await request('workspace-a', 'digest-a')).statusCode).toBe(200)
    expect((await request('workspace-a', 'digest-a')).statusCode).toBe(200)
    expect((await request('workspace-a', 'digest-b')).statusCode).toBe(200)
    expect((await request('workspace-b', 'digest-c')).statusCode).toBe(200)
    expect(harness.factoryInputs.map((input) => input.systemPromptAppend)).toEqual([
      'workspace-a:digest-a', 'workspace-a:digest-b', 'workspace-b:digest-c',
    ])
    expect(resolveContribution).toHaveBeenCalledTimes(4)
    expect(loadPrompt).toHaveBeenCalledTimes(3)
  } finally { await app.close() }
})

test('registerAgentRoutes provisions embedded runtime plugins before host app routes are ready', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-provision-')
  const packageRoot = await createDummyNodeSdkPackage()
  const skillRoot = await createDummySkill()
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    provisionRuntime: async ({ provisioningAdapter, runtimeLayout }) => {
      if (!provisioningAdapter) throw new Error('provisioning adapter required')
      return await provisionWorkspaceRuntime({
        adapter: provisioningAdapter,
        runtimeLayout,
        runtimeHost: testRuntimeHostOperations,
        plugins: [{
          id: 'dummy-sdk-plugin',
          skills: [{ name: 'dummy-sdk-skill', source: skillRoot }],
          provisioning: {
            nodePackages: [{
              id: 'dummy-sdk',
              packageName: 'dummy-node-sdk',
              packageRoot,
              expectedBins: ['dummy-sdk'],
            }],
          },
        }],
      })
    },
  })
  await app.ready()

  try {
    await eventually(async () => {
      await expect(readFile(join(workspaceRoot, '.boring-agent', 'skills', 'dummy-sdk-plugin', 'dummy-sdk-skill', 'SKILL.md'), 'utf8'))
        .resolves.toContain('Dummy SDK')
      await expect(readFile(join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin', 'dummy-sdk'), 'utf8'))
        .resolves.toContain('dummy-sdk')
      const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
      expect(skills.statusCode).toBe(200)
      expect(skills.json().skills.map((skill: { name: string }) => skill.name)).toContain('dummy-sdk-skill')
    }, 15_000)
  } finally {
    await app.close()
  }
}, 15_000)

test('registerAgentRoutes provisions the resolved request workspace, not the host base root', async () => {
  const baseRoot = await makeTempDir('boring-agent-embed-base-root-')
  const workspaceA = await makeTempDir('boring-agent-embed-workspace-a-')
  const packageRoot = await createDummyNodeSdkPackage()
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot: baseRoot,
    mode: 'direct',
    getWorkspaceId: async (request) => String(request.headers['x-boring-workspace-id'] ?? ''),
    getWorkspaceRoot: async (workspaceId) => workspaceId === 'workspace-a' ? workspaceA : baseRoot,
    provisionRuntime: async ({ provisioningAdapter, runtimeLayout }) => {
      if (!provisioningAdapter) throw new Error('provisioning adapter required')
      return await provisionWorkspaceRuntime({
        adapter: provisioningAdapter,
        runtimeLayout,
        runtimeHost: testRuntimeHostOperations,
        plugins: [{
          id: 'dummy-sdk-plugin',
          provisioning: {
            nodePackages: [{
              id: 'dummy-sdk',
              packageName: 'dummy-node-sdk',
              packageRoot,
              expectedBins: ['dummy-sdk'],
            }],
          },
        }],
      })
    },
  })
  await app.ready()

  try {
    const catalog = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/catalog',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
    })
    expect(catalog.statusCode).toBe(200)
    await eventually(async () => {
      await expect(readFile(join(workspaceA, '.boring-agent', 'node', 'node_modules', '.bin', 'dummy-sdk'), 'utf8'))
        .resolves.toContain('dummy-sdk')
    }, 15_000)
    await expect(readFile(join(baseRoot, '.boring-agent', '.gitignore'), 'utf8')).rejects.toThrow()
  } finally {
    await app.close()
  }
}, 15_000)

test('registerAgentRoutes resolves raw file preview workspace from query param', async () => {
  const baseRoot = await makeTempDir('boring-agent-raw-preview-base-')
  const workspaceA = await makeTempDir('boring-agent-raw-preview-a-')
  await writeFile(join(baseRoot, 'chart.png'), 'base-root')
  await writeFile(join(workspaceA, 'chart.png'), 'workspace-a')
  const getWorkspaceId = vi.fn(async (request: { headers: Record<string, unknown> }) => String(request.headers['x-boring-workspace-id'] ?? ''))
  const getWorkspaceRoot = vi.fn(async (workspaceId: string) => workspaceId === 'workspace-a' ? workspaceA : baseRoot)
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot: baseRoot,
    mode: 'direct',
    getWorkspaceId,
    getWorkspaceRoot,
  })
  await app.ready()

  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/raw?path=chart.png&workspaceId=workspace-a',
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('workspace-a')
    expect(getWorkspaceId).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ 'x-boring-workspace-id': 'workspace-a' }),
    }))
    expect(getWorkspaceRoot).toHaveBeenCalledWith('workspace-a', expect.anything())
  } finally {
    await app.close()
  }
})

test('request-scoped ready-status resolves the requested workspace', async () => {
  const baseRoot = await makeTempDir('boring-agent-ready-base-')
  const workspaceA = await makeTempDir('boring-agent-ready-workspace-a-')
  const getWorkspaceId = vi.fn(async (request: { headers: Record<string, unknown> }) => String(request.headers['x-boring-workspace-id'] ?? ''))
  const getWorkspaceRoot = vi.fn(async (workspaceId: string) => workspaceId === 'workspace-a' ? workspaceA : baseRoot)
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot: baseRoot,
    mode: 'direct',
    getWorkspaceId,
    getWorkspaceRoot,
  })
  await app.ready()

  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ready-status',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"state":"ready"')
    expect(getWorkspaceId).toHaveBeenCalledOnce()
    expect(getWorkspaceRoot).toHaveBeenCalledWith('workspace-a', expect.anything())
  } finally {
    await app.close()
  }
})

test('registerAgentRoutes reload reruns provisioning and refreshes skills scope', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-reload-provision-')
  const skillRoot = join(workspaceRoot, 'generated-skills', 'reload-skill')
  async function writeReloadSkill(description: string): Promise<void> {
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), `---\nname: reload-skill\ndescription: ${description}\n---\n`)
  }
  let provisionCalls = 0
  let blockAdmission = false
  const events: string[] = []
  const reloadSession = vi.fn(async () => { events.push('reloadSession'); return true })
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    provisionRuntime: async () => {
      provisionCalls += 1
      if (provisionCalls > 1) events.push('reprovision')
      await writeReloadSkill(provisionCalls === 1 ? 'Before reload.' : 'After reload.')
      return {
        changed: true,
        env: { BORING_AGENT_WORKSPACE_ROOT: workspaceRoot },
        pathEntries: [],
        skillPaths: [dirname(skillRoot)],
      }
    },
    admitEffect: async () => {
      events.push('admit')
      if (blockAdmission) {
        throw new AgentEffectAdmissionError(ADMISSION_ERROR_CODE)
      }
    },
    beforeReload: async () => { events.push('beforeReload') },
    harnessFactory: async () => ({
      id: 'reload-test-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'reload-test', title: 'Reload', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'reload-test', title: 'Reload', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      reloadSession,
      }),
  })
  await app.ready()

  try {
    await eventually(async () => {
      const before = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
      expect(before.statusCode).toBe(200)
      expect(before.json().skills).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'reload-skill', description: 'Before reload.' }),
      ]))
    })

    const reload = await app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: {} })
    expect(reload.statusCode).toBe(200)
    expect(reload.json()).toMatchObject({ ok: true, reloaded: true })
    expect(reloadSession).toHaveBeenCalledWith('default')
    expect(provisionCalls).toBe(2)
    expect(events).toEqual(['admit', 'reprovision', 'beforeReload', 'reloadSession'])

    events.length = 0
    blockAdmission = true
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: {} })
    expect(rejected.statusCode).toBe(500)
    expect(rejected.json()).toMatchObject({ error: { code: ADMISSION_ERROR_CODE } })
    expect(events).toEqual(['admit'])
    expect(provisionCalls).toBe(2)
    expect(reloadSession).toHaveBeenCalledOnce()

    const after = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(after.statusCode).toBe(200)
    expect(after.json().skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'reload-skill', description: 'After reload.' }),
    ]))
  } finally {
    await app.close()
  }
})

test('registerAgentRoutes mounts catalog endpoint on host app', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(res.statusCode).toBe(200)

  const body = res.json()
  const names: string[] = body.tools.map((t: { name: string }) => t.name)
  expect(names).toContain('bash')
  expect(names).toContain('read')

  await app.close()
})

test('registerAgentRoutes rejects mode none without a workspace runtime adapter', async () => {
  const app = Fastify({ logger: false })
  await expect(app.register(registerAgentRoutes, { mode: 'none' })).rejects.toThrow(
    'Runtime mode "none" has no built-in adapter',
  )
  await app.close()
})

test('registerAgentRoutes mounts health endpoint', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-health-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    version: '1.2.3-test',
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json().version).toBe('1.2.3-test')

  await app.close()
})

test('registerAgentRoutes isolates same-root sessions with getSessionNamespace', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-session-namespace-')
  const unique = `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const namespaceDir = (workspaceId: string) => join(homedir(), '.pi', 'agent', 'sessions', `${unique}-${workspaceId}`)
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: async (request) => String(request.headers['x-boring-workspace-id'] ?? ''),
    getWorkspaceRoot: async () => workspaceRoot,
    getSessionNamespace: async ({ workspaceId }) => `${unique}-${workspaceId}`,
  })
  await app.ready()

  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
      payload: { title: 'Workspace A' },
    })
    expect(created.statusCode).toBe(201)

    const workspaceA = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
    })
    expect(workspaceA.json()).toHaveLength(1)

    const workspaceB = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-boring-workspace-id': 'workspace-b' },
    })
    expect(workspaceB.json()).toHaveLength(0)
  } finally {
    await app.close()
    await rm(namespaceDir('workspace-a'), { recursive: true, force: true })
    await rm(namespaceDir('workspace-b'), { recursive: true, force: true })
  }
})

test('registerAgentRoutes treats dynamic session namespace as request scoped', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-session-cache-')
  const unique = `test-agent-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const namespaceDir = (name: string) => join(homedir(), '.pi', 'agent', 'sessions', `${unique}-${name}`)
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getSessionNamespace: async ({ request }) => `${unique}-${String(request?.headers['x-session-namespace'] ?? 'default')}`,
  })
  await app.ready()

  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-session-namespace': 'namespace-a' },
      payload: { title: 'Namespace A' },
    })
    expect(created.statusCode).toBe(201)

    const namespaceA = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-session-namespace': 'namespace-a' },
    })
    expect(namespaceA.json()).toHaveLength(1)

    const namespaceB = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-session-namespace': 'namespace-b' },
    })
    expect(namespaceB.json()).toHaveLength(0)
  } finally {
    await app.close()
    await rm(namespaceDir('namespace-a'), { recursive: true, force: true })
    await rm(namespaceDir('namespace-b'), { recursive: true, force: true })
    await rm(namespaceDir('default'), { recursive: true, force: true })
  }
})

test('registerAgentRoutes mounts sessions endpoint', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-sessions-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })
  expect(res.statusCode).toBe(200)
  expect(Array.isArray(res.json())).toBe(true)

  await app.close()
})

test('registerAgentRoutes does not add its own auth middleware', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-noauth-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  // Without auth middleware, unauthenticated requests should succeed
  // (host app is responsible for authentication)
  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(res.statusCode).toBe(200)

  await app.close()
})

test('registerAgentRoutes coexists with host routes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-coexist-')
  const app = Fastify({ logger: false })

  app.get('/api/v1/host-route', async () => ({ source: 'host' }))

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const hostRes = await app.inject({ method: 'GET', url: '/api/v1/host-route' })
  expect(hostRes.statusCode).toBe(200)
  expect(hostRes.json().source).toBe('host')

  const agentRes = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(agentRes.statusCode).toBe(200)

  await app.close()
})

test('registerAgentRoutes bridges request.user to workspaceContext', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-bridge-')
  const app = Fastify({ logger: false })

  // Simulate core's authHook setting request.user
  app.addHook('onRequest', async (request) => {
    ;(request as any).user = { id: 'user-1', email: 'test@test.dev', name: 'Test' }
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })
  expect(res.statusCode).toBe(200)

  await app.close()
})

test('registerAgentRoutes registers agent capabilities contributor when host supports it', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-capabilities-')
  const app = Fastify({ logger: false })

  const contributors = new Map<
    string,
    (ctx: { config: unknown }) => Record<string, unknown> | Promise<Record<string, unknown>>
  >()

  app.decorate(
    'registerCapabilitiesContributor',
    function (
      this: unknown,
      name: string,
      fn: (ctx: { config: unknown }) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) {
      contributors.set(name, fn)
    },
  )

  app.get('/api/v1/capabilities', async () => {
    const merged: Record<string, unknown> = {}
    for (const fn of contributors.values()) {
      Object.assign(merged, await fn({ config: {} }))
    }
    return merged
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
  expect(res.statusCode).toBe(200)

  const body = res.json() as {
    agent?: { runtimeMode: string; tools: string[]; modelProviders: string[] }
  }
  expect(body.agent).toBeDefined()
  expect(body.agent?.runtimeMode).toBe('direct')
  expect(body.agent?.tools).toContain('bash')
  expect(Array.isArray(body.agent?.modelProviders)).toBe(true)

  await app.close()
})

test('generic agent composition does not special-case provider-specific sandboxes', async () => {
  const files = [
    join(process.cwd(), 'src/server/createAgentApp.ts'),
    join(process.cwd(), 'src/server/registerAgentRoutes.ts'),
    join(process.cwd(), '../boring-bash/src/agent/tools/harness/index.ts'),
    join(process.cwd(), '../boring-bash/src/agent/tools/filesystem/index.ts'),
  ]
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    expect(source).not.toMatch(/vercel|remote-worker|resolvedMode\s*[!=]==\s*['"]vercel-sandbox['"]|sandbox\.provider\s*[!=]==/i)
  }
})

test('createAgentApp has zero runtime imports from @hachej/boring-core', async () => {
  // Read the built output or source to verify no runtime imports from core.
  // We check the source file directly — type-only imports are erased by tsc,
  // so only `import ... from '@hachej/boring-core'` (without `type`) would be a violation.
  const { readFile } = await import('node:fs/promises')
  const { join: pathJoin } = await import('node:path')

  const createAgentAppSrc = await readFile(
    pathJoin(import.meta.dirname, '..', 'createAgentApp.ts'),
    'utf-8',
  )

  // No runtime import from @hachej/boring-core (import type is OK — stripped by tsc)
  const runtimeImportPattern = /^import\s+(?!type\b).*from\s+['"]@boring\/core/gm
  const matches = createAgentAppSrc.match(runtimeImportPattern)
  expect(matches).toBeNull()
})

test('registerAgentRoutes awaits the Agent Host funnel and contains no local construction path', async () => {
  const source = await readFile(join(import.meta.dirname, '..', 'registerAgentRoutes.ts'), 'utf8')
  const hostSource = await readFile(join(import.meta.dirname, '..', 'agent-host', 'createAgentHost.ts'), 'utf8')

  expect(source.match(/\bcreateAgentHost\s*\(/g)).toHaveLength(1)
  expect(source).toMatch(/agentHost\s*=\s*await createAgentHost\s*\(/)
  expect(source).toMatch(/await resolveAgentHostCompatibilityComposition\s*\(/)
  expect(source).not.toMatch(/\b(?:buildAgentComposition|createAgentRuntimeBridge|createCompositionRuntimeBridge|buildHarnessAgentTools|buildFilesystemAgentTools|buildUploadAgentTools|createPiCodingAgentHarness)\s*\(/)
  expect(hostSource.match(/await buildAgentComposition\s*\(/g)).toHaveLength(1)
})

test('registerAgentRoutes has zero runtime imports from @hachej/boring-core', async () => {
  const { readFile } = await import('node:fs/promises')
  const { join: pathJoin } = await import('node:path')

  const registerSrc = await readFile(
    pathJoin(import.meta.dirname, '..', 'registerAgentRoutes.ts'),
    'utf-8',
  )

  const runtimeImportPattern = /^import\s+(?!type\b).*from\s+['"]@boring\/core/gm
  const matches = registerSrc.match(runtimeImportPattern)
  expect(matches).toBeNull()
})

test('extraTools appear in catalog when using registerAgentRoutes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-extra-')
  const app = Fastify({ logger: false })

  const customTool = {
    name: 'echo_test',
    description: 'Echo a message back.',
    parameters: {
      type: 'object' as const,
      properties: { msg: { type: 'string' } },
      required: ['msg'],
    },
    async execute(params: Record<string, unknown>) {
      return { content: [{ type: 'text' as const, text: String(params.msg) }] }
    },
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    extraTools: [customTool],
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().tools.map((t: { name: string }) => t.name)
  expect(names).toContain('bash')
  expect(names).toContain('echo_test')

  await app.close()
})

test('request-scoped catalog includes standard tools', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-dynamic-catalog-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: (request) => {
      const value = request.headers['x-boring-workspace-id']
      return typeof value === 'string' ? value : 'workspace-dynamic'
    },
    getWorkspaceRoot: () => workspaceRoot,
  })
  await app.ready()

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/catalog',
    headers: { 'x-boring-workspace-id': 'workspace-dynamic' },
  })

  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().tools.map((t: { name: string }) => t.name)
  expect(names).toContain('bash')
  expect(names).toContain('read')
  expect(names).toContain('write')

  await app.close()
})

test('request-scoped catalog isolates getExtraTools by authenticated subject', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-auth-extra-')
  const app = Fastify({ logger: false })
  const seen: Array<string | undefined> = []

  app.addHook('onRequest', async (request) => {
    const userId = request.headers['x-test-user-id']
    ;(request as unknown as { user?: { id: string } }).user = typeof userId === 'string' ? { id: userId } : undefined
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getExtraTools: ({ authSubject }) => {
      seen.push(authSubject)
      return [
        {
          name: `mcp_user_${String(authSubject).replace(/-/g, '_')}`,
          description: 'Auth-scoped test tool.',
          parameters: { type: 'object' as const, properties: {} },
          async execute() {
            return { content: [{ type: 'text' as const, text: authSubject ?? '' }] }
          },
        },
      ]
    },
  })
  await app.ready()

  const userA = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog', headers: { 'x-test-user-id': 'user-a' } })
  const userB = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog', headers: { 'x-test-user-id': 'user-b' } })

  expect(userA.statusCode).toBe(200)
  expect(userB.statusCode).toBe(200)
  expect(userA.json().tools.map((tool: { name: string }) => tool.name)).toContain('mcp_user_user_a')
  expect(userA.json().tools.map((tool: { name: string }) => tool.name)).not.toContain('mcp_user_user_b')
  expect(userB.json().tools.map((tool: { name: string }) => tool.name)).toContain('mcp_user_user_b')
  expect(seen).toEqual(['user-a', 'user-b'])

  await app.close()
})

test('request-scoped catalog includes getExtraTools for workspace binding', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-dynamic-extra-')
  const app = Fastify({ logger: false })
  const seen: Array<{ workspaceId: string; runtimeMode: string; fsCapability: string | undefined }> = []

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: (request) => {
      const value = request.headers['x-boring-workspace-id']
      return typeof value === 'string' ? value : 'workspace-dynamic'
    },
    getWorkspaceRoot: () => workspaceRoot,
    getExtraTools: ({ workspaceId, runtimeMode, workspaceFsCapability }) => {
      seen.push({ workspaceId, runtimeMode, fsCapability: workspaceFsCapability })
      return [
        {
          name: `ui_state_${workspaceId.replace(/-/g, '_')}`,
          description: 'Workspace-scoped test tool.',
          parameters: {
            type: 'object' as const,
            properties: {},
          },
          async execute() {
            return { content: [{ type: 'text' as const, text: workspaceId }] }
          },
        },
      ]
    },
  })
  await app.ready()

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/catalog',
    headers: { 'x-boring-workspace-id': 'workspace-dynamic' },
  })

  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().tools.map((t: { name: string }) => t.name)
  expect(names).toContain('ui_state_workspace_dynamic')
  expect(seen).toEqual([{ workspaceId: 'workspace-dynamic', runtimeMode: 'direct', fsCapability: 'strong' }])

  await app.close()
})

test('registerAgentRoutes accepts a custom runtime adapter for pluggable sandbox modes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-custom-adapter-')
  const app = Fastify({ logger: false })
  const customAdapter: RuntimeModeAdapter = {
    id: 'custom-sandbox',
    async create(ctx) {
      const { createNodeWorkspace } = await import('@agent-test-host')
      const { createDirectSandbox } = await import('@agent-test-host')
      const { createServerFileSearch } = await import('../runtime/createServerFileSearch')
      const workspace = createNodeWorkspace(ctx.workspaceRoot)
      const sandbox = createDirectSandbox()
      await sandbox.init?.({ workspace, sessionId: ctx.sessionId })
      return { workspace, sandbox, fileSearch: createServerFileSearch(workspace, sandbox) }
    },
  }
  const seen: string[] = []

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter: customAdapter,
    getExtraTools: ({ runtimeMode, workspaceFsCapability }) => {
      seen.push(`${runtimeMode}:${workspaceFsCapability ?? 'none'}`)
      return []
    },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })

  expect(res.statusCode).toBe(200)
  expect(seen).toEqual(['custom-sandbox:strong'])

  await app.close()
})

test('request-scoped health endpoints do not require workspace header', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-health-scoped-')
  const app = Fastify({ logger: false })
  let scopeChecks = 0

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: () => {
      scopeChecks += 1
      const error = new Error('workspace id is required') as Error & { statusCode: number }
      error.statusCode = 400
      throw error
    },
    getWorkspaceRoot: () => workspaceRoot,
  })
  await app.ready()

  const healthRes = await app.inject({ method: 'GET', url: '/health' })
  expect(healthRes.statusCode).toBe(200)

  const readyRes = await app.inject({ method: 'GET', url: '/ready' })
  expect(readyRes.statusCode).toBe(200)
  expect(scopeChecks).toBe(0)

  await app.close()
})

test('request-scoped routes preserve branded AgentHost scope errors before runtime resolution', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-agent-host-scope-')
  const app = Fastify({ logger: false })
  const getWorkspaceRoot = vi.fn(async () => workspaceRoot)
  const harness = createDispatcherTestHarness()
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { status?: unknown }).status
    const code = (error as { code?: unknown }).code
    return reply.code(typeof status === 'number' ? status : 500).send({ code })
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    externalPlugins: false,
    getWorkspaceId: () => {
      throw Object.assign(new Error(ErrorCode.enum.AGENT_HOST_SCOPE_VIOLATION), {
        status: 421,
        code: ErrorCode.enum.AGENT_HOST_SCOPE_VIOLATION,
      })
    },
    getWorkspaceRoot,
    harnessFactory: harness.factory,
  })

  const response = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(response.statusCode).toBe(421)
  expect(response.json()).toEqual({ code: ErrorCode.enum.AGENT_HOST_SCOPE_VIOLATION })
  expect(getWorkspaceRoot).not.toHaveBeenCalled()
  expect(harness.factoryInputs).toEqual([])
  await app.close()
})

test('request-scoped models endpoint does not require workspace header', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-models-')
  const app = Fastify({ logger: false })
  let scopeChecks = 0

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: (request) => {
      scopeChecks += 1
      const value = request.headers['x-boring-workspace-id']
      if (typeof value !== 'string') {
        const error = new Error('workspace id is required') as Error & { statusCode: number }
        error.statusCode = 400
        throw error
      }
      return value
    },
    getWorkspaceRoot: () => workspaceRoot,
  })
  await app.ready()

  const modelsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/models',
  })
  expect(modelsRes.statusCode).toBe(200)
  expect(scopeChecks).toBe(0)

  const treeRes = await app.inject({
    method: 'GET',
    url: '/api/v1/tree?path=',
  })
  expect(treeRes.statusCode).toBe(400)
  expect(treeRes.json().error.message).toBe('workspace id is required')
  expect(scopeChecks).toBe(1)

  await app.close()
}, 15_000)

test('model filter makes models endpoint workspace-scoped and receives request context', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-filtered-models-')
  const app = Fastify({ logger: false })
  let scopeChecks = 0
  const filterModels = vi.fn(async (ctx, models) => ({ models }))

  app.addHook('onRequest', async (request) => {
    ;(request as typeof request & { user: { id: string; email: string; name: null; emailVerified: boolean } }).user = {
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      emailVerified: true,
    }
  })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    filterModels,
    getWorkspaceId: (request) => {
      scopeChecks += 1
      const value = request.headers['x-boring-workspace-id']
      if (typeof value !== 'string') {
        const error = new Error('workspace id is required') as Error & { statusCode: number }
        error.statusCode = 400
        throw error
      }
      return value
    },
    getWorkspaceRoot: () => workspaceRoot,
  })
  await app.ready()

  const missingScope = await app.inject({ method: 'GET', url: '/api/v1/agent/models' })
  expect(missingScope.statusCode).toBe(400)

  const scoped = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/models',
    headers: { 'x-boring-workspace-id': 'ws-filtered' },
  })
  expect(scoped.statusCode).toBe(200)
  expect(scopeChecks).toBeGreaterThanOrEqual(2)
  expect(filterModels).toHaveBeenCalledTimes(1)
  expect(filterModels.mock.calls[0]?.[0]).toMatchObject({ workspaceId: 'ws-filtered' })
  expect(filterModels.mock.calls[0]?.[0].request.user).toMatchObject({ id: 'user-1' })

  await app.close()
}, 15_000)

test('file routes use request-aware filesystem bindings from registerAgentRoutes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-filtered-files-')
  const app = Fastify({ logger: false })
  const read = vi.fn(async (_target: unknown) => ({ content: 'scoped company file', metadata: { scoped: true } }))
  const getFilesystemBindings = vi.fn(async (ctx) => [{
    filesystem: 'company_context',
    access: 'readonly' as const,
    operations: {
      read,
      list: vi.fn(async () => ({ entries: [], metadata: {} })),
      find: vi.fn(async () => ({ paths: [], metadata: {} })),
      grep: vi.fn(async () => ({ matches: [], metadata: {} })),
      stat: vi.fn(async () => ({ isDirectory: false, metadata: {} })),
      rejectMutation: vi.fn((operation: string) => { throw new Error(`${operation} denied`) }),
    },
  }])

  app.addHook('onRequest', async (request) => {
    ;(request as typeof request & { user: { id: string; email: string; name: null; emailVerified: boolean } }).user = {
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      emailVerified: true,
    }
  })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getFilesystemBindings,
    getWorkspaceId: () => 'ws-files',
    getWorkspaceRoot: () => workspaceRoot,
  })
  await app.ready()

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/files?filesystem=company_context&path=%2Fpolicy.md',
  })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ content: 'scoped company file' })
  expect(getFilesystemBindings).toHaveBeenCalledWith(expect.objectContaining({
    workspaceId: 'ws-files',
    workspaceRoot,
    userId: 'user-1',
    userEmail: 'user@example.com',
  }))
  expect(read).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/policy.md' })

  await app.close()
}, 15_000)

test('request-scoped command endpoints use the workspace harness and request identity', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-commands-')
  const app = Fastify({ logger: false })
  const getSlashCommands = vi.fn(async () => [{ name: 'open-test-panel', source: 'extension' as const }])
  const executeSlashCommand = vi.fn(async () => {})
  let scopeChecks = 0

  app.addHook('onRequest', async (request) => {
    ;(request as typeof request & { user: { id: string; email: string; name: null; emailVerified: boolean } }).user = {
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      emailVerified: true,
    }
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: (request) => {
      scopeChecks += 1
      const value = request.headers['x-boring-workspace-id']
      if (typeof value !== 'string') {
        const error = new Error('workspace id is required') as Error & { statusCode: number }
        error.statusCode = 400
        throw error
      }
      return value
    },
    getWorkspaceRoot: () => workspaceRoot,
    harnessFactory: async () => ({
      id: 'commands-test-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      getSlashCommands,
      executeSlashCommand,
    }),
  })
  await app.ready()

  try {
    const commandsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/commands?sessionId=custom',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
    })
    expect(commandsRes.statusCode).toBe(200)
    expect(commandsRes.json()).toEqual({
      commands: [{ name: 'open-test-panel', source: 'extension' }],
    })
    expect(getSlashCommands).toHaveBeenCalledWith('custom', expect.objectContaining({
      workdir: workspaceRoot,
      workspaceId: 'workspace-a',
      userId: 'user-1',
      userEmail: 'user@example.com',
      userEmailVerified: true,
      requestId: expect.any(String),
    }))

    const executeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/commands/execute?sessionId=custom',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
      payload: { name: 'open-test-panel', args: 'arg1' },
    })
    expect(executeRes.statusCode).toBe(200)
    expect(executeRes.json()).toEqual({ ok: true })
    expect(executeSlashCommand).toHaveBeenCalledWith('custom', 'open-test-panel', 'arg1', expect.objectContaining({
      workdir: workspaceRoot,
      workspaceId: 'workspace-a',
      userId: 'user-1',
      userEmail: 'user@example.com',
      userEmailVerified: true,
      requestId: expect.any(String),
    }))
    expect(scopeChecks).toBe(2)
  } finally {
    await app.close()
  }
}, 15_000)

test('metered command execution rejects commands before harness dispatch', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-metered-commands-')
  const app = Fastify({ logger: false })
  const getSlashCommands = vi.fn(async () => [{ name: 'plan', source: 'prompt' as const }])
  const executeSlashCommand = vi.fn(async () => {})

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    metering: {
      reserveRun: vi.fn(),
      recordUsage: vi.fn(),
      settleRun: vi.fn(),
      releaseRun: vi.fn(),
    },
    harnessFactory: async () => ({
      id: 'metered-commands-test-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'default', title: 'Default', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'default', title: 'Default', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      getSlashCommands,
      executeSlashCommand,
    }),
  })
  await app.ready()

  try {
    const commandsRes = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=default' })
    expect(commandsRes.statusCode).toBe(200)
    expect(commandsRes.json()).toEqual({ commands: [{ name: 'plan', source: 'prompt' }] })

    const executeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/commands/execute?sessionId=default',
      payload: { name: 'plan', args: 'ship it' },
    })
    expect(executeRes.statusCode).toBe(409)
    expect(executeRes.json()).toMatchObject({ error: { code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND } })
    expect(executeSlashCommand).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
}, 15_000)

test('skills endpoint lists Pi-resolved project skills', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-project-')
  const projectSkillDir = join(workspaceRoot, '.pi', 'skills', 'project-skill')
  await mkdir(projectSkillDir, { recursive: true })
  await writeFile(
    join(projectSkillDir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: Project skill visible through Pi resolver.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    // Skill discovery is off by default (withPiHarnessDefaults); hosts that
    // want pi-resolved skills in the picker opt in, like the CLI does.
    pi: { noSkills: false },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('project-skill')

  await app.close()
})

test('skills endpoint discovers workspace .agents/skills when ambient skills are enabled', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-ambient-')
  const skillRoot = join(workspaceRoot, '.agents', 'skills', 'cli-project-skill')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    '---\nname: cli-project-skill\ndescription: Project skill visible in standalone CLI mode.\n---\n# CLI project skill\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    // The standalone CLI's config: ambient discovery on (default is off).
    pi: { noSkills: false },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
  expect(res.statusCode).toBe(200)
  const skill = res.json().skills.find((candidate: { name: string }) => candidate.name === 'cli-project-skill')
  expect(skill).toMatchObject({
    name: 'cli-project-skill',
    filePath: '.agents/skills/cli-project-skill/SKILL.md',
  })

  const fileRes = await app.inject({
    method: 'GET',
    url: `/api/v1/files?path=${encodeURIComponent(skill.filePath)}`,
  })
  expect(fileRes.statusCode).toBe(200)
  expect(fileRes.json().content).toContain('# CLI project skill')

  await app.close()
})

test('skills endpoint does not require unrelated runtime-only dynamic hooks', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-runtime-hooks-')
  const projectSkillDir = join(workspaceRoot, '.pi', 'skills', 'project-skill')
  await mkdir(projectSkillDir, { recursive: true })
  await writeFile(
    join(projectSkillDir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: Project skill visible even when session namespace is unavailable.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: { noSkills: false },
    getSessionNamespace: () => {
      throw new Error('session namespace should not be needed for skill listing')
    },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('project-skill')

  await app.close()
})

test('skills endpoint mirrors noSkills while preserving explicit additional skill paths', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-')
  const projectSkillDir = join(workspaceRoot, '.pi', 'skills', 'project-skill')
  const extraSkillDir = join(workspaceRoot, 'extra-skills', 'extra-skill')
  await mkdir(projectSkillDir, { recursive: true })
  await mkdir(extraSkillDir, { recursive: true })
  await writeFile(
    join(projectSkillDir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: Project skill hidden by noSkills.\n---\n',
    'utf-8',
  )
  await writeFile(
    join(extraSkillDir, 'SKILL.md'),
    '---\nname: extra-skill\ndescription: Explicit extra skill remains visible.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: {
      noSkills: true,
      additionalSkillPaths: [extraSkillDir],
    },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('extra-skill')
  expect(names).not.toContain('project-skill')

  await app.close()
})

test('registerAgentRoutes does NOT expose /api/v1/ui/* (moved to @hachej/boring-workspace)', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-no-ui-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const get = await app.inject({ method: 'GET', url: '/api/v1/ui/state' })
  expect(get.statusCode).toBe(404)
  const put = await app.inject({
    method: 'PUT',
    url: '/api/v1/ui/state',
    payload: { state: {}, causedBy: 'user' },
  })
  expect(put.statusCode).toBe(404)

  await app.close()
})


test('runtimeEnvContributions merge generic host env into sandbox exec without workspace imports', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-runtime-env-contrib-')
  const app = Fastify({ logger: false })
  const execCalls: Array<Record<string, string> | undefined> = []
  const telemetryEvents: unknown[] = []
  const customAdapter: RuntimeModeAdapter = {
    id: 'custom-env-sandbox',
    workspaceFsCapability: 'strong',
    async create(ctx) {
      const { createNodeWorkspace } = await import('@agent-test-host')
      const { createServerFileSearch } = await import('../runtime/createServerFileSearch')
      const runtimeContext = { runtimeCwd: '/workspace' }
      const workspace = createNodeWorkspace(ctx.workspaceRoot)
      const sandbox = {
        id: 'env-sandbox',
        placement: 'server' as const,
        provider: 'custom-env-sandbox',
        capabilities: ['exec'],
        runtimeContext,
        async exec(_cmd: string, opts?: { env?: Record<string, string> }) {
          execCalls.push(opts?.env)
          return { stdout: new TextEncoder().encode('ok'), stderr: new Uint8Array(), exitCode: 0, durationMs: 1, truncated: false }
        },
      }
      return { runtimeContext, workspace, sandbox, fileSearch: createServerFileSearch(workspace, sandbox), bash: { kind: 'remote' } }
    },
  }
  let capturedTools: import('../../shared/tool').AgentTool[] = []
  const harnessFactory = vi.fn(async (input) => {
    capturedTools = input.tools
    return {
      id: 'runtime-env-test-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() { const now = new Date().toISOString(); return { id: 's', title: 'S', createdAt: now, updatedAt: now, turnCount: 0 } },
        async load() { const now = new Date().toISOString(); return { id: 's', title: 'S', createdAt: now, updatedAt: now, turnCount: 0, messages: [] } },
        async delete() {},
      },
      async *sendMessage() {},
    }
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter: customAdapter,
    harnessFactory,
    telemetry: { capture: (event) => { telemetryEvents.push(event) } },
    runtimeEnvContributions: [{ id: 'generic-test', getEnv: () => ({ GENERIC_TEST_ENV: 'yes' }) }],
  })
  await app.ready()
  await capturedTools.find((tool) => tool.name === 'bash')!.execute(
    { command: 'echo ok' },
    { abortSignal: new AbortController().signal, toolCallId: 'tool-env' },
  )

  expect(execCalls[0]).toMatchObject({ GENERIC_TEST_ENV: 'yes' })
  expect(telemetryEvents).toContainEqual(expect.objectContaining({
    name: 'agent.runtime.env_contributed',
    properties: expect.objectContaining({ contributionIds: ['generic-test'] }),
  }))
  expect(JSON.stringify(telemetryEvents)).not.toContain('yes')
  expect(JSON.stringify(telemetryEvents)).not.toContain('GENERIC_TEST_ENV')
  await app.close()
})
