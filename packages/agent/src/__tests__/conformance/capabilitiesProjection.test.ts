import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, expect, test } from 'vitest'

import { registerAgentRoutes } from '../../server/registerAgentRoutes'
import type { AgentHarness, AgentHarnessFactoryInput } from '../../shared/harness'
import type { ResolvedAgentCapabilities } from '../../shared/capabilities'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '../../shared/session'
import type { AgentTool } from '../../shared/tool'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

class TestSessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private created = 0

  async list(_ctx: SessionCtx): Promise<SessionSummary[]> {
    return [...this.records.values()]
  }

  async create(_ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    this.created += 1
    const now = new Date().toISOString()
    const summary = {
      id: `capabilities-session-${this.created}`,
      title: init?.title ?? 'Capabilities session',
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    }
    this.records.set(summary.id, summary)
    return summary
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`missing session ${sessionId}`)
    return record
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
  }
}

function createHarnessFactory(): (input: AgentHarnessFactoryInput) => Promise<AgentHarness> {
  const sessions = new TestSessionStore()
  return async () => ({
    id: 'capabilities-projection-test-harness',
    placement: 'server',
    sessions,
  })
}

function createTool(name: string): AgentTool {
  return {
    name,
    description: `${name} test tool.`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: name }] }
    },
  }
}

async function createCapabilitiesApp() {
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

  return app
}

async function readAgentCapabilities(app: Awaited<ReturnType<typeof createCapabilitiesApp>>) {
  const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as {
    agent?: ResolvedAgentCapabilities & { modelProviders: string[] }
  }
  expect(body.agent).toBeDefined()
  return body.agent!
}

async function readCatalogToolNames(app: Awaited<ReturnType<typeof createCapabilitiesApp>>) {
  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  expect(res.statusCode).toBe(200)
  return (res.json() as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)
}

test('capabilities projection reports honest pure-mode facts from the route seam', async () => {
  const app = await createCapabilitiesApp()
  const sessionRoot = await makeTempDir('boring-agent-capabilities-pure-session-')
  const pureTool = createTool('pure_capability_echo')

  await app.register(registerAgentRoutes, {
    mode: 'none',
    sessionRoot,
    harnessFactory: createHarnessFactory(),
    extraTools: [pureTool],
  })
  await app.ready()

  try {
    const capabilities = await readAgentCapabilities(app)
    const catalogToolNames = await readCatalogToolNames(app)

    expect(capabilities).toMatchObject({
      v: 1,
      runtimeMode: 'none',
      environments: [],
      skills: [],
      mcpServers: [],
    })
    expect(capabilities.tools).toEqual(catalogToolNames)
    expect(capabilities.tools).toEqual(['pure_capability_echo'])
    expect(capabilities.modelProviders).toEqual(expect.any(Array))
  } finally {
    await app.close()
  }
})

test('capabilities projection reports coarse filesystem-mode facts from the route seam', async () => {
  const app = await createCapabilitiesApp()
  const workspaceRoot = await makeTempDir('boring-agent-capabilities-direct-workspace-')
  const directTool = createTool('direct_capability_echo')

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    externalPlugins: false,
    harnessFactory: createHarnessFactory(),
    extraTools: [directTool],
  })
  await app.ready()

  try {
    const capabilities = await readAgentCapabilities(app)
    const catalogToolNames = await readCatalogToolNames(app)

    expect(capabilities).toMatchObject({
      v: 1,
      runtimeMode: 'direct',
      environments: [
        {
          id: 'user',
          filesystem: {
            access: 'readwrite',
            acceptsInputAssets: true,
            defaultInputAssetSink: true,
          },
          tools: ['read', 'write', 'edit', 'find', 'grep', 'ls', 'bash'],
          provider: 'direct',
        },
      ],
      skills: [],
      mcpServers: [],
    })
    expect(capabilities.tools).toEqual(catalogToolNames)
    expect(capabilities.tools).toContain('bash')
    expect(capabilities.tools).toContain('read')
    expect(capabilities.tools).toContain('direct_capability_echo')
    expect(capabilities.modelProviders).toEqual(expect.any(Array))
  } finally {
    await app.close()
  }
})
