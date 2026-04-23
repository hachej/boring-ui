import { stat } from 'node:fs/promises'
import { describe, expect, expectTypeOf, test } from 'vitest'

import type { Sandbox } from '../shared/sandbox'
import type { UiBridge } from '../shared/ui-bridge'
import type { Workspace } from '../shared/workspace'
import {
  createTempWorkspace,
  mockSandbox,
  mockUiBridge,
  mockWorkspace,
  spawnBackend,
} from './helpers'

const ENOENT_CODE = 'ENOENT'
const EEXIST_CODE = 'EEXIST'
const EISDIR_CODE = 'EISDIR'
const EPERM_CODE = 'EPERM'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('test helpers', () => {
  test('mockWorkspace conforms to Workspace and supports roundtrip operations', async () => {
    const workspace = mockWorkspace()
    expectTypeOf(workspace).toMatchTypeOf<Workspace>()

    await workspace.mkdir('src', { recursive: true })
    await workspace.writeFile('src/a.ts', 'export {}')
    expect(await workspace.readFile('src/a.ts')).toBe('export {}')
    expect(await workspace.readdir('src')).toEqual([{ name: 'a.ts', kind: 'file' }])

    await workspace.rename('src/a.ts', 'src/b.ts')
    expect(await workspace.readFile('src/b.ts')).toBe('export {}')
    await workspace.unlink('src/b.ts')

    await expect(workspace.readFile('src/b.ts')).rejects.toSatisfy(
      (error: unknown) =>
        (error as { code?: string }).code === ENOENT_CODE,
    )
  })

  test('mockWorkspace mirrors expected fs edge-case errors', async () => {
    const workspace = mockWorkspace()

    await workspace.mkdir('dir', { recursive: true })
    await expect(workspace.readFile('dir')).rejects.toMatchObject({ code: EISDIR_CODE })
    await expect(workspace.mkdir('dir')).rejects.toMatchObject({ code: EEXIST_CODE })

    await workspace.mkdir('dir/sub', { recursive: true })
    await expect(workspace.rename('dir', 'dir/sub/moved')).rejects.toMatchObject({
      code: EPERM_CODE,
    })
  })

  test('mockSandbox supports queueable exec results and call history', async () => {
    const workspace = mockWorkspace()
    const sandbox = mockSandbox()
    expectTypeOf(sandbox).toMatchTypeOf<Sandbox>()

    await sandbox.init({ workspace, sessionId: 'session-1' })
    sandbox.queueResult({
      stdout: encoder.encode('queued-stdout'),
      exitCode: 17,
      durationMs: 5,
    })

    const result = await sandbox.exec('echo hello', { timeoutMs: 500 })
    expect(decoder.decode(result.stdout)).toBe('queued-stdout')
    expect(result.exitCode).toBe(17)
    expect(sandbox.history).toEqual([{ cmd: 'echo hello', opts: { timeoutMs: 500 } }])
  })

  test('mockUiBridge exposes command queue + subscribers', async () => {
    const bridge = mockUiBridge({ tab: 'readme' })
    expectTypeOf(bridge).toMatchTypeOf<UiBridge>()

    const seenSeq: number[] = []
    const unsubscribe = bridge.subscribeCommands((cmd) => {
      seenSeq.push(cmd.seq)
    })

    const first = await bridge.postCommand({
      kind: 'openFile',
      params: { path: 'README.md' },
    })
    expect(first.status).toBe('ok')
    expect(seenSeq).toEqual([first.seq])
    expect(bridge.commands).toHaveLength(1)

    unsubscribe()
    const second = await bridge.postCommand({
      kind: 'expandToFile',
      params: { path: 'src/index.ts' },
    })
    expect(second.seq).toBeGreaterThan(first.seq)
    expect(seenSeq).toEqual([first.seq])
  })

  test('createTempWorkspace returns real NodeWorkspace + cleanup', async () => {
    const temp = await createTempWorkspace()
    expectTypeOf(temp.workspace).toMatchTypeOf<Workspace>()

    await temp.workspace.mkdir('nested', { recursive: true })
    await temp.workspace.writeFile('nested/file.txt', 'ok')
    expect(await temp.workspace.readFile('nested/file.txt')).toBe('ok')

    await temp.cleanup()
    await expect(stat(temp.root)).rejects.toBeDefined()
  })

  test('spawnBackend starts a Fastify instance on a random port', async () => {
    const backend = await spawnBackend({
      register(app) {
        app.get('/__ping', async () => ({ ok: true }))
      },
    })

    try {
      const response = await fetch(`${backend.baseUrl}/__ping`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    } finally {
      await backend.close()
    }
  })
})
