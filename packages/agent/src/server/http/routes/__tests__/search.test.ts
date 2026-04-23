import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { FileSearch } from '../../../../shared/file-search'
import { ERROR_CODE_VALIDATION_ERROR, ERROR_CODE_INTERNAL } from '../../middleware'
import { searchRoutes } from '../search'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
})

function createMockFileSearch(results: string[] = []): FileSearch {
  return { search: vi.fn().mockResolvedValue(results) }
}

async function createTestApp(
  fileSearch?: FileSearch,
): Promise<{ app: FastifyInstance; fileSearch: FileSearch }> {
  const fs = fileSearch ?? createMockFileSearch()
  const app = Fastify({ logger: false })
  await app.register(searchRoutes, { fileSearch: fs })
  await app.ready()
  apps.push(app)
  return { app, fileSearch: fs }
}

describe('GET /api/v1/files/search', () => {
  test('returns matching files', async () => {
    const { app, fileSearch } = await createTestApp(
      createMockFileSearch(['src/index.ts', 'src/utils.ts']),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.ts',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ results: ['src/index.ts', 'src/utils.ts'] })
    expect(fileSearch.search).toHaveBeenCalledWith('*.ts', 500)
  })

  test('passes custom limit', async () => {
    const { app, fileSearch } = await createTestApp(createMockFileSearch([]))

    await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.js&limit=100',
    })

    expect(fileSearch.search).toHaveBeenCalledWith('*.js', 100)
  })

  test('clamps limit to max 5000', async () => {
    const { app, fileSearch } = await createTestApp(createMockFileSearch([]))

    await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*&limit=99999',
    })

    expect(fileSearch.search).toHaveBeenCalledWith('*', 5000)
  })

  test('defaults limit when invalid', async () => {
    const { app, fileSearch } = await createTestApp(createMockFileSearch([]))

    await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*&limit=abc',
    })

    expect(fileSearch.search).toHaveBeenCalledWith('*', 500)
  })

  test('400 when q is missing', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)
  })

  test('400 when q contains null bytes', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=foo%00bar',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)
  })

  test('400 when q exceeds 256 chars', async () => {
    const { app } = await createTestApp()
    const longQ = 'a'.repeat(257)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/files/search?q=${longQ}`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)
  })

  test('500 when fileSearch throws', async () => {
    const failSearch: FileSearch = {
      search: vi.fn().mockRejectedValue(new Error('timeout')),
    }
    const { app } = await createTestApp(failSearch)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.ts',
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe(ERROR_CODE_INTERNAL)
  })
})
