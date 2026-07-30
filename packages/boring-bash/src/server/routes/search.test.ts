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
      results: ['same.md', 'user-only.md'],
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
    expect(deniedResponse.json()).toEqual({ results: [], resources: [] })

    const allowedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.md',
      headers: { 'x-allow-company': 'yes' },
    })
    expect(allowedResponse.json()).toEqual({
      results: [],
      resources: [{ filesystem: 'company_context', path: '/visible.md' }],
    })
    expect(allowedResponse.body).not.toContain('/host/private')
    expect(allowedFind).toHaveBeenCalledOnce()
    expect(deniedFind).toHaveBeenCalledOnce()
    await app.close()
  })
})
