import { beforeEach, afterEach, describe, expect, test } from 'vitest'

import type { Workspace } from '@hachej/boring-agent/shared'

export interface WorkspaceConformanceHarness {
  workspace: Workspace
  cleanup?: () => Promise<void>
}

export function workspaceConformance(
  adapterId: string,
  make: () => Promise<WorkspaceConformanceHarness>,
): void {
  describe(`[${adapterId}] Workspace conformance`, () => {
    let harness: WorkspaceConformanceHarness | undefined
    let workspace!: Workspace

    beforeEach(async () => {
      harness = await make()
      workspace = harness.workspace
    })

    afterEach(async () => {
      await harness?.cleanup?.()
      harness = undefined
    })

    test('read/write roundtrip + stat', async () => {
      await workspace.mkdir('src', { recursive: true })
      await workspace.writeFile('src/hello.txt', 'hello world')

      await expect(workspace.readFile('src/hello.txt')).resolves.toBe('hello world')
      await expect(workspace.readdir('src')).resolves.toContainEqual({
        name: 'hello.txt',
        kind: 'file',
      })
      await expect(workspace.stat('src/hello.txt')).resolves.toMatchObject({
        kind: 'file',
        size: 11,
      })
    })

    test('rename moves file content', async () => {
      await workspace.mkdir('src', { recursive: true })
      await workspace.writeFile('src/original.txt', 'payload')
      await workspace.rename('src/original.txt', 'src/renamed.txt')

      await expect(workspace.readFile('src/original.txt')).rejects.toThrow()
      await expect(workspace.readFile('src/renamed.txt')).resolves.toBe('payload')
    })

    test('mkdir recursive creates nested directories', async () => {
      await workspace.mkdir('a/b/c', { recursive: true })
      await expect(workspace.stat('a/b/c')).resolves.toMatchObject({
        kind: 'dir',
      })
      await expect(workspace.readdir('a/b')).resolves.toContainEqual({
        name: 'c',
        kind: 'dir',
      })
    })

    test('unlink removes file', async () => {
      await workspace.mkdir('tmp', { recursive: true })
      await workspace.writeFile('tmp/remove.txt', 'x')
      await workspace.unlink('tmp/remove.txt')
      await expect(workspace.readFile('tmp/remove.txt')).rejects.toThrow()
    })

    test('rejects path traversal attempts', async () => {
      const bad = '../etc/passwd'
      await expect(workspace.readFile(bad)).rejects.toThrow()
      await expect(workspace.writeFile(bad, 'x')).rejects.toThrow()
      await expect(workspace.rename(bad, 'safe.txt')).rejects.toThrow()
      await expect(workspace.rename('safe.txt', bad)).rejects.toThrow()
    })

    test('rejects absolute path input', async () => {
      await expect(workspace.readFile('/etc/passwd')).rejects.toThrow()
      await expect(workspace.writeFile('/etc/passwd', 'x')).rejects.toThrow()
    })

    test('rejects null-byte path input', async () => {
      const bad = `tmp/bad\0name.txt`
      await expect(workspace.readFile(bad)).rejects.toThrow()
      await expect(workspace.writeFile(bad, 'x')).rejects.toThrow()
    })
  })
}
