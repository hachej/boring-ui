import Fastify, { type FastifyInstance } from 'fastify'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { Workspace } from '../../../../shared/workspace'
import type { RuntimeFilesystemBindingOperations } from '../../../runtime/mode'
import { createNodeWorkspace } from '../../../workspace/createNodeWorkspace'
import { ERROR_CODE_NOT_FOUND_OR_DENIED, ERROR_CODE_READONLY, fileRoutes } from '../file'

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

async function createTestAppWithWorkspace(
  workspace: Workspace,
  companyOperations?: RuntimeFilesystemBindingOperations,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fileRoutes, {
    workspace,
    ...(companyOperations
      ? { filesystemBindings: [{ filesystem: 'company_context', access: 'readonly', operations: companyOperations }] }
      : {}),
  })
  await app.ready()
  apps.push(app)
  return app
}

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
  test('GET /api/v1/files preserves explicit company_context and sanitizes denied reads', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-file-routes-'))
    tempRoots.push(workspaceRoot)
    const operations: RuntimeFilesystemBindingOperations = {
      read: vi.fn(async ({ path }) => {
        if (path.includes('denied')) {
          const err = new Error('FORBIDDEN_FINANCE_SECRET_123 at /secret/finance.md') as Error & { statusCode?: number; code?: string }
          err.statusCode = 404
          err.code = 'not_found_or_denied'
          throw err
        }
        return { content: `company:${path}` }
      }),
      list: vi.fn(),
      find: vi.fn(),
      grep: vi.fn(),
      stat: vi.fn(async ({ path }) => ({ isDirectory: path.endsWith('/hr') })),
      rejectMutation: vi.fn((operation) => {
        throw new Error(`readonly ${operation}`)
      }),
    }
    const app = await createTestAppWithWorkspace(createNodeWorkspace(workspaceRoot), operations)

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/files?filesystem=company_context&path=%2Fcompany%2Fhr%2Fpolicy.md',
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toEqual({ content: 'company:/company/hr/policy.md' })
    expect(operations.read).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company/hr/policy.md' })

    const rawAllowed = await app.inject({
      method: 'GET',
      url: '/api/v1/files/raw?filesystem=company_context&path=%2Fcompany%2Fhr%2Fpolicy.md',
    })
    expect(rawAllowed.statusCode).toBe(200)
    expect(rawAllowed.body).toBe('company:/company/hr/policy.md')

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/files?filesystem=company_context&path=%2Fcompany%2Fdenied.md',
    })
    expect(denied.statusCode).toBe(404)
    expect(denied.json()).toEqual({ error: { code: ERROR_CODE_NOT_FOUND_OR_DENIED, message: 'not found or denied' } })
    expect(denied.body).not.toContain('FORBIDDEN_FINANCE_SECRET_123')
    expect(denied.body).not.toContain('/secret/finance.md')

    const rawDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/files/raw?filesystem=company_context&path=%2Fcompany%2Fdenied.md',
    })
    expect(rawDenied.statusCode).toBe(404)
    expect(rawDenied.json()).toEqual({ error: { code: ERROR_CODE_NOT_FOUND_OR_DENIED, message: 'not found or denied' } })
    expect(rawDenied.body).not.toContain('FORBIDDEN_FINANCE_SECRET_123')

    const statAllowed = await app.inject({
      method: 'GET',
      url: '/api/v1/stat?filesystem=company_context&path=%2Fcompany%2Fhr',
    })
    expect(statAllowed.statusCode).toBe(200)
    expect(statAllowed.json()).toEqual({ kind: 'dir' })
    expect(operations.stat).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/company/hr' })

    const writeDenied = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { filesystem: 'company_context', path: '/company/hr/policy.md', content: 'mutate' },
    })
    expect(writeDenied.statusCode).toBe(403)
    expect(writeDenied.json()).toEqual({ error: { code: ERROR_CODE_READONLY, message: 'company_context binding is readonly' } })
  })

  test('GET /api/v1/files routes arbitrary named filesystem bindings without company_context special casing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-file-routes-'))
    tempRoots.push(workspaceRoot)
    const operations: RuntimeFilesystemBindingOperations = {
      read: vi.fn(async ({ filesystem, path }) => ({ content: `${filesystem}:${path}` })),
      list: vi.fn(),
      find: vi.fn(),
      grep: vi.fn(),
      stat: vi.fn(async () => ({ isDirectory: false })),
      rejectMutation: vi.fn((operation) => {
        throw new Error(`readonly ${operation}`)
      }),
    }
    const app = Fastify({ logger: false })
    await app.register(fileRoutes, {
      workspace: createNodeWorkspace(workspaceRoot),
      filesystemBindings: [{ filesystem: 'project_alpha', access: 'readonly', operations }],
    })
    await app.ready()
    apps.push(app)

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/files?filesystem=project_alpha&path=%2Fsrc%2Findex.ts',
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toEqual({ content: 'project_alpha:/src/index.ts' })
    expect(operations.read).toHaveBeenCalledWith({ filesystem: 'project_alpha', path: '/src/index.ts' })

    const writeDenied = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { filesystem: 'project_alpha', path: '/src/index.ts', content: 'mutate' },
    })
    expect(writeDenied.statusCode).toBe(403)
    expect(writeDenied.json()).toEqual({ error: { code: ERROR_CODE_READONLY, message: 'project_alpha binding is readonly' } })
  })

  test('company_context filesystem rejects delete move and mkdir before user workspace mutation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-file-routes-'))
    tempRoots.push(workspaceRoot)
    await writeFile(join(workspaceRoot, 'user.txt'), 'safe')
    const workspace = createNodeWorkspace(workspaceRoot)
    const unlink = vi.spyOn(workspace, 'unlink')
    const rename = vi.spyOn(workspace, 'rename')
    const mkdir = vi.spyOn(workspace, 'mkdir')
    const operations: RuntimeFilesystemBindingOperations = {
      read: vi.fn(),
      list: vi.fn(),
      find: vi.fn(),
      grep: vi.fn(),
      stat: vi.fn(),
      rejectMutation: vi.fn((operation) => {
        throw new Error(`readonly ${operation}`)
      }),
    }
    const app = await createTestAppWithWorkspace(workspace, operations)

    const deleteDenied = await app.inject({
      method: 'DELETE',
      url: '/api/v1/files?filesystem=company_context&path=%2Fcompany%2Fhr%2Fpolicy.md',
    })
    expect(deleteDenied.statusCode).toBe(403)
    expect(deleteDenied.json()).toEqual({ error: { code: ERROR_CODE_READONLY, message: 'company_context binding is readonly' } })

    const moveDenied = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { filesystem: 'company_context', from: '/company/hr/policy.md', to: '/company/hr/policy-2.md' },
    })
    expect(moveDenied.statusCode).toBe(403)
    expect(moveDenied.json()).toEqual({ error: { code: ERROR_CODE_READONLY, message: 'company_context binding is readonly' } })

    const mkdirDenied = await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { filesystem: 'company_context', path: '/company/new', recursive: true },
    })
    expect(mkdirDenied.statusCode).toBe(403)
    expect(mkdirDenied.json()).toEqual({ error: { code: ERROR_CODE_READONLY, message: 'company_context binding is readonly' } })

    expect(unlink).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    expect(await readFile(join(workspaceRoot, 'user.txt'), 'utf8')).toBe('safe')
  })

  test('GET/POST/DELETE /api/v1/files roundtrip', async () => {
    const { app } = await createTestApp()

    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'hello.txt', content: 'world' },
    })
    expect(writeRes.statusCode).toBe(200)
    expect(writeRes.json().ok).toBe(true)

    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=hello.txt',
    })
    expect(readRes.statusCode).toBe(200)
    // Body now also carries mtimeMs (OCC baseline). Assert just the
    // content so the test isn't pinned to the exact server stat
    // shape.
    expect(readRes.json().content).toBe('world')
    expect(typeof readRes.json().mtimeMs).toBe('number')

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/files?path=hello.txt',
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({ ok: true })
  })

  test('DELETE /api/v1/files removes folders recursively', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await mkdir(join(workspaceRoot, 'src/nested'), { recursive: true })
    await writeFile(join(workspaceRoot, 'src/nested/deep.txt'), 'deep')

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/files?path=src',
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({ ok: true })

    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=src/nested/deep.txt',
    })
    expect(readRes.statusCode).toBe(404)

    await expect(stat(join(workspaceRoot, 'src'))).rejects.toThrow()
  })

  test('DELETE /api/v1/files rejects removing the workspace root', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await writeFile(join(workspaceRoot, 'keep.txt'), 'x')

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/files?path=.',
    })
    expect(deleteRes.statusCode).toBe(403)

    await expect(readFile(join(workspaceRoot, 'keep.txt'), 'utf8')).resolves.toBe('x')
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

  test('POST /api/v1/files can skip post-write stat when mtime is not needed', async () => {
    const writeFileMock = vi.fn(async () => {})
    const writeFileWithStatMock = vi.fn(async () => ({ kind: 'file' as const, size: 4, mtimeMs: 123 }))
    const app = await createTestAppWithWorkspace({
      root: '/workspace',
      runtimeContext: { runtimeCwd: '/workspace' },
      fsCapability: 'best-effort',
      readFile: vi.fn(async () => ''),
      writeFile: writeFileMock,
      writeFileWithStat: writeFileWithStatMock,
      unlink: vi.fn(async () => {}),
      readdir: vi.fn(async () => []),
      stat: vi.fn(async () => ({ kind: 'file' as const, size: 4, mtimeMs: 123 })),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'fast.txt', content: 'fast', returnMtimeMs: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(writeFileMock).toHaveBeenCalledWith('fast.txt', 'fast')
    expect(writeFileWithStatMock).not.toHaveBeenCalled()
  })

  test('POST /api/v1/files keeps mtime result for OCC writes even when returnMtimeMs is false', async () => {
    const writeFileMock = vi.fn(async () => {})
    const writeFileWithStatMock = vi.fn(async () => ({ kind: 'file' as const, size: 4, mtimeMs: 456 }))
    const statMock = vi.fn(async () => ({ kind: 'file' as const, size: 3, mtimeMs: 123 }))
    const app = await createTestAppWithWorkspace({
      root: '/workspace',
      runtimeContext: { runtimeCwd: '/workspace' },
      fsCapability: 'best-effort',
      readFile: vi.fn(async () => ''),
      writeFile: writeFileMock,
      writeFileWithStat: writeFileWithStatMock,
      unlink: vi.fn(async () => {}),
      readdir: vi.fn(async () => []),
      stat: statMock,
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: {
        path: 'occ.txt',
        content: 'next',
        expectedMtimeMs: 123,
        returnMtimeMs: false,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, mtimeMs: 456 })
    expect(statMock).toHaveBeenCalledWith('occ.txt')
    expect(writeFileWithStatMock).toHaveBeenCalledWith('occ.txt', 'next')
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  test('multi-tab stale write overwrites newer content (last write wins)', async () => {
    const { app } = await createTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'shared.txt', content: 'base' },
    })

    const tabARead = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=shared.txt',
    })
    expect(tabARead.statusCode).toBe(200)
    expect(tabARead.json().content).toBe('base')

    const tabBWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'shared.txt', content: 'tab-b-newer' },
    })
    expect(tabBWrite.statusCode).toBe(200)
    expect(tabBWrite.json().ok).toBe(true)

    // Tab A writes using stale state. Without expectedMtimeMs in the
    // request, OCC is not enforced — preserves the legacy "force
    // overwrite" path that ships from FileTreeView etc.
    const tabAWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'shared.txt', content: 'tab-a-stale' },
    })
    expect(tabAWrite.statusCode).toBe(200)
    expect(tabAWrite.json().ok).toBe(true)

    const finalRead = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=shared.txt',
    })
    expect(finalRead.statusCode).toBe(200)
    expect(finalRead.json().content).toBe('tab-a-stale')
  })

  test('POST /api/v1/files with stale expectedMtimeMs returns 409', async () => {
    const { app } = await createTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'shared.txt', content: 'base' },
    })

    const tabARead = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=shared.txt',
    })
    const tabAMtime = tabARead.json().mtimeMs as number
    expect(typeof tabAMtime).toBe('number')

    // Tab B writes through (force) — bumps disk mtime.
    await new Promise((r) => setTimeout(r, 5)) // ensure mtime tick on fast FS
    const tabBWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'shared.txt', content: 'tab-b-newer' },
    })
    expect(tabBWrite.statusCode).toBe(200)

    // Tab A's OCC-aware save now 409s.
    const tabAWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: {
        path: 'shared.txt',
        content: 'tab-a-stale',
        expectedMtimeMs: tabAMtime,
      },
    })
    expect(tabAWrite.statusCode).toBe(409)
    const body = tabAWrite.json()
    expect(body.error.code).toBe('conflict')
    expect(typeof body.error.currentMtimeMs).toBe('number')
    expect(body.error.expectedMtimeMs).toBe(tabAMtime)

    // Disk content is still tab B's — OCC blocked the stale clobber.
    const finalRead = await app.inject({
      method: 'GET',
      url: '/api/v1/files?path=shared.txt',
    })
    expect(finalRead.json().content).toBe('tab-b-newer')
  })

  test('POST /api/v1/files with current expectedMtimeMs succeeds', async () => {
    const { app } = await createTestApp()

    const writeA = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: 'shared.txt', content: 'base' },
    })
    const baselineMtime = writeA.json().mtimeMs as number

    const writeB = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: {
        path: 'shared.txt',
        content: 'next',
        expectedMtimeMs: baselineMtime,
      },
    })
    expect(writeB.statusCode).toBe(200)
    expect(writeB.json().ok).toBe(true)
    expect(typeof writeB.json().mtimeMs).toBe('number')
  })

  test('GET /api/v1/files/raw streams binary media with content type', async () => {
    const { app, workspaceRoot } = await createTestApp()
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(join(workspaceRoot, 'chart.png'), pngBytes)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/raw?path=chart.png',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.rawPayload).toEqual(pngBytes)
  })

  test('GET /api/v1/files/records pages JSON array records', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await writeFile(join(workspaceRoot, 'niches.json'), JSON.stringify([
      { id: 'n1', name: 'Climate Tools', score: 9 },
      { id: 'n2', name: 'Ledger Apps', score: 7 },
      { id: 'n3', name: 'Climate Finance', score: 8 },
    ]), 'utf8')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=niches.json&offset=0&limit=2',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      source: { kind: 'file', path: 'niches.json', format: 'json-array' },
      path: 'niches.json',
      format: 'json-array',
      total: 3,
      hasMore: true,
      offset: 0,
      limit: 2,
      rows: [
        { id: 'n1', name: 'Climate Tools', score: 9 },
        { id: 'n2', name: 'Ledger Apps', score: 7 },
      ],
    })
    expect(res.json().columns).toEqual([
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'score', type: 'number' },
    ])
    expect(typeof res.json().mtimeMs).toBe('number')
  })

  test('GET /api/v1/files/records filters before paginating', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await writeFile(join(workspaceRoot, 'niches.json'), JSON.stringify([
      { id: 'n1', name: 'Climate Tools' },
      { id: 'n2', name: 'Ledger Apps' },
      { id: 'n3', name: 'Climate Finance' },
    ]), 'utf8')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=niches.json&q=climate&offset=1&limit=1',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      total: 2,
      hasMore: false,
      rows: [{ id: 'n3', name: 'Climate Finance' }],
    })
  })

  test('GET /api/v1/files/records pages NDJSON records', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await writeFile(join(workspaceRoot, 'events.ndjson'), [
      JSON.stringify({ id: 1, kind: 'start' }),
      JSON.stringify({ id: 2, kind: 'stop' }),
    ].join('\n'), 'utf8')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=events.ndjson&offset=1&limit=10',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      format: 'ndjson',
      total: 2,
      hasMore: false,
      rows: [{ id: 2, kind: 'stop' }],
    })
  })

  test('GET /api/v1/files/records pages CSV header records', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await writeFile(join(workspaceRoot, 'niches.csv'), 'id,name\n1,Climate Tools\n2,Ledger Apps\n', 'utf8')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=niches.csv&limit=1',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      format: 'csv',
      total: 2,
      hasMore: true,
      rows: [{ id: '1', name: 'Climate Tools' }],
    })
  })

  test('GET /api/v1/files/records handles quoted CSV and rejects malformed CSV', async () => {
    const { app, workspaceRoot } = await createTestApp()
    await writeFile(join(workspaceRoot, 'quoted.csv'), 'id,name,notes\n1,"Climate, Tools","line one\nline two"\n', 'utf8')
    await writeFile(join(workspaceRoot, 'bad.csv'), 'id,name\n1,"unterminated\n', 'utf8')

    const quotedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=quoted.csv',
    })
    expect(quotedRes.statusCode).toBe(200)
    expect(quotedRes.json().rows).toEqual([{ id: '1', name: 'Climate, Tools', notes: 'line one\nline two' }])

    const badRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=bad.csv',
    })
    expect(badRes.statusCode).toBe(400)
    expect(badRes.json().error.code).toBe('validation_error')
  })

  test('GET /api/v1/files/records clamps limit to host max', async () => {
    const { app, workspaceRoot } = await createTestApp()
    const rows = Array.from({ length: 120 }, (_, index) => ({ id: index }))
    await writeFile(join(workspaceRoot, 'many.json'), JSON.stringify(rows), 'utf8')

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=many.json&limit=999',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().limit).toBe(100)
    expect(res.json().rows).toHaveLength(100)
    expect(res.json().hasMore).toBe(true)
  })

  test('GET /api/v1/files/records rejects recordSet, traversal, and oversize files', async () => {
    const { app, workspaceRoot } = await createTestApp()

    const recordSetRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=data.json&recordSet=items',
    })
    expect(recordSetRes.statusCode).toBe(400)
    expect(recordSetRes.json().error.field).toBe('recordSet')

    const traversalRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=..%2Fetc%2Fpasswd',
    })
    expect(traversalRes.statusCode).toBe(403)
    expect(traversalRes.json().error.code).toBe('path_rejected')

    await writeFile(join(workspaceRoot, 'huge.json'), `[${JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) })}]`, 'utf8')
    const hugeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=huge.json',
    })
    expect(hugeRes.statusCode).toBe(400)
    expect(hugeRes.json().error.code).toBe('validation_error')

    const hugeOffsetRes = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?path=huge.json&offset=999999999999999999999999',
    })
    expect(hugeOffsetRes.statusCode).toBe(400)
    expect(hugeOffsetRes.json().error.field).toBe('offset')
  })

  test('POST /api/v1/files/upload stores image bytes under configured path', async () => {
    const { app, workspaceRoot } = await createTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { path: '.boring', recursive: true },
    })
    await writeFile(
      join(workspaceRoot, '.boring', 'settings'),
      JSON.stringify({ markdown: { imageUploadDir: 'media/md-images' } }),
      'utf8',
    )

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'My Chart.png',
        contentType: 'image/png',
        contentBase64: pngBytes.toString('base64'),
        sourcePath: 'deck/briefing.md',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.path).toMatch(/^media\/md-images\/My-Chart-[a-z0-9]+-[a-z0-9]+\.png$/)
    expect(body.markdownUrl).toMatch(/^\.\.\/media\/md-images\/My-Chart-[a-z0-9]+-[a-z0-9]+\.png$/)
    await expect(readFile(join(workspaceRoot, body.path))).resolves.toEqual(pngBytes)
  })

  test('POST /api/v1/files/upload stores non-image files under uploads path', async () => {
    const { app, workspaceRoot } = await createTestApp()
    const pdfBytes = Buffer.from('%PDF-1.4\n')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'Report.pdf',
        contentType: 'application/pdf',
        contentBase64: pdfBytes.toString('base64'),
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.path).toMatch(/^assets\/uploads\/Report-[a-z0-9]+-[a-z0-9]+\.pdf$/)
    expect(body.markdownUrl).toBe(body.path)
    await expect(readFile(join(workspaceRoot, body.path))).resolves.toEqual(pdfBytes)

    const raw = await app.inject({ method: 'GET', url: `/api/v1/files/raw?path=${encodeURIComponent(body.path)}` })
    expect(raw.statusCode).toBe(200)
    expect(raw.headers['content-type']).toBe('application/pdf')
    expect(raw.headers['x-content-type-options']).toBe('nosniff')
  })

  test('POST /api/v1/files/upload does not preserve SVG as active web content', async () => {
    const { app } = await createTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'payload.svg',
        contentType: 'image/svg+xml',
        contentBase64: Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64'),
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().path).toMatch(/^assets\/images\/payload-[a-z0-9]+-[a-z0-9]+\.bin$/)
  })

  test('POST /api/v1/files/upload does not preserve executable web extensions', async () => {
    const { app } = await createTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'payload.html',
        contentType: 'text/html',
        contentBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().path).toMatch(/^assets\/uploads\/payload-[a-z0-9]+-[a-z0-9]+\.bin$/)
  })

  test('GET/PUT /api/v1/workspace-settings round-trips markdown image path', async () => {
    const { app, workspaceRoot } = await createTestApp()

    const initial = await app.inject({ method: 'GET', url: '/api/v1/workspace-settings' })
    expect(initial.statusCode).toBe(200)
    expect(initial.json().settings.markdown.imageUploadDir).toBe('assets/images')

    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/workspace-settings',
      payload: { settings: { markdown: { imageUploadDir: '.boring/uploads' } } },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().settings.markdown.imageUploadDir).toBe('.boring/uploads')
    await expect(readFile(join(workspaceRoot, '.boring', 'settings'), 'utf8')).resolves.toContain('.boring/uploads')
  })

  // REGRESSION: a corrupted .boring/settings file used to silently return
  // defaults, and the next PUT would clobber the corrupted file with merged
  // defaults — any salvageable content was lost without warning. Now logs
  // a warning while still returning defaults (so the editor can still boot
  // and PUT can recover).
  test('GET /api/v1/workspace-settings warns on corrupted settings (does not throw)', async () => {
    const { app, workspaceRoot } = await createTestApp()
    const { writeFile, mkdir } = await import('fs/promises')
    await mkdir(join(workspaceRoot, '.boring'), { recursive: true })
    await writeFile(join(workspaceRoot, '.boring', 'settings'), '{not-json-at-all', 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await app.inject({ method: 'GET', url: '/api/v1/workspace-settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings.markdown.imageUploadDir).toBe('assets/images')
    // Logger emits a single stringified JSON entry. Check it carries our
    // warning so a future change that drops the warning gets caught.
    const warnEntries = warn.mock.calls.map((c) => String(c[0] ?? ''))
    expect(warnEntries.some((entry) =>
      entry.includes('boring/workspace-settings') &&
      entry.includes('failed to parse .boring/settings'),
    )).toBe(true)
    warn.mockRestore()
  })

  // REGRESSION: sourcePath was previously unbounded — a multi-MB string in
  // the body would be echoed back in markdownUrl on every image upload and
  // burned into every markdown image link in the document. Now capped.
  test('POST /api/v1/files/upload ignores absurdly-long sourcePath (no echo amplification)', async () => {
    const { app } = await createTestApp()
    const tinyPng = Buffer.from([137, 80, 78, 71])
    const huge = 'x'.repeat(2048) // > 1024 cap
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'pic.png',
        contentType: 'image/png',
        contentBase64: tinyPng.toString('base64'),
        sourcePath: huge,
      },
    })
    expect(res.statusCode).toBe(200)
    // sourcePath is dropped (treated as null) so markdownUrl falls back to
    // the absolute workspace path, not the giant string echoed back.
    expect(res.json().markdownUrl).not.toContain('x'.repeat(100))
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
