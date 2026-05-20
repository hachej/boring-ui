import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import Fastify from 'fastify'

import { registerAgentRoutes } from '../registerAgentRoutes'
import type { RuntimeModeAdapter } from '../runtime/mode'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

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
      url: '/api/v1/agent/sessions',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
      payload: { title: 'Workspace A' },
    })
    expect(created.statusCode).toBe(200)

    const workspaceA = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions',
      headers: { 'x-boring-workspace-id': 'workspace-a' },
    })
    expect(workspaceA.json()).toHaveLength(1)

    const workspaceB = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions',
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
      url: '/api/v1/agent/sessions',
      headers: { 'x-session-namespace': 'namespace-a' },
      payload: { title: 'Namespace A' },
    })
    expect(created.statusCode).toBe(200)

    const namespaceA = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions',
      headers: { 'x-session-namespace': 'namespace-a' },
    })
    expect(namespaceA.json()).toHaveLength(1)

    const namespaceB = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions',
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

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/sessions' })
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

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/sessions' })
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
      const { createNodeWorkspace } = await import('../workspace/createNodeWorkspace')
      const { createDirectSandbox } = await import('../sandbox/direct/createDirectSandbox')
      const { createServerFileSearch } = await import('../runtime/createServerFileSearch')
      const runtimeContext = { runtimeCwd: '/workspace' }
      const workspace = createNodeWorkspace(ctx.workspaceRoot, { runtimeContext })
      const sandbox = createDirectSandbox({ runtimeContext })
      await sandbox.init?.({ workspace, sessionId: ctx.sessionId })
      return { runtimeContext, workspace, sandbox, fileSearch: createServerFileSearch(workspace, sandbox) }
    },
  }
  const seen: string[] = []
  const harnessFactory = vi.fn(async (input) => ({
    id: 'custom-test-harness',
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
    async *sendMessage() {},
  }))

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter: customAdapter,
    harnessFactory,
    getExtraTools: ({ runtimeMode, workspaceFsCapability }) => {
      seen.push(`${runtimeMode}:${workspaceFsCapability ?? 'none'}`)
      return []
    },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })

  expect(res.statusCode).toBe(200)
  expect(seen).toEqual(['custom-sandbox:strong'])
  expect(harnessFactory).toHaveBeenCalledTimes(1)
  expect(harnessFactory.mock.calls[0]?.[0].cwd).toBe(workspaceRoot)
  expect(harnessFactory.mock.calls[0]?.[0].runtimeCwd).toBe('/workspace')

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
})

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
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('project-skill')

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
