import Fastify from 'fastify'
import type { Workspace } from '@hachej/boring-agent/shared'
import { describe, expect, it } from 'vitest'
import { fileRoutes } from './file'

function createWorkspace(initial: Record<string, string> = {}, exclusive = true) {
  const files = new Map(Object.entries(initial))
  const dirs = new Set(['.', 'src', 'assets', 'assets/images', 'assets/uploads'])
  const writes: Array<{ path: string; content: string; exclusive: boolean }> = []
  const workspace: Workspace = {
    root: '/workspace',
    runtimeContext: { runtimeCwd: '/workspace' },
    async readFile(path) {
      if (path === '.boring/settings') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    },
    async writeFile(path, content) { files.set(path, content) },
    async writeBinaryFile(path, content) {
      const text = new TextDecoder().decode(content)
      files.set(path, text)
      writes.push({ path, content: text, exclusive: false })
    },
    ...(exclusive ? {
      async createBinaryFile(path: string, content: Uint8Array) {
        if (files.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        const text = new TextDecoder().decode(content)
        files.set(path, text)
        writes.push({ path, content: text, exclusive: true })
      },
    } : {}),
    async unlink(path) { files.delete(path) },
    async readdir() { return [] },
    async stat(path) {
      if (dirs.has(path)) return { kind: 'dir', size: 0, mtimeMs: 1 }
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { kind: 'file', size: value.length, mtimeMs: 2 }
    },
    async mkdir(path) { dirs.add(path) },
    async rename(from, to) {
      const value = files.get(from)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      files.set(to, value); files.delete(from)
    },
  }
  return { workspace, files, writes }
}

async function appFor(workspace: Workspace) {
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 })
  await app.register(fileRoutes, { workspace })
  return app
}

const encoded = (value: string) => Buffer.from(value).toString('base64')
const binaryPayload = (overrides: Record<string, unknown> = {}) => ({
  path: 'src/report.txt',
  contentBase64: encoded('report'),
  ifExists: 'error',
  ...overrides,
})

describe('exact binary write route', () => {
  it('writes an exact relative path without using legacy asset naming', async () => {
    const state = createWorkspace()
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload() })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'written', path: 'src/report.txt' })
    expect(state.files.get('src/report.txt')).toBe('report')
    expect(state.writes[0]?.exclusive).toBe(true)
    await app.close()
  })

  it.each(['skip', 'error'] as const)('never overwrites an existing file for %s', async (ifExists) => {
    const state = createWorkspace({ 'src/report.txt': 'old' })
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ ifExists }) })
    expect(response.statusCode).toBe(ifExists === 'skip' ? 200 : 409)
    expect(response.json()).toEqual({
      status: ifExists === 'skip' ? 'skipped' : 'conflict',
      path: 'src/report.txt',
      reason: 'already-exists',
    })
    expect(state.files.get('src/report.txt')).toBe('old')
    expect(state.writes).toHaveLength(0)
    await app.close()
  })

  it('replaces only with an explicit replace policy', async () => {
    const state = createWorkspace({ 'src/report.txt': 'old' })
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ ifExists: 'replace', contentBase64: encoded('new') }) })
    expect(response.statusCode).toBe(200)
    expect(state.files.get('src/report.txt')).toBe('new')
    expect(state.writes[0]?.exclusive).toBe(false)
    await app.close()
  })

  it.each([undefined, '', 'overwrite', true])('strictly rejects malformed policy %j', async (ifExists) => {
    const state = createWorkspace()
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ ifExists }) })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'validation_error', field: 'ifExists' } })
    expect(state.writes).toHaveLength(0)
    await app.close()
  })

  it.each([undefined, null, 42, { path: 'src/report.txt' }])('rejects a non-string path wire value %j', async (path) => {
    const state = createWorkspace()
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ path }) })
    expect(response.statusCode).toBe(400)
    expect(state.writes).toHaveLength(0)
    await app.close()
  })

  it.each([' src/report.txt', 'src/report.txt '])('preserves exact filename whitespace for %j', async (path) => {
    const state = createWorkspace()
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ path }) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'written', path })
    expect(state.writes[0]?.path).toBe(path)
    await app.close()
  })

  it('returns an exact-path conflict without trimming the filename', async () => {
    const path = 'src/report.txt '
    const state = createWorkspace({ [path]: 'old' })
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ path }) })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ status: 'conflict', path, reason: 'already-exists' })
    expect(state.files.get(path)).toBe('old')
    await app.close()
  })

  it('returns 501 rather than weakening error/skip when exclusive create is unavailable', async () => {
    const state = createWorkspace({}, false)
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload() })
    expect(response.statusCode).toBe(501)
    expect(state.writes).toHaveLength(0)
    await app.close()
  })

  it('is atomic across independent route instances sharing one adapter', async () => {
    const state = createWorkspace()
    const [firstApp, secondApp] = await Promise.all([appFor(state.workspace), appFor(state.workspace)])
    const request = (app: Awaited<ReturnType<typeof appFor>>, value: string) => app.inject({
      method: 'POST', url: '/api/v1/files/binary',
      payload: binaryPayload({ contentBase64: encoded(value) }),
    })
    const responses = await Promise.all([request(firstApp, 'first'), request(secondApp, 'second')])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    expect(state.writes).toHaveLength(1)
    expect(['first', 'second']).toContain(state.files.get('src/report.txt'))
    await Promise.all([firstApp.close(), secondApp.close()])
  })

  it('accepts exactly 10 MiB and rejects one byte over', async () => {
    const state = createWorkspace()
    const app = await appFor(state.workspace)
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ path: 'limit.bin', ifExists: 'replace', contentBase64: Buffer.alloc(10 * 1024 * 1024, 1).toString('base64') }) })
    expect(accepted.statusCode).toBe(200)
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/files/binary', payload: binaryPayload({ path: 'too-large.bin', ifExists: 'replace', contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64') }) })
    expect(rejected.statusCode).toBe(400)
    await app.close()
  })
})

describe('legacy asset upload route', () => {
  it('keeps unique naming and non-image routing', async () => {
    const state = createWorkspace()
    const app = await appFor(state.workspace)
    const response = await app.inject({ method: 'POST', url: '/api/v1/files/upload', payload: { filename: 'notes.txt', contentType: 'text/plain', contentBase64: encoded('hello') } })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { path: string }
    expect(body.path).toMatch(/^assets\/uploads\/notes-[a-z0-9]+-[a-z0-9]+\.txt$/)
    expect(state.writes[0]?.path).toBe(body.path)
    await app.close()
  })
})
