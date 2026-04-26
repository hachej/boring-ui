import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import Fastify from 'fastify'

import { registerAgentRoutes } from '../registerAgentRoutes'

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

test('createAgentApp has zero runtime imports from @boring/core', async () => {
  // Read the built output or source to verify no runtime imports from core.
  // We check the source file directly — type-only imports are erased by tsc,
  // so only `import ... from '@boring/core'` (without `type`) would be a violation.
  const { readFile } = await import('node:fs/promises')
  const { join: pathJoin } = await import('node:path')

  const createAgentAppSrc = await readFile(
    pathJoin(import.meta.dirname, '..', 'createAgentApp.ts'),
    'utf-8',
  )

  // No runtime import from @boring/core (import type is OK — stripped by tsc)
  const runtimeImportPattern = /^import\s+(?!type\b).*from\s+['"]@boring\/core/gm
  const matches = createAgentAppSrc.match(runtimeImportPattern)
  expect(matches).toBeNull()
})

test('registerAgentRoutes has zero runtime imports from @boring/core', async () => {
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

test('UI bridge routes work through registerAgentRoutes', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-ui-')
  const app = Fastify({ logger: false })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
  })
  await app.ready()

  const getRes = await app.inject({ method: 'GET', url: '/api/v1/ui/state' })
  expect(getRes.statusCode).toBe(200)
  expect(getRes.json()).toEqual({})

  const putRes = await app.inject({
    method: 'PUT',
    url: '/api/v1/ui/state',
    payload: { state: { foo: 'bar' }, causedBy: 'user' },
  })
  expect(putRes.statusCode).toBe(204)

  const getAfter = await app.inject({ method: 'GET', url: '/api/v1/ui/state' })
  expect(getAfter.json()).toEqual({ foo: 'bar' })

  await app.close()
})
