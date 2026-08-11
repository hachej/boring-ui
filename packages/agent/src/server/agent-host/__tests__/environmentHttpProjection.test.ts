import Fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import type { AuthorizedAgentScope } from '../../../shared/index'
import type { Workspace } from '../../../shared/workspace'
import type { RuntimeFilesystemBinding } from '../../runtime/mode'
import { registerAgentHostEnvironmentRoutes } from '../environmentHttpProjection'
import type { CreatedAgentHost } from '../types'

function deferred<T>() {
  let resolve!: (value?: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = (value) => resolvePromise(value as T)
  })
  return { promise, resolve }
}

async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(assertion, { timeout: 5_000, interval: 10 })
}

function environmentLease(
  workspace: Workspace,
  release: () => void,
  fileSearch: unknown = { async search() { return [] } },
  filesystemBindings?: RuntimeFilesystemBinding[],
) {
  return {
    workspace,
    gitWorkspace: workspace,
    fileSearch,
    filesystemBindings,
    readiness: {
      chat: { state: 'not-started' as const },
      workspace: { state: 'ready' as const },
      runtimeDependencies: { state: 'ready' as const },
    },
    signal: new AbortController().signal,
    release,
  }
}

describe('direct Agent Host Environment HTTP projection', () => {
  test('one finite request acquires one lease and releases it after the response', async () => {
    const release = vi.fn()
    const workspace = {
      root: '/workspace',
      fsCapability: 'strong',
      async stat() { return { kind: 'file' as const, size: 5, mtimeMs: 1 } },
      async readFile() { return 'hello' },
    } as unknown as Workspace
    const acquireEnvironment = vi.fn(async () => environmentLease(workspace, release))
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

  test('catalog and search project the same request-authorized filesystem bindings', async () => {
    const release = vi.fn()
    const workspace = { root: '/workspace', fsCapability: 'strong' } as unknown as Workspace
    const binding: RuntimeFilesystemBinding = {
      filesystem: 'company_context',
      access: 'readonly',
      provenance: 'agent-definition',
      operations: {
        async read() { return { content: 'company' } },
        async list() { return { entries: ['duplicate.md'] } },
        async find() { return { paths: ['/duplicate.md'] } },
        async grep() { return { matches: [] } },
        async stat() { return { isDirectory: false } },
        rejectMutation() { throw new Error('readonly') },
      },
    }
    const acquireEnvironment = vi.fn(async () => environmentLease(
      workspace,
      release,
      { async search() { return ['duplicate.md'] } },
      [binding],
    ))
    const created = { acquireEnvironment } as unknown as CreatedAgentHost
    const scope = Object.freeze({ workspaceScopeId: 'workspace', authSubjectId: 'actor' }) as AuthorizedAgentScope
    const app = Fastify({ logger: false })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async () => scope,
    })

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json().filesystems).toEqual([
      expect.objectContaining({ filesystem: 'user', rootDir: '.', access: 'readwrite' }),
      expect.objectContaining({
        filesystem: 'company_context',
        label: 'company_context',
        rootDir: '/',
        access: 'readonly',
        provenance: 'agent-definition',
        capabilities: expect.objectContaining({ read: true, list: true, search: true, write: false }),
      }),
    ])

    const search = await app.inject({ method: 'GET', url: '/api/v1/files/search?q=duplicate' })
    expect(search.statusCode).toBe(200)
    expect(search.json()).toEqual({
      resources: [
        { filesystem: 'user', path: 'duplicate.md' },
        { filesystem: 'company_context', path: '/duplicate.md' },
      ],
    })
    expect(acquireEnvironment).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledTimes(2)
    await app.close()
  })

  test('request abort waits for a finite raw operation before releasing its lease', async () => {
    const release = vi.fn()
    const searchStarted = deferred<void>()
    const finishSearch = deferred<void>()
    let activeRequest: import('fastify').FastifyRequest | undefined
    const workspace = { root: '/workspace', fsCapability: 'strong' } as unknown as Workspace
    const created = {
      acquireEnvironment: vi.fn(async () => environmentLease(workspace, release, {
        async search() {
          searchStarted.resolve()
          await finishSearch.promise
          return []
        },
      })),
    } as unknown as CreatedAgentHost
    const app = Fastify({ logger: false })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async (request) => {
        activeRequest = request
        return Object.freeze({ workspaceScopeId: 'workspace', authSubjectId: 'actor' }) as AuthorizedAgentScope
      },
    })

    const response = app.inject({ method: 'GET', url: '/api/v1/files/search?q=held' })
    await searchStarted.promise
    activeRequest!.raw.emit('aborted')
    expect(release).not.toHaveBeenCalled()
    finishSearch.resolve()
    expect((await response).statusCode).toBe(200)
    expect(release).toHaveBeenCalledOnce()
    await app.close()
  })

  test('fs stream owns its lease until transport close', async () => {
    const release = vi.fn()
    const unsubscribe = vi.fn()
    const subscribed = deferred<void>()
    let activeRequest: import('fastify').FastifyRequest | undefined
    let activeReply: import('fastify').FastifyReply | undefined
    const workspace = {
      root: '/workspace',
      fsCapability: 'strong',
      watch() {
        return { subscribe: vi.fn(() => { subscribed.resolve(); return unsubscribe }), close() {} }
      },
    } as unknown as Workspace
    const created = {
      acquireEnvironment: vi.fn(async () => environmentLease(workspace, release)),
    } as unknown as CreatedAgentHost
    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (_request, reply) => { activeReply = reply })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async (request) => {
        activeRequest = request
        return Object.freeze({ workspaceScopeId: 'workspace', authSubjectId: 'actor' }) as AuthorizedAgentScope
      },
    })
    const response = app.inject({ method: 'GET', url: '/api/v1/fs/events' })
    await subscribed.promise
    expect(release).not.toHaveBeenCalled()
    // IncomingMessage `close` means request completion on modern Node. It is
    // not proof that the still-open response transport has closed.
    activeRequest!.raw.emit('close')
    expect(release).not.toHaveBeenCalled()
    try { activeReply!.raw.emit('close') } catch { /* inject reports the simulated transport loss */ }
    try { activeReply!.raw.end() } catch { /* transport is already closed */ }
    await response.catch(() => undefined)
    await eventually(() => expect(release).toHaveBeenCalledOnce())
    await eventually(() => expect(unsubscribe).toHaveBeenCalledOnce())
    await app.close()
  }, 15_000)

  test('stream close during acquisition releases a late lease without subscribing', async () => {
    const release = vi.fn()
    const acquireStarted = deferred<void>()
    const finishAcquire = deferred<ReturnType<typeof environmentLease>>()
    const subscribe = vi.fn(() => vi.fn())
    let activeRequest: import('fastify').FastifyRequest | undefined
    let activeReply: import('fastify').FastifyReply | undefined
    const workspace = {
      root: '/workspace',
      fsCapability: 'strong',
      watch() { return { subscribe, close() {} } },
    } as unknown as Workspace
    const created = {
      acquireEnvironment: vi.fn(async () => {
        acquireStarted.resolve()
        return await finishAcquire.promise
      }),
    } as unknown as CreatedAgentHost
    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (_request, reply) => { activeReply = reply })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async (request) => {
        activeRequest = request
        return Object.freeze({ workspaceScopeId: 'workspace', authSubjectId: 'actor' }) as AuthorizedAgentScope
      },
    })
    const request = app.inject({ method: 'GET', url: '/api/v1/fs/events' })
    await acquireStarted.promise
    activeRequest!.raw.emit('aborted')
    try { activeReply!.raw.emit('close') } catch { /* inject reports the simulated transport loss */ }
    finishAcquire.resolve(environmentLease(workspace, release))
    await request.catch(() => undefined)
    await eventually(() => expect(release).toHaveBeenCalledOnce())
    expect(subscribe).not.toHaveBeenCalled()
    await app.close()
  }, 15_000)
})
