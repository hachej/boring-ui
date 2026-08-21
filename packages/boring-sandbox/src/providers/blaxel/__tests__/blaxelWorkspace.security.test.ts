import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SandboxHandleRecord, SandboxHandleStore, Workspace } from '@hachej/boring-agent/shared'
import { describe, expect, test, vi } from 'vitest'

import { createBlaxelSandboxProvider } from '../createBlaxelSandboxProvider'
import { normalizeBlaxelError } from '../errors'
import { createMockBlaxelClient } from './mockBlaxelClient'

type Watcher = ReturnType<NonNullable<Workspace['watch']>>
type WorkspaceChangeEvent = Parameters<Watcher['subscribe']>[0] extends (event: infer Event) => void ? Event : never

class MemoryStore implements SandboxHandleStore {
  private readonly records = new Map<string, SandboxHandleRecord>()
  async get(id: string) { return this.records.get(id) ?? null }
  async put(record: SandboxHandleRecord) { this.records.set(record.workspaceId, record) }
  async delete(id: string) { this.records.delete(id) }
  async list() { return [...this.records.values()] }
}

async function harness() {
  const client = await createMockBlaxelClient()
  const provider = createBlaxelSandboxProvider({
    client,
    handleStore: new MemoryStore(),
    region: 'eu-fra-1',
  })
  const pair = await provider.create({ workspaceRoot: '/ignored', workspaceId: `security-${Math.random()}`, sessionId: 'test' })
  return { client, pair }
}

