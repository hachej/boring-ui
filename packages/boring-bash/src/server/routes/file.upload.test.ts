import Fastify from 'fastify'
import type { Workspace } from '@hachej/boring-agent/shared'
import { describe, expect, it } from 'vitest'
import { fileRoutes } from './file'

function createWorkspace(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const dirs = new Set(['.', 'src', 'assets', 'assets/images', 'assets/uploads'])
  const writes: Array<{ path: string; content: string }> = []
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
      writes.push({ path, content: text })
    },
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
      files.set(to, value)
      files.delete(from)
    },
  }
  return { workspace, files, writes }
}

async function createApp(initial?: Record<string, string>) {
  const state = createWorkspace(initial)
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 })
  await app.register(fileRoutes, { workspace: state.workspace })
  return { app, ...state }
}

const encoded = (value: string) => Buffer.from(value).toString('base64')

describe('file upload route', () => {
  it('preserves the exact filename in an explicit target directory', async () => {
    const { app, files } = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'Report final.md',
        directory: 'src',
        preserveName: true,
        collision: 'error',
        contentType: 'text/markdown',
        contentBase64: encoded('# report'),
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      path: 'src/Report final.md',
      markdownUrl: 'src/Report final.md',
      skipped: false,
    })
    expect(files.get('src/Report final.md')).toBe('# report')
    await app.close()
  })

  it.each([
    { filename: '../secret.txt', directory: 'src' },
    { filename: '/secret.txt', directory: 'src' },
    { filename: 'C:\\secret.txt', directory: 'src' },
    { filename: 'bad\0name.txt', directory: 'src' },
    { filename: 'safe.txt', directory: '../outside' },
    { filename: 'safe.txt', directory: '/tmp' },
    { filename: 'safe.txt', directory: 'src\\nested' },
    { filename: 'safe.txt', directory: 'src/../outside' },
  ])('rejects unsafe preserved upload paths: %j', async (payload) => {
    const { app, writes } = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: { ...payload, preserveName: true, contentBase64: encoded('x') },
    })
    expect(response.statusCode).toBe(400)
    expect(writes).toHaveLength(0)
    await app.close()
  })

  it('replaces an existing file only when replace is explicit', async () => {
    const { app, files, writes } = await createApp({ 'src/existing.txt': 'old' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'existing.txt', directory: 'src', preserveName: true,
        collision: 'replace', contentBase64: encoded('new'),
      },
    })
    expect(response.statusCode).toBe(200)
    expect(files.get('src/existing.txt')).toBe('new')
    expect(writes).toHaveLength(1)
    await app.close()
  })

  it('reports skip without overwriting an existing file', async () => {
    const { app, files, writes } = await createApp({ 'src/existing.txt': 'old' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'existing.txt', directory: 'src', preserveName: true,
        collision: 'skip', contentBase64: encoded('new'),
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ path: 'src/existing.txt', skipped: true, reason: 'exists' })
    expect(files.get('src/existing.txt')).toBe('old')
    expect(writes).toHaveLength(0)
    await app.close()
  })

  it('returns conflict and does not overwrite when collision behavior is error', async () => {
    const { app, files, writes } = await createApp({ 'src/existing.txt': 'old' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'existing.txt', directory: 'src', preserveName: true,
        collision: 'error', contentBase64: encoded('new'),
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'already_exists' } })
    expect(files.get('src/existing.txt')).toBe('old')
    expect(writes).toHaveLength(0)
    await app.close()
  })

  it.each(['skip', 'error'] as const)('serializes concurrent %s requests so exactly one write wins', async (collision) => {
    const { app, files, writes } = await createApp()
    const request = (content: string) => app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'raced.txt', directory: 'src', preserveName: true,
        collision, contentBase64: encoded(content),
      },
    })

    const responses = await Promise.all([request('first'), request('second')])

    expect(writes).toHaveLength(1)
    expect(['first', 'second']).toContain(files.get('src/raced.txt'))
    if (collision === 'skip') {
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
      expect(responses.map((response) => response.json().skipped).sort()).toEqual([false, true])
    } else {
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    }
    await app.close()
  })

  it('serializes mixed skip and replace requests on the same preserved path', async () => {
    const { app, workspace, files, writes } = await createApp()
    const originalWrite = workspace.writeBinaryFile!.bind(workspace)
    let announceBlockedWrite!: () => void
    const blockedWrite = new Promise<void>((resolve) => { announceBlockedWrite = resolve })
    let releaseBlockedWrite!: () => void
    const writeGate = new Promise<void>((resolve) => { releaseBlockedWrite = resolve })
    workspace.writeBinaryFile = async (path, content) => {
      if (path === 'src/mixed.txt' && new TextDecoder().decode(content) === 'skip') {
        announceBlockedWrite()
        await writeGate
      }
      await originalWrite(path, content)
    }
    const request = (collision: 'skip' | 'replace', content: string) => app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'mixed.txt', directory: 'src', preserveName: true,
        collision, contentBase64: encoded(content),
      },
    })

    const skipResponse = request('skip', 'skip')
    await blockedWrite
    const replaceResponse = request('replace', 'replace')
    // Let the replace request advance. It must remain behind the same path lock
    // while the skip request is paused between its existence check and write.
    for (let turn = 0; turn < 10; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(writes).toHaveLength(0)

    releaseBlockedWrite()
    const responses = await Promise.all([skipResponse, replaceResponse])
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
    expect(writes).toHaveLength(2)
    expect(files.get('src/mixed.txt')).toBe('replace')
    await app.close()
  })

  it('accepts exactly 10 MiB and rejects one byte over', async () => {
    const { app, writes } = await createApp()
    const exactLimit = Buffer.alloc(10 * 1024 * 1024, 97).toString('base64')
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'limit.bin', directory: '.', preserveName: true,
        collision: 'replace', contentBase64: exactLimit,
      },
    })
    expect(accepted.statusCode).toBe(200)
    expect(writes).toHaveLength(1)

    const overLimit = Buffer.alloc(10 * 1024 * 1024 + 1, 97).toString('base64')
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'too-large.bin', directory: '.', preserveName: true,
        collision: 'replace', contentBase64: overLimit,
      },
    })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).toMatchObject({ error: { code: 'validation_error', field: 'contentBase64' } })
    expect(writes).toHaveLength(1)
    await app.close()
  })

  it('keeps backwards-compatible unique naming and non-image upload routing by default', async () => {
    const { app, writes } = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: { filename: 'notes.txt', contentType: 'text/plain', contentBase64: encoded('hello') },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { path: string; skipped?: boolean }
    expect(body.path).toMatch(/^assets\/uploads\/notes-[a-z0-9]+-[a-z0-9]+\.txt$/)
    expect(body.skipped).toBeUndefined()
    expect(writes[0]?.path).toBe(body.path)
    await app.close()
  })
})
