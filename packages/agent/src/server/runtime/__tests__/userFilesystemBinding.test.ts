import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createNodeWorkspace } from '@agent-test-host'

import { READONLY_FILESYSTEM_MUTATION_CODE } from '../../../shared/workspace'
import { normalizeRuntimeReadonlyFilesystemPolicy } from '../readonlyFilesystemPolicy'
import { createUserFilesystemBinding } from '../userFilesystemBinding'

describe('createUserFilesystemBinding', () => {
  test('rejects absolute and outside-workspace user paths through the configured primary binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-absolute-'))
    const workspace = createNodeWorkspace(root, {
      readonlyWorkspacePolicy: { readonlyPaths: ['protected'], revision: 'test-v1' },
    })
    const binding = createUserFilesystemBinding(
      workspace,
      normalizeRuntimeReadonlyFilesystemPolicy(['protected']),
    )

    for (const path of [
      '/etc/passwd',
      '/home/operator/.pi/agent/skills/demo/SKILL.md',
      'C:/Windows/System32/config/SAM',
      'C:\\Windows\\System32\\config\\SAM',
      '\\\\server\\share\\secret.txt',
      '../outside.txt',
    ]) {
      await expect(binding.operations.read({ filesystem: 'user', path }))
        .rejects.toMatchObject({ statusCode: 400 })
      await expect(binding.operations.stat({ filesystem: 'user', path }))
        .rejects.toMatchObject({ statusCode: 400 })
    }
  })

  test('projects the real policy and keeps guarded writable siblings functional', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-'))
    await mkdir(join(root, 'mixed/protected'), { recursive: true })
    await writeFile(join(root, 'mixed/protected/locked.txt'), 'locked')
    const readonlyWorkspacePolicy = { readonlyPaths: ['mixed/protected'], revision: 'test-v1' }
    const workspace = createNodeWorkspace(root, { readonlyWorkspacePolicy })
    const binding = createUserFilesystemBinding(
      workspace,
      normalizeRuntimeReadonlyFilesystemPolicy(readonlyWorkspacePolicy.readonlyPaths),
    )

    await expect(binding.operations.resolveAccess?.({ filesystem: 'user', path: 'mixed/protected/locked.txt' }))
      .resolves.toMatchObject({ access: 'readonly', capabilities: { write: false, delete: false } })
    await expect(binding.operations.write?.({ filesystem: 'user', path: 'mixed/sibling.txt', content: 'ok' }))
      .resolves.toMatchObject({ mtimeMs: expect.any(Number) })
    await expect(binding.operations.write?.({ filesystem: 'user', path: 'mixed/protected/locked.txt', content: 'no' }))
      .rejects.toMatchObject({ code: READONLY_FILESYSTEM_MUTATION_CODE, filesystem: 'user', operation: 'write' })
  })
})