describe('Blaxel workspace security and native watch mapping', () => {
  test('rejects final-component symlinks for text, binary, read-with-stat, and rename destinations', async () => {
    const { client, pair } = await harness()
    const outside = await mkdtemp(join(tmpdir(), 'boring-blaxel-outside-'))
    const outsideFile = join(outside, 'secret.txt')
    const outsideDir = join(outside, 'directory')
    await writeFile(outsideFile, 'unchanged')
    await mkdir(outsideDir)
    await symlink(outsideFile, join(client.root, 'file-link'))
    await symlink(outsideDir, join(client.root, 'dir-link'))

    await expect(pair.workspace.writeFile('file-link', 'escaped')).rejects.toMatchObject({ code: 'EPERM' })
    await expect(pair.workspace.writeBinaryFile?.('file-link', new Uint8Array([1]))).rejects.toMatchObject({ code: 'EPERM' })
    await expect(pair.workspace.readFileWithStat?.('file-link')).rejects.toMatchObject({ code: 'EPERM' })
    await pair.workspace.writeFile('source.txt', 'safe')
    await expect(pair.workspace.rename('source.txt', 'dir-link')).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(outsideFile, 'utf8')).toBe('unchanged')
    await pair.dispose()
  })

  test('exclusive binary create preserves existing bytes and cleans temporary files', async () => {
    const { pair } = await harness()
    await pair.workspace.writeFile('existing.bin', 'old')
    await expect(pair.workspace.createBinaryFile?.('existing.bin', new TextEncoder().encode('new')))
      .rejects.toMatchObject({ code: 'EEXIST' })
    expect(await pair.workspace.readFile('existing.bin')).toBe('old')
    await pair.workspace.createBinaryFile?.('fresh.bin', new TextEncoder().encode('fresh'))
    expect(await pair.workspace.readFile('fresh.bin')).toBe('fresh')
    const raced = await Promise.allSettled([
      pair.workspace.createBinaryFile!('race.bin', new TextEncoder().encode('first')),
      pair.workspace.createBinaryFile!('race.bin', new TextEncoder().encode('second')),
    ])
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(raced.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'EEXIST' } })
    expect(['first', 'second']).toContain(await pair.workspace.readFile('race.bin'))
    expect((await pair.workspace.readdir('.')).some((entry) => entry.name.includes('.boring-upload-'))).toBe(false)
    await pair.dispose()
  })

  test('exclusive binary create falls back to guest cleanup when SDK cleanup fails', async () => {
    const { client, pair } = await harness()
    const remote = client.sandboxes.get(pair.sandbox.id)!
    vi.spyOn(remote.fs, 'rm').mockRejectedValue(new Error('injected SDK cleanup failure'))

    await pair.workspace.createBinaryFile?.('fallback.bin', new TextEncoder().encode('fresh'))
    expect(await pair.workspace.readFile('fallback.bin')).toBe('fresh')
    expect((await pair.workspace.readdir('.')).some((entry) => entry.name.includes('.boring-upload-'))).toBe(false)
    await pair.dispose()
  })

  test.each([
    ['successful destination create', 'cleanup-success.bin', false],
    ['destination collision', 'cleanup-collision.bin', true],
  ])('reports incomplete temp cleanup without replacing the %s outcome', async (_label, path, collision) => {
    const { client, pair } = await harness()
    const remote = client.sandboxes.get(pair.sandbox.id)!
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    if (collision) await pair.workspace.writeFile(path, 'old')
    vi.spyOn(remote.fs, 'rm').mockRejectedValue(new Error('injected SDK cleanup failure'))
    const originalExec = remote.process.exec.bind(remote.process)
    vi.spyOn(remote.process, 'exec').mockImplementation(async (request) => {
      if (request.command.includes('rm -f --')) {
        return {
          command: request.command,
          exitCode: 1,
          name: 'cleanup-failure',
          pid: 'cleanup-failure',
          status: 'failed',
          stderr: 'injected guest cleanup failure',
          stdout: '',
          workingDir: request.workingDir ?? '/workspace',
        }
      }
      return await originalExec(request)
    })

    const create = pair.workspace.createBinaryFile!(path, new TextEncoder().encode('new'))
    if (collision) await expect(create).rejects.toMatchObject({ code: 'EEXIST' })
    else await expect(create).resolves.toBeUndefined()
    expect(await pair.workspace.readFile(path)).toBe(collision ? 'old' : 'new')
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('exclusive create temporary-file cleanup failed'))
    expect((await pair.workspace.readdir('.')).some((entry) => entry.name.includes('.boring-upload-'))).toBe(true)
    warning.mockRestore()
    await pair.dispose()
  })

  test('combines SDK parent path and name, shares one stream, and suppresses local/native duplicates', async () => {
    const { client, pair } = await harness()
    const watcher = pair.workspace.watch?.()
    expect(watcher).toBeDefined()
    const events: WorkspaceChangeEvent[] = []
    const unsubscribeA = watcher!.subscribe((event) => events.push(event))
    const unsubscribeB = watcher!.subscribe(() => {})
    expect(client.watchState.starts).toBe(1)

    for (const callback of client.watchState.callbacks) {
      await callback({ op: 'WRITE', path: '/workspace/nested', name: 'file.txt' })
    }
    expect(events).toContainEqual({ op: 'write', path: 'nested/file.txt' })

    await pair.workspace.writeFile('dedup.txt', 'one')
    for (const callback of client.watchState.callbacks) {
      await callback({ op: 'WRITE', path: '/workspace', name: 'dedup.txt' })
    }
    expect(events.filter((event) => event.op === 'write' && event.path === 'dedup.txt')).toHaveLength(1)

    unsubscribeA()
    unsubscribeB()
    expect(client.watchState.closes).toBe(0)
    watcher!.close()
    watcher!.close()
    expect(client.watchState.closes).toBe(1)
    await pair.dispose()
  })

  test('normalizes confinement transport failures without retaining raw secret-bearing causes', async () => {
    const { client, pair } = await harness()
    const secret = 'blaxel-canary-secret'
    const remote = client.sandboxes.get(pair.sandbox.id)!
    const originalExec = remote.process.exec
    remote.process.exec = async () => { throw Object.assign(new Error(`Authorization: Bearer ${secret} /home/user/private`), { status: 401 }) }
    const failure = await pair.workspace.writeFile('file.txt', 'value').catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'BLAXEL_AUTH_FAILED' })
    expect((failure as Error).message).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
    remote.process.exec = originalExec
    await pair.dispose()
  })

  test('fails stable when a successful guest helper response exceeds the local retention cap', async () => {
    const { client, pair } = await harness()
    const remote = client.sandboxes.get(pair.sandbox.id)!
    const originalExec = remote.process.exec
    remote.process.exec = async (request) => request.command.includes('stat -Lc')
      ? {
          command: request.command, exitCode: 0, name: 'oversized', pid: 'oversized', status: 'completed',
          stderr: '', stdout: 'x'.repeat(20 * 1024), workingDir: request.workingDir ?? '/workspace',
        }
      : await originalExec(request)
    await expect(pair.workspace.stat('.')).rejects.toMatchObject({ code: 'BLAXEL_RUNTIME_UNQUALIFIED' })
    remote.process.exec = originalExec
    await pair.dispose()
  })

  test('redacted provider errors do not retain raw object fields or causes', () => {
    const secret = 'recursive-canary-secret'
    const failure = normalizeBlaxelError({ status: 403, authorization: `Bearer ${secret}`, nested: { secret } })
    expect(failure.code).toBe('BLAXEL_AUTH_FAILED')
    expect(failure.message).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
  })
})
