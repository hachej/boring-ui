import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeFilesystemBinding } from '../../agent/runtime/types'
import { filesystemsRoutes } from './filesystems'

function operations(overrides: Partial<RuntimeFilesystemBinding['operations']> = {}): RuntimeFilesystemBinding['operations'] {
  return {
    read: vi.fn(),
    list: vi.fn(),
    find: vi.fn(),
    grep: vi.fn(),
    stat: vi.fn(),
    rejectMutation: vi.fn(() => { throw new Error('readonly') }),
    ...overrides,
  }
}

function binding(input: Partial<RuntimeFilesystemBinding> & Pick<RuntimeFilesystemBinding, 'filesystem'>): RuntimeFilesystemBinding {
  return {
    access: 'readonly',
    operations: operations(),
    ...input,
  }
}

describe('filesystemsRoutes', () => {
  it('always returns the primary user workspace without host paths', async () => {
    const app = Fastify()
    await app.register(filesystemsRoutes, {})

    const response = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      filesystems: [{
        filesystem: 'user',
        label: 'Workspace',
        rootDir: '.',
        access: 'readwrite',
        capabilities: { read: true, list: true, search: true, write: true, upload: true, delete: true, move: true, mkdir: true },
      }],
    })
    await app.close()
  })

  it('derives fine-grained capabilities from effective access and operation presence', async () => {
    const app = Fastify()
    await app.register(filesystemsRoutes, {
      filesystemBindings: [
        binding({
          filesystem: 'readonly_docs',
          operations: operations({ write: vi.fn(), delete: vi.fn() }),
        }),
        binding({
          filesystem: 'partial',
          access: 'readwrite',
          operations: operations({ write: vi.fn(), move: vi.fn() }),
        }),
      ],
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
    const [, readonly, partial] = response.json().filesystems
    expect(readonly).toEqual({
      filesystem: 'readonly_docs',
      label: 'readonly_docs',
      rootDir: '/',
      access: 'readonly',
      capabilities: { read: true, list: true, search: true, write: false, upload: false, delete: false, move: false, mkdir: false },
    })
    expect(partial).toEqual({
      filesystem: 'partial',
      label: 'partial',
      rootDir: '/',
      access: 'readwrite',
      capabilities: { read: true, list: true, search: true, write: true, upload: false, delete: false, move: true, mkdir: false },
    })
    await app.close()
  })

  it('advertises exact upload only when the primary binding supports create and replace', async () => {
    const app = Fastify()
    await app.register(filesystemsRoutes, {
      filesystemBindings: [binding({
        filesystem: 'user',
        access: 'readwrite',
        operations: operations({ write: vi.fn(), writeBinary: vi.fn(), createBinary: vi.fn() }),
      })],
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
    expect(response.json().filesystems[0].capabilities).toMatchObject({ write: true, upload: true })
    await app.close()
  })

  it.each([
    { label: 'exclusive create', binary: { writeBinary: vi.fn() } },
    { label: 'binary replace', binary: { createBinary: vi.fn() } },
  ])('reports upload unavailable without $label', async ({ binary }) => {
    const app = Fastify()
    await app.register(filesystemsRoutes, {
      filesystemBindings: [binding({
        filesystem: 'user',
        access: 'readwrite',
        operations: operations({ write: vi.fn(), ...binary }),
      })],
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
    expect(response.json().filesystems[0].capabilities).toMatchObject({ write: true, upload: false })
    await app.close()
  })

  it('uses first-binding identity semantics and ignores user shadows and invalid identities', async () => {
    const app = Fastify()
    await app.register(filesystemsRoutes, {
      filesystemBindings: [
        binding({ filesystem: 'user' }),
        binding({ filesystem: 'docs' }),
        binding({ filesystem: 'docs' }),
        binding({ filesystem: 'bad\nidentity' }),
      ],
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/filesystems' })
    expect(response.json().filesystems).toHaveLength(2)
    expect(response.json().filesystems[1]).toMatchObject({ filesystem: 'docs', label: 'docs', rootDir: '/' })
    await app.close()
  })

  it('resolves independently per request and redacts resolver failures', async () => {
    const resolver = vi.fn(async (request: { headers: Record<string, unknown> }) => {
      if (request.headers['x-crash']) throw new Error('policy /host/secret for tenant-internal-id')
      return request.headers['x-user'] === 'allowed' ? [binding({ filesystem: 'allowed_docs' })] : []
    })
    const app = Fastify({ logger: false })
    await app.register(filesystemsRoutes, { getFilesystemBindings: resolver })

    const denied = await app.inject({ method: 'GET', url: '/api/v1/filesystems', headers: { 'x-user': 'denied' } })
    const allowed = await app.inject({ method: 'GET', url: '/api/v1/filesystems', headers: { 'x-user': 'allowed' } })
    const failed = await app.inject({ method: 'GET', url: '/api/v1/filesystems', headers: { 'x-crash': 'yes' } })

    expect(denied.body).not.toContain('allowed_docs')
    expect(allowed.body).toContain('allowed_docs')
    expect(failed.statusCode).toBe(500)
    expect(failed.json()).toEqual({ error: { code: 'internal', message: 'filesystem catalog failed' } })
    expect(failed.body).not.toContain('/host/secret')
    expect(failed.body).not.toContain('tenant-internal-id')
    expect(resolver).toHaveBeenCalledTimes(3)
    await app.close()
  })
})
