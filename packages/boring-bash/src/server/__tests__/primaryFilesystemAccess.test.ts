import Fastify from 'fastify'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import { buildFilesystemAgentTools } from '../../agent/tools/filesystem'
import { buildUploadAgentTools } from '../../agent/tools/upload'
import {
  ReadonlyFilesystemMutationError,
  type RuntimeBundle,
  type RuntimeFilesystemBinding,
  type RuntimeFilesystemCapability,
} from '../../agent/runtime/types'
import { fileRoutes } from '../routes/file'
import { treeRoutes } from '../routes/tree'

function binding(): RuntimeFilesystemBinding {
  const files = new Map([['protected/a.txt', 'secret'], ['open.txt', 'open'], ['backup:2026.tar', 'backup'], ['records.json', '[{"id":1}]']])
  const dirs = new Set(['.', 'protected', 'a', '.boring', 'assets/images'])
  const access = (path: string) => path.startsWith('protected') ? 'readonly' as const : 'readwrite' as const
  const capabilities = (path: string) => {
    const writable = access(path) === 'readwrite'
    return { read: true, write: writable, 'create-child': writable, delete: writable, 'move-from': writable }
  }
  return {
    filesystem: 'user',
    access: 'readwrite',
    operations: {
      async read({ path }) { return { content: files.get(path) ?? '', mtimeMs: 1 } },
      async list() { return { entries: ['a.txt'] } },
      async find() { return { paths: [] } },
      async grep() { return { matches: [] } },
      async stat({ path }) {
        if (dirs.has(path)) return { isDirectory: true }
        if (files.has(path)) return { isDirectory: false }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      async write({ path, content }) { files.set(path, content); return { mtimeMs: 2 } },
      async writeBinary({ path, content }) { files.set(path, new TextDecoder().decode(content)); return { mtimeMs: 2 } },
      async delete({ path }) { files.delete(path); return {} },
      async move({ from, to }) { files.set(to, files.get(from) ?? ''); files.delete(from); return {} },
      async mkdir({ path }) { dirs.add(path); return {} },
      async resolveAccess({ filesystem, path }) {
        return { filesystem, normalizedPath: path, access: access(path), capabilities: capabilities(path) }
      },
      rejectMutation(operation) { throw new ReadonlyFilesystemMutationError('user', operation as RuntimeFilesystemCapability) },
    },
  }
}

function assertWorkspaceRelativePath(path: string): void {
  if (
    path.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(path)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)
    || path.includes('\\')
    || path.split('/').includes('..')
  ) {
    throw Object.assign(new Error('path traversal rejected'), { statusCode: 403, reason: 'path-escape' })
  }
}

function workspace(root = '/workspace') {
  return {
    root,
    runtimeContext: { runtimeCwd: root },
    async readFile(path: string) {
      assertWorkspaceRelativePath(path)
      return path === '.boring/settings' ? JSON.stringify({ markdown: { imageUploadDir: 'assets/images' } }) : 'workspace'
    },
    async writeFile(path: string) { assertWorkspaceRelativePath(path) },
    async readBinaryFile(path: string) { assertWorkspaceRelativePath(path); return new TextEncoder().encode('raw') },
    async writeBinaryFile(path: string) { assertWorkspaceRelativePath(path) },
    async unlink(path: string) { assertWorkspaceRelativePath(path) },
    async rename(from: string, to: string) { assertWorkspaceRelativePath(from); assertWorkspaceRelativePath(to) },
    async mkdir(path: string) { assertWorkspaceRelativePath(path) },
    async readdir(path: string) {
      assertWorkspaceRelativePath(path)
      if (path === 'missing') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return path === 'protected'
        ? [{ name: 'a.txt', kind: 'file' as const }]
        : [
            { name: 'protected', kind: 'dir' as const },
            { name: 'open.txt', kind: 'file' as const },
            { name: 'backup:2026.tar', kind: 'file' as const },
          ]
    },
    async stat(path: string) {
      assertWorkspaceRelativePath(path)
      return { kind: path === 'protected' ? 'dir' as const : 'file' as const, size: 3, mtimeMs: 1 }
    },
  }
}

async function appWithBinding() {
  const app = Fastify()
  const user = binding()
  const userWorkspace = workspace()
  await app.register(fileRoutes, { workspace: userWorkspace, filesystemBindings: [user] })
  await app.register(treeRoutes, { workspace: userWorkspace, filesystemBindings: [user] })
  return { app, user }
}

