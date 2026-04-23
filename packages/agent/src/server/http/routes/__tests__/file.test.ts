import Fastify, { type FastifyInstance } from 'fastify'
import { describe, test, expect } from 'vitest'
import { fileRoutes } from '../file'
import type { Workspace, Entry, Stat } from '../../../../shared/workspace'

function createWorkspace(
  files: Record<string, string> = {},
  dirs: Set<string> = new Set(['']),
): Workspace {
  return {
    root: '/repo',
    async readFile(relPath: string): Promise<string> {
      if (relPath.includes('..')) throw new Error('Path traversal rejected')
      const value = files[relPath]
      if (value === undefined) throw new Error(`ENOENT: no such file '${relPath}'`)
      return value
    },
    async writeFile(relPath: string, data: string): Promise<void> {
      if (relPath.includes('..')) throw new Error('Path traversal rejected')
      files[relPath] = data
    },
    async unlink(relPath: string): Promise<void> {
      if (relPath.includes('..')) throw new Error('Path traversal rejected')
      if (!(relPath in files)) throw new Error(`ENOENT: no such file '${relPath}'`)
      delete files[relPath]
    },
    async readdir(relPath: string): Promise<Entry[]> {
      if (relPath.includes('..')) throw new Error('Path traversal rejected')
      return Object.keys(files)
        .filter((f) => {
          const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''
          return dir === relPath
        })
        .map((f) => ({
          name: f.includes('/') ? f.slice(f.lastIndexOf('/') + 1) : f,
          kind: 'file' as const,
        }))
    },
    async stat(relPath: string): Promise<Stat> {
      if (relPath.includes('..')) throw new Error('Path traversal rejected')
      if (relPath in files) {
        return { size: files[relPath].length, mtimeMs: 1000, kind: 'file' }
      }
      if (dirs.has(relPath)) {
        return { size: 0, mtimeMs: 1000, kind: 'dir' }
      }
      throw new Error(`ENOENT: no such file '${relPath}'`)
    },
    async mkdir(relPath: string): Promise<void> {
      if (relPath.includes('..')) throw new Error('Path traversal rejected')
      dirs.add(relPath)
    },
    async rename(from: string, to: string): Promise<void> {
      if (from.includes('..') || to.includes('..')) throw new Error('Path traversal rejected')
      if (!(from in files)) throw new Error(`ENOENT: no such file '${from}'`)
      files[to] = files[from]
      delete files[from]
    },
  }
}

async function buildApp(workspace: Workspace): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fileRoutes, { workspace })
  await app.ready()
  return app
}

describe('GET /api/v1/files', () => {
  test('reads existing file', async () => {
    const ws = createWorkspace({ 'hello.txt': 'world' })
    const app = await buildApp(ws)

    const res = await app.inject({ method: 'GET', url: '/api/v1/files?path=hello.txt' })

    expect(res.statusCode).toBe(200)
    expect(res.json().content).toBe('world')
    await app.close()
  })

  test('returns 404 for missing file', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({ method: 'GET', url: '/api/v1/files?path=nope.txt' })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
    await app.close()
  })

  test('rejects path traversal', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({ method: 'GET', url: '/api/v1/files?path=..%2Fetc%2Fpasswd' })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('path_rejected')
    await app.close()
  })

  test('handles PathValidationError from real workspace adapter', async () => {
    const ws: Workspace = {
      root: '/repo',
      async readFile() {
        throw Object.assign(new Error('Path escapes workspace root'), {
          statusCode: 400,
          reason: 'path-escape',
          requestedPath: '../secret',
        })
      },
      async writeFile() {},
      async unlink() {},
      async readdir() { return [] },
      async stat() { return { size: 0, mtimeMs: 0, kind: 'file' as const } },
      async mkdir() {},
      async rename() {},
    }
    const app = await buildApp(ws)

    const res = await app.inject({ method: 'GET', url: '/api/v1/files?path=secret' })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('path_rejected')
    await app.close()
  })

  test('rejects missing path param', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({ method: 'GET', url: '/api/v1/files' })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /api/v1/files', () => {
  test('writes file and reads it back', async () => {
    const files: Record<string, string> = {}
    const ws = createWorkspace(files)
    const app = await buildApp(ws)

    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'new.txt', content: 'hello' },
    })
    expect(writeRes.statusCode).toBe(200)
    expect(writeRes.json().ok).toBe(true)

    const readRes = await app.inject({ method: 'GET', url: '/api/v1/files?path=new.txt' })
    expect(readRes.json().content).toBe('hello')

    await app.close()
  })

  test('rejects missing content', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'test.txt' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.field).toBe('content')
    await app.close()
  })

  test('rejects missing path', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { content: 'hi' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.field).toBe('path')
    await app.close()
  })
})

describe('DELETE /api/v1/files', () => {
  test('deletes existing file', async () => {
    const files = { 'del.txt': 'bye' }
    const ws = createWorkspace(files)
    const app = await buildApp(ws)

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/files?path=del.txt' })
    expect(res.statusCode).toBe(200)

    const readRes = await app.inject({ method: 'GET', url: '/api/v1/files?path=del.txt' })
    expect(readRes.statusCode).toBe(404)

    await app.close()
  })

  test('returns 404 for missing file', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/files?path=nope.txt' })

    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('POST /api/v1/files/move', () => {
  test('renames file', async () => {
    const files: Record<string, string> = { 'old.txt': 'data' }
    const ws = createWorkspace(files)
    const app = await buildApp(ws)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'old.txt', to: 'new.txt' },
    })
    expect(res.statusCode).toBe(200)
    expect(files['new.txt']).toBe('data')
    expect(files['old.txt']).toBeUndefined()

    await app.close()
  })

  test('returns 404 when source missing', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'nope.txt', to: 'dest.txt' },
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  test('rejects missing from param', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { to: 'dest.txt' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /api/v1/dirs', () => {
  test('creates directory', async () => {
    const dirs = new Set([''])
    const ws = createWorkspace({}, dirs)
    const app = await buildApp(ws)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { path: 'newdir' },
    })
    expect(res.statusCode).toBe(200)
    expect(dirs.has('newdir')).toBe(true)

    await app.close()
  })

  test('rejects traversal in dir path', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { path: '../escape' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('GET /api/v1/stat', () => {
  test('returns stat for existing file', async () => {
    const ws = createWorkspace({ 'main.ts': 'export {}' })
    const app = await buildApp(ws)

    const res = await app.inject({ method: 'GET', url: '/api/v1/stat?path=main.ts' })

    expect(res.statusCode).toBe(200)
    const stat = res.json()
    expect(stat.kind).toBe('file')
    expect(typeof stat.size).toBe('number')
    expect(typeof stat.mtimeMs).toBe('number')

    await app.close()
  })

  test('returns 404 for missing path', async () => {
    const app = await buildApp(createWorkspace())

    const res = await app.inject({ method: 'GET', url: '/api/v1/stat?path=nope' })

    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
