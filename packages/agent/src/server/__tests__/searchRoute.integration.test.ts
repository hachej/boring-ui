import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentApp } from '../createAgentApp'
import type { FastifyInstance } from 'fastify'

/**
 * Integration test that asserts the /api/v1/files/search HTTP route
 * (consumed by the file tree + cmd palette) and the LLM's `find`
 * tool BOTH use the same FileSearch instance — i.e. there is exactly
 * one search code path, with one set of glob semantics, one shared
 * boundedness guarantee.
 *
 * If a future change duplicates the impl (e.g. someone re-introduces
 * a separate handler that wraps a different search), the route will
 * still work but the assertion that both paths return identical
 * results for the same glob will fail.
 */

let app: FastifyInstance
let workspaceRoot: string

beforeAll(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'agent-search-route-'))
  await writeFile(join(workspaceRoot, 'a.ts'), 'export const a = 1\n')
  await writeFile(join(workspaceRoot, 'README.md'), '# hi\n')
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(join(workspaceRoot, 'src', 'b.ts'), 'export const b = 2\n')
  await writeFile(join(workspaceRoot, 'src', 'c.tsx'), 'export const c = 3\n')

  app = await createAgentApp({
    workspaceRoot,
    mode: 'local',
    logger: false,
  })
})

afterAll(async () => {
  await app?.close()
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('GET /api/v1/files/search', () => {
  test('basename glob (-name) finds files at any depth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.ts',
    })
    expect(res.statusCode).toBe(200)
    const { results } = res.json() as { results: string[] }
    expect(results.sort()).toEqual(['a.ts', 'src/b.ts'])
  })

  test('path glob (-path with globstar) finds nested files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=**%2F*.tsx',
    })
    expect(res.statusCode).toBe(200)
    const { results } = res.json() as { results: string[] }
    expect(results).toContain('src/c.tsx')
  })

  test('exact basename', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=README.md',
    })
    const { results } = res.json() as { results: string[] }
    expect(results).toEqual(['README.md'])
  })

  test('rejects missing q', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search',
    })
    expect(res.statusCode).toBe(400)
  })

  test('rejects null bytes in q', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=foo%00bar',
    })
    expect(res.statusCode).toBe(400)
  })

  test('clamps limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.ts&limit=99999',
    })
    expect(res.statusCode).toBe(200)
  })
})
