import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createNodeWorkspace } from '@agent-test-host'
import { READONLY_FILESYSTEM_MUTATION_CODE } from '../../../shared/workspace'
import { normalizeRuntimeReadonlyFilesystemPolicy } from '../readonlyFilesystemPolicy'
import { createUserFilesystemBinding } from '../userFilesystemBinding'

describe('createUserFilesystemBinding', () => {
  test('leaves path confinement to the Workspace adapter', async () => {
    const workspace = createNodeWorkspace(await mkdtemp(join(tmpdir(), 'boring-user-binding-')))
    const binding = createUserFilesystemBinding(workspace, normalizeRuntimeReadonlyFilesystemPolicy(['protected']))
    for (const path of ['/etc/passwd', 'C:/Windows/System32/config/SAM', '\\\\server\\share\\secret', '../outside']) {
      await expect(binding.operations.read({ filesystem: 'user', path })).rejects.toMatchObject({ statusCode: 400 })
      await expect(binding.operations.stat({ filesystem: 'user', path })).rejects.toMatchObject({ statusCode: 400 })
    }
  })

  test('enforces readonly mutations while preserving writable siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-'))
    await mkdir(join(root, 'mixed/protected'), { recursive: true })
    await writeFile(join(root, 'mixed/protected/locked.txt'), 'locked')
    const binding = createUserFilesystemBinding(
      createNodeWorkspace(root),
      normalizeRuntimeReadonlyFilesystemPolicy(['mixed/protected']),
    )
    await expect(binding.operations.resolveAccess?.({ filesystem: 'user', path: 'mixed/protected/locked.txt' }))
      .resolves.toMatchObject({ access: 'readonly', capabilities: { write: false, delete: false } })
    await expect(binding.operations.write?.({ filesystem: 'user', path: 'mixed/sibling.txt', content: 'ok' }))
      .resolves.toMatchObject({ mtimeMs: expect.any(Number) })
    await expect(binding.operations.write?.({ filesystem: 'user', path: 'mixed/protected/locked.txt', content: 'no' }))
      .rejects.toMatchObject({ code: READONLY_FILESYSTEM_MUTATION_CODE, filesystem: 'user', operation: 'write' })
    await expect(binding.operations.move?.({ filesystem: 'user', from: 'mixed/sibling.txt', to: 'mixed' }))
      .rejects.toMatchObject({ code: READONLY_FILESYSTEM_MUTATION_CODE, operation: 'write' })
  })
})
