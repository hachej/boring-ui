import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeFilesystemBinding } from '../../agent/runtime/types'
import { searchRoutes } from './search'

function binding(
  filesystem: string,
  find: RuntimeFilesystemBinding['operations']['find'],
): RuntimeFilesystemBinding {
  return {
    filesystem,
    access: 'readonly',
    operations: {
      read: vi.fn(),
      list: vi.fn(),
      find,
      grep: vi.fn(),
      stat: vi.fn(),
      rejectMutation: vi.fn(() => { throw new Error('readonly') }),
    },
  }
}

describe('searchRoutes multi-filesystem search', () => {
  it('returns qualified duplicate paths from the user root and virtual bindings', async () => {
    const find = vi.fn(async () => ({ paths: ['same.md', 'company-only.md'] }))
    const app = Fastify()
    await app.register(searchRoutes, {
      fileSearch: { search: vi.fn(async () => ['same.md', 'user-only.md']) },
      filesystemBindings: [binding('company_context', find)],
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.md&limit=10',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      resources: [
        { filesystem: 'user', path: 'same.md' },
        { filesystem: 'company_context', path: 'same.md' },
        { filesystem: 'user', path: 'user-only.md' },
        { filesystem: 'company_context', path: 'company-only.md' },
      ],
    })
    expect(find).toHaveBeenCalledWith(
      { filesystem: 'company_context', path: '/' },
      '*.md',
      { limit: 10 },
    )
    await app.close()
  })

  it('uses the first exact filesystem binding, excludes user shadows, and searches each identity once', async () => {
    const firstFind = vi.fn(async () => ({ paths: ['/first.md'] }))
    const duplicateFind = vi.fn(async () => ({ paths: ['/duplicate.md'] }))
    const userShadowFind = vi.fn(async () => ({ paths: ['/shadow.md'] }))
    const caseDistinctFind = vi.fn(async () => ({ paths: ['/case-distinct.md'] }))
    const app = Fastify()
    await app.register(searchRoutes, {
      fileSearch: { search: vi.fn(async () => ['workspace.md']) },
      filesystemBindings: [
        binding('docs', firstFind),
        binding('docs', duplicateFind),
        binding('user', userShadowFind),
        binding('Docs', caseDistinctFind),
      ],
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/files/search?q=*.md&limit=10' })

    expect(response.json().resources).toEqual([
      { filesystem: 'user', path: 'workspace.md' },
      { filesystem: 'docs', path: '/first.md' },
      { filesystem: 'Docs', path: '/case-distinct.md' },
    ])
    expect(firstFind).toHaveBeenCalledOnce()
    expect(duplicateFind).not.toHaveBeenCalled()
    expect(userShadowFind).not.toHaveBeenCalled()
    expect(caseDistinctFind).toHaveBeenCalledOnce()
    await app.close()
  })

  it('uses request-visible bindings and omits bindings whose operation denies search', async () => {
    const allowedFind = vi.fn(async () => ({ paths: ['/visible.md'] }))
    const deniedFind = vi.fn(async () => { throw new Error('/host/private must not leak') })
    const getFilesystemBindings = vi.fn(async (request: { headers: Record<string, unknown> }) => (
      request.headers['x-allow-company'] === 'yes'
        ? [binding('company_context', allowedFind), binding('denied', deniedFind)]
        : []
    ))
    const app = Fastify()
    await app.register(searchRoutes, {
      fileSearch: { search: vi.fn(async () => []) },
      getFilesystemBindings,
    })

    const deniedResponse = await app.inject({ method: 'GET', url: '/api/v1/files/search?q=*.md' })
    expect(deniedResponse.json()).toEqual({ resources: [] })

    const allowedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.md',
      headers: { 'x-allow-company': 'yes' },
    })
    expect(allowedResponse.json()).toEqual({
      resources: [{ filesystem: 'company_context', path: '/visible.md' }],
    })
    expect(allowedResponse.body).not.toContain('/host/private')
    expect(allowedFind).toHaveBeenCalledOnce()
    expect(deniedFind).toHaveBeenCalledOnce()
    await app.close()
  })
})