describe('primary filesystem access projection', () => {
  test('projects readonly decisions on JSON, raw, stat, and tree reads', async () => {
    const { app } = await appWithBinding()
    const file = await app.inject({ method: 'GET', url: '/api/v1/files?path=protected/a.txt' })
    expect(file.json()).toMatchObject({ content: 'secret', access: 'readonly', capabilities: { write: false } })
    const raw = await app.inject({ method: 'GET', url: '/api/v1/files/raw?path=protected/a.txt' })
    expect(raw.headers['x-boring-filesystem-access']).toBe('readonly')
    const stat = await app.inject({ method: 'GET', url: '/api/v1/stat?path=protected/a.txt' })
    expect(stat.json()).toMatchObject({ size: 3, mtimeMs: 1, access: 'readonly', capabilities: { delete: false } })
    const tree = await app.inject({ method: 'GET', url: '/api/v1/tree?path=protected' })
    expect(tree.json()).toMatchObject({
      access: 'readonly',
      capabilities: { 'create-child': false },
      entries: [{ path: 'protected/a.txt', access: 'readonly', capabilities: { write: false } }],
    })
    await app.close()
  })

  test('serializes stable readonly errors and permits writable siblings', async () => {
    const { app, user } = await appWithBinding()
    const write = vi.spyOn(user.operations, 'write')
    const denied = await app.inject({ method: 'POST', url: '/api/v1/files', payload: { path: 'protected/a.txt', content: 'x' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual({ error: { code: 'readonly', message: 'user binding is readonly' } })
    expect(write).not.toHaveBeenCalled()
    const allowed = await app.inject({ method: 'POST', url: '/api/v1/files', payload: { path: 'open.txt', content: 'changed' } })
    expect(allowed.statusCode).toBe(200)
    expect(write).toHaveBeenCalledOnce()
    await app.close()
  })

  test('denies preserved-name uploads to protected binding paths', async () => {
    const { app, user } = await appWithBinding()
    const writeBinary = vi.spyOn(user.operations, 'writeBinary')
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'new.txt', directory: 'protected', preserveName: true,
        collision: 'replace', contentBase64: 'eA==',
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: { code: 'readonly', message: 'user binding is readonly' } })
    expect(writeBinary).not.toHaveBeenCalled()
    await app.close()
  })

  test('serializes concurrent preserved-name writes through a binding', async () => {
    const { app, user } = await appWithBinding()
    const writeBinary = vi.spyOn(user.operations, 'writeBinary')
    const request = () => app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'raced.txt', directory: 'a', preserveName: true,
        collision: 'skip', contentBase64: 'eA==',
      },
    })
    const responses = await Promise.all([request(), request()])
    expect(writeBinary).toHaveBeenCalledOnce()
    expect(responses.map((response) => response.json().skipped).sort()).toEqual([false, true])
    await app.close()
  })

  test('routes real Pi read/write tools through the user binding capabilities', async () => {
    const user = binding()
    const write = vi.spyOn(user.operations, 'write')
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-access-'))
    await mkdir(join(root, 'protected'), { recursive: true })
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'protected/a.txt'), 'secret')
    await writeFile(join(root, 'open.txt'), 'open')
    const bundle = {
      storageRoot: root,
      workspace: workspace(root),
      sandbox: { placement: 'local' },
      fileSearch: {},
      filesystemBindings: [user],
    } as unknown as RuntimeBundle
    const tools = buildFilesystemAgentTools(bundle)
    const read = tools.find((tool) => tool.name === 'read')!
    const find = tools.find((tool) => tool.name === 'find')!
    const grep = tools.find((tool) => tool.name === 'grep')!
    const writeTool = tools.find((tool) => tool.name === 'write')!
    const boundFind = vi.spyOn(user.operations, 'find')
    const boundGrep = vi.spyOn(user.operations, 'grep')
    const ctx = { abortSignal: new AbortController().signal, toolCallId: 'access-test' }
    await expect(read.execute({ path: 'protected/a.txt' }, ctx)).resolves.toMatchObject({ content: [{ text: 'secret' }] })
    await expect(find.execute({ path: '.', pattern: '*.txt' }, ctx)).resolves.toMatchObject({ isError: false })
    await expect(grep.execute({ path: '.', pattern: 'secret' }, ctx)).resolves.toMatchObject({ isError: false })
    expect(boundFind).not.toHaveBeenCalled()
    expect(boundGrep).not.toHaveBeenCalled()
    await expect(writeTool.execute({ path: 'protected/a.txt', content: 'x' }, ctx)).rejects.toMatchObject({ code: 'readonly', filesystem: 'user', operation: 'write' })
    await expect(writeTool.execute({ path: 'a/sibling.txt', content: 'changed' }, ctx)).resolves.toMatchObject({ isError: false })
    expect(write).toHaveBeenCalledOnce()
    bundle.filesystem = { kind: 'remote-workspace' }
    bundle.sandbox = { placement: 'remote' } as RuntimeBundle['sandbox']
    const remoteWrite = buildFilesystemAgentTools(bundle).find((tool) => tool.name === 'write')!
    await expect(remoteWrite.execute({ path: 'open.txt', content: 'remote' }, ctx)).resolves.toMatchObject({ isError: false })
    expect(write).toHaveBeenCalledTimes(2)
    const filesystemSchema = (read.parameters as { properties: { filesystem: { enum: string[] } } }).properties.filesystem
    expect(filesystemSchema.enum).toEqual(['user'])
  })

  test('routes upload_file through primary binding policy', async () => {
    const user = binding()
    const root = await mkdtemp(join(tmpdir(), 'boring-upload-access-'))
    await writeFile(join(root, 'source.png'), 'source')
    const bundle = { storageRoot: root, workspace: workspace(root), sandbox: { placement: 'local' }, fileSearch: {}, filesystemBindings: [user] } as unknown as RuntimeBundle
    const upload = buildUploadAgentTools(bundle)[0]!
    await expect(upload.execute({ path: 'source.png', directory: 'protected' }, { toolCallId: 'upload', abortSignal: new AbortController().signal }))
      .resolves.toMatchObject({ isError: true, content: [{ text: 'user binding is readonly' }] })
  })

  test('projects records/settings and executes settings/upload mutations through the binding', async () => {
    const { app, user } = await appWithBinding()
    const write = vi.spyOn(user.operations, 'write')
    const writeBinary = vi.spyOn(user.operations, 'writeBinary')
    const records = await app.inject({ method: 'GET', url: '/api/v1/files/records?path=records.json' })
    expect(records.json()).toMatchObject({ access: 'readwrite', capabilities: { write: true }, rows: [{ id: 1 }] })
    const settings = await app.inject({ method: 'GET', url: '/api/v1/workspace-settings' })
    expect(settings.json()).toMatchObject({ access: 'readwrite', capabilities: { write: true } })
    const put = await app.inject({ method: 'PUT', url: '/api/v1/workspace-settings', payload: { settings: { markdown: { imageUploadDir: 'assets/images' } } } })
    expect(put.statusCode).toBe(200)
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ path: '.boring/settings' }))
    const upload = await app.inject({ method: 'POST', url: '/api/v1/files/upload', payload: { filename: 'x.png', contentType: 'image/png', contentBase64: 'eA==' } })
    expect(upload.statusCode).toBe(200)
    expect(writeBinary).toHaveBeenCalled()
    await app.close()
  })

  test.each([
    '/etc/passwd',
    '/home/operator/.pi/agent/skills/demo/SKILL.md',
    'C:/Windows/System32/config/SAM',
    'C:\\Windows\\System32\\config\\SAM',
    '\\\\server\\share\\secret.txt',
    '../outside.txt',
  ])('rejects outside-workspace user path %j through binding and fallback file/stat routes', async (path) => {
    const withBinding = await appWithBinding()
    withBinding.user.operations.resolveAccess = vi.fn(async () => {
      throw Object.assign(new Error('invalid'), { code: 'RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID' })
    })
    const fallback = Fastify()
    await fallback.register(fileRoutes, { workspace: workspace() })
    try {
      for (const endpoint of ['files', 'stat']) {
        for (const app of [withBinding.app, fallback]) {
          const response = await app.inject({ method: 'GET', url: `/api/v1/${endpoint}?path=${encodeURIComponent(path)}` })
          expect(response.statusCode).toBe(403)
          expect(response.json()).toEqual({ error: { code: 'path_rejected', message: 'path traversal rejected' } })
        }
      }
    } finally {
      await withBinding.app.close()
      await fallback.close()
    }
  })

  test('preserves omission compatibility without filesystem bindings', async () => {
    const app = Fastify()
    await app.register(fileRoutes, { workspace: workspace() })
    const response = await app.inject({ method: 'GET', url: '/api/v1/files?path=open.txt' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ content: 'workspace', access: 'readwrite' })
    await app.close()
  })

  test('checks both move footprints before invoking rename', async () => {
    const { app, user } = await appWithBinding()
    const move = vi.spyOn(user.operations, 'move')
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/move', payload: { from: 'open.txt', to: 'protected/new.txt' } })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: { code: 'readonly', message: 'user binding is readonly' } })
    expect(move).not.toHaveBeenCalled()
    await app.close()
  })
})
