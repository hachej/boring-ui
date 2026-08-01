import Fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import type { AuthorizedAgentScope } from '../../../shared/index'
import type { Workspace } from '../../../shared/workspace'
import { registerAgentHostEnvironmentRoutes } from '../environmentHttpProjection'
import type { CreatedAgentHost } from '../types'

describe('direct Agent Host Environment HTTP projection', () => {
  test('one finite request acquires one lease and releases it after the response', async () => {
    const release = vi.fn()
    const workspace = {
      root: '/workspace',
      fsCapability: 'strong',
      async stat() { return { kind: 'file' as const, size: 5, mtimeMs: 1 } },
      async readFile() { return 'hello' },
    } as unknown as Workspace
    const acquireEnvironment = vi.fn(async () => ({
      workspace,
      gitWorkspace: workspace,
      fileSearch: { async search() { return [] } },
      readiness: {
        chat: { state: 'not-started' as const },
        workspace: { state: 'ready' as const },
        runtimeDependencies: { state: 'ready' as const },
      },
      signal: new AbortController().signal,
      release,
    }))
    const created = { acquireEnvironment } as unknown as CreatedAgentHost
    const scope = Object.freeze({ workspaceScopeId: 'workspace', authSubjectId: 'actor' }) as AuthorizedAgentScope
    const app = Fastify({ logger: false })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async () => scope,
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/files?path=note.txt' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ content: 'hello' })
    expect(acquireEnvironment).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    await app.close()
  })
})
