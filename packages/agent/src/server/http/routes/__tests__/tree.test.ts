import Fastify, { type FastifyInstance } from 'fastify'
import { describe, test, expect } from 'vitest'
import { treeRoutes } from '../tree'
import type { Workspace, Entry, Stat } from '../../../../shared/workspace'

function createWorkspace(
  tree: Record<string, Entry[]>,
): Workspace {
  return {
    root: '/repo',
    async readFile() {
      return ''
    },
    async writeFile() {},
    async unlink() {},
    async readdir(relPath: string): Promise<Entry[]> {
      if (relPath.includes('..')) {
        throw new Error('Path traversal rejected')
      }
      const entries = tree[relPath]
      if (!entries) {
        throw new Error(`ENOENT: no such file or directory '${relPath}'`)
      }
      return entries
    },
    async stat(): Promise<Stat> {
      return { size: 0, mtimeMs: Date.now(), kind: 'file' }
    },
    async mkdir() {},
    async rename() {},
  }
}

async function buildApp(workspace: Workspace): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(treeRoutes, { workspace })
  await app.ready()
  return app
}

describe('GET /api/v1/tree', () => {
  test('returns root listing with default path', async () => {
    const workspace = createWorkspace({
      '.': [
        { name: 'src', kind: 'dir' },
        { name: 'README.md', kind: 'file' },
      ],
    })
    const app = await buildApp(workspace)

    const res = await app.inject({ method: 'GET', url: '/api/v1/tree' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.entries).toHaveLength(2)
    expect(body.entries).toContainEqual({ name: 'src', kind: 'dir', path: 'src' })
    expect(body.entries).toContainEqual({
      name: 'README.md',
      kind: 'file',
      path: 'README.md',
    })

    await app.close()
  })

  test('returns listing for explicit path', async () => {
    const workspace = createWorkspace({
      'src': [
        { name: 'index.ts', kind: 'file' },
        { name: 'utils', kind: 'dir' },
      ],
    })
    const app = await buildApp(workspace)

    const res = await app.inject({ method: 'GET', url: '/api/v1/tree?path=src' })

    expect(res.statusCode).toBe(200)
    expect(res.json().entries).toHaveLength(2)
    expect(res.json().entries[0].path).toBe('src/index.ts')

    await app.close()
  })

  test('recursive=true traverses subdirectories', async () => {
    const workspace = createWorkspace({
      '.': [{ name: 'src', kind: 'dir' }],
      'src': [
        { name: 'index.ts', kind: 'file' },
        { name: 'lib', kind: 'dir' },
      ],
      'src/lib': [{ name: 'utils.ts', kind: 'file' }],
    })
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?recursive=true',
    })

    expect(res.statusCode).toBe(200)
    const entries = res.json().entries
    expect(entries.length).toBe(4)
    expect(entries.map((e: any) => e.path)).toContain('src/lib/utils.ts')

    await app.close()
  })

  test('recursive respects max depth of 10', async () => {
    const tree: Record<string, Entry[]> = {}
    let current = '.'
    for (let i = 0; i <= 12; i++) {
      const next = current === '.' ? `d${i}` : `${current}/d${i}`
      tree[current] = [{ name: `d${i}`, kind: 'dir' }]
      current = next
    }
    tree[current] = [{ name: 'leaf.txt', kind: 'file' }]

    const workspace = createWorkspace(tree)
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?recursive=true',
    })

    expect(res.statusCode).toBe(200)
    const entries = res.json().entries
    const paths = entries.map((e: any) => e.path)
    expect(paths).not.toContain(`${current}/leaf.txt`)

    await app.close()
  })

  test('recursive respects max 5000 entries', async () => {
    const bigDir: Entry[] = []
    for (let i = 0; i < 5100; i++) {
      bigDir.push({ name: `file${i}.txt`, kind: 'file' })
    }
    const workspace = createWorkspace({ '.': bigDir })
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?recursive=true',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().entries).toHaveLength(5000)

    await app.close()
  })

  test('returns 404 for nonexistent directory', async () => {
    const workspace = createWorkspace({})
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?path=nope',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')

    await app.close()
  })

  test('rejects null bytes in path', async () => {
    const workspace = createWorkspace({})
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?path=abc%00def',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_path')

    await app.close()
  })

  test('path traversal returns 403', async () => {
    const workspace = createWorkspace({})
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?path=..%2Fsecret',
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('path_rejected')

    await app.close()
  })

  test('EPERM by error.code returns 403', async () => {
    const workspace: Workspace = {
      root: '/repo',
      async readFile() { return '' },
      async writeFile() {},
      async unlink() {},
      async readdir() {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      },
      async stat() { return { size: 0, mtimeMs: Date.now(), kind: 'file' as const } },
      async mkdir() {},
      async rename() {},
    }
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?path=forbidden',
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('path_rejected')

    await app.close()
  })

  test('ENOENT by error.code returns 404', async () => {
    const workspace: Workspace = {
      root: '/repo',
      async readFile() { return '' },
      async writeFile() {},
      async unlink() {},
      async readdir(relPath: string) {
        const err = new Error('Directory missing') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      },
      async stat() { return { size: 0, mtimeMs: Date.now(), kind: 'file' as const } },
      async mkdir() {},
      async rename() {},
    }
    const app = await buildApp(workspace)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tree?path=gone',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')

    await app.close()
  })

  test('non-recursive returns only direct children', async () => {
    const workspace = createWorkspace({
      '.': [
        { name: 'a', kind: 'dir' },
        { name: 'b.txt', kind: 'file' },
      ],
      'a': [{ name: 'nested.ts', kind: 'file' }],
    })
    const app = await buildApp(workspace)

    const res = await app.inject({ method: 'GET', url: '/api/v1/tree' })

    expect(res.statusCode).toBe(200)
    expect(res.json().entries).toHaveLength(2)
    const paths = res.json().entries.map((e: any) => e.path)
    expect(paths).not.toContain('a/nested.ts')

    await app.close()
  })
})
