import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createNodeWorkspace } from '../../../workspace/createNodeWorkspace'
import { fileRoutes } from '../file'

const tempRoots: string[] = []
const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true })
    }),
  )
})

async function createTestApp(): Promise<{ app: FastifyInstance; workspaceRoot: string }> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-file-routes-'))
  tempRoots.push(workspaceRoot)

  const workspace = createNodeWorkspace(workspaceRoot)
  const app = Fastify({ logger: false })
  await app.register(fileRoutes, { workspace })
  await app.ready()
  apps.push(app)

  return { app, workspaceRoot }
}

describe('file routes (NodeWorkspace integration)', () => {
  test('GET/POST/DELETE /api/v1/files roundtrip', async () => {
    const { app } = await createTestApp()

    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'hello.txt', content: 'world' },
    })
    expect(writeRes.statusCode).toBe(200)
    expect(writeRes.json()).toEqual({ ok: true })

    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=hello.txt',
    })
    expect(readRes.statusCode).toBe(200)
    expect(readRes.json()).toEqual({ content: 'world' })

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/files?path=hello.txt',
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({ ok: true })
  })

  test('POST /api/v1/files with createDirs writes nested files', async () => {
    const { app } = await createTestApp()

    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'src/lib/main.ts', content: 'export {}', createDirs: true },
    })
    expect(writeRes.statusCode).toBe(200)

    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=src/lib/main.ts',
    })
    expect(readRes.statusCode).toBe(200)
    expect(readRes.json().content).toBe('export {}')
  })

  test('POST /api/v1/files/move renames files', async () => {
    const { app } = await createTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'old.txt', content: 'payload' },
    })

    const moveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'old.txt', to: 'new.txt' },
    })
    expect(moveRes.statusCode).toBe(200)
    expect(moveRes.json()).toEqual({ ok: true })

    const readMovedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=new.txt',
    })
    expect(readMovedRes.statusCode).toBe(200)
    expect(readMovedRes.json().content).toBe('payload')

    const readOldRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=old.txt',
    })
    expect(readOldRes.statusCode).toBe(404)
    expect(readOldRes.json().error.code).toBe('not_found')
  })

  test('POST /api/v1/dirs creates directories and GET /api/v1/stat returns shape', async () => {
    const { app } = await createTestApp()

    const mkdirRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { path: 'nested/deep', recursive: true },
    })
    expect(mkdirRes.statusCode).toBe(200)
    expect(mkdirRes.json()).toEqual({ ok: true })

    const dirStatRes = await app.inject({
      method: 'GET',
      url: '/api/v1/stat?path=nested/deep',
    })
    expect(dirStatRes.statusCode).toBe(200)
    expect(dirStatRes.json()).toEqual({
      size: expect.any(Number),
      mtimeMs: expect.any(Number),
      kind: 'dir',
    })

    await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'nested/deep/item.txt', content: 'x' },
    })

    const fileStatRes = await app.inject({
      method: 'GET',
      url: '/api/v1/stat?path=nested/deep/item.txt',
    })
    expect(fileStatRes.statusCode).toBe(200)
    expect(fileStatRes.json()).toEqual({
      size: 1,
      mtimeMs: expect.any(Number),
      kind: 'file',
    })
  })

  test('path traversal is rejected', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=..%2Fetc%2Fpasswd',
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('path_rejected')
  })

  test('missing paths return 404', async () => {
    const { app } = await createTestApp()

    const readMissingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=missing.txt',
    })
    expect(readMissingRes.statusCode).toBe(404)
    expect(readMissingRes.json().error.code).toBe('not_found')

    const statMissingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/stat?path=missing.txt',
    })
    expect(statMissingRes.statusCode).toBe(404)
    expect(statMissingRes.json().error.code).toBe('not_found')
  })

  test('validates required fields with 400 responses', async () => {
    const { app } = await createTestApp()

    const missingPathRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files',
    })
    expect(missingPathRes.statusCode).toBe(400)
    expect(missingPathRes.json().error.field).toBe('path')

    const missingContentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'a.txt' },
    })
    expect(missingContentRes.statusCode).toBe(400)
    expect(missingContentRes.json().error.field).toBe('content')

    const missingFromRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { to: 'b.txt' },
    })
    expect(missingFromRes.statusCode).toBe(400)
    expect(missingFromRes.json().error.field).toBe('from')
  })

  test('move source missing returns 404', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'does-not-exist.txt', to: 'dest.txt' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })

  test('directory traversal is rejected', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { path: '../escape', recursive: true },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('path_rejected')
  })
})
