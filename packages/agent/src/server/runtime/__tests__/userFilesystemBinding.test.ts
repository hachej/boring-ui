import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createNodeWorkspace } from '@agent-test-host'
import { READONLY_FILESYSTEM_MUTATION_CODE } from '../../../shared/workspace'
import { normalizeRuntimeReadonlyFilesystemPolicy } from '../readonlyFilesystemPolicy'
import { sandboxRuntimeHostOperations } from '../sandboxRuntimeHost'
import { createUserFilesystemBinding } from '../userFilesystemBinding'
describe('createUserFilesystemBinding', () => {
  test('leaves path confinement to the Workspace adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-'))
    const workspace = createNodeWorkspace(root)
    const binding = createUserFilesystemBinding(workspace, normalizeRuntimeReadonlyFilesystemPolicy(['protected']), async (path) => await sandboxRuntimeHostOperations.resolveRealWorkspacePath(root, path))
    for (const path of ['/etc/passwd', 'C:/Windows/System32/config/SAM', '\\\\server\\share\\secret', '../outside']) {
      await expect(binding.operations.read({ filesystem: 'user', path })).rejects.toMatchObject({ statusCode: 400 })
      await expect(binding.operations.stat({ filesystem: 'user', path })).rejects.toMatchObject({ statusCode: 400 })
    }
  })

  test('rejects symlink aliases to readonly targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-link-'))
    await mkdir(join(root, 'protected'), { recursive: true })
    await writeFile(join(root, 'protected/locked.txt'), 'locked')
    await symlink('protected', join(root, 'alias'))
    const binding = createUserFilesystemBinding(createNodeWorkspace(root), normalizeRuntimeReadonlyFilesystemPolicy(['protected']),
      async (path) => await sandboxRuntimeHostOperations.resolveRealWorkspacePath(root, path))
    await expect(binding.operations.write?.({ filesystem: 'user', path: 'alias/locked.txt', content: 'bypass' }))
      .rejects.toMatchObject({ code: READONLY_FILESYSTEM_MUTATION_CODE })
    await expect(readFile(join(root, 'protected/locked.txt'), 'utf8')).resolves.toBe('locked')
  })

  test('rejects a protected lexical path aliased to a writable target', async () => {
    // Reverse of the previous case: the protected name `.agents` is a symlink
    // whose canonical target (`writable`) is NOT protected. Enforcing only the
    // canonical path would authorize the write; the requested-path check denies it.
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-fwd-'))
    await mkdir(join(root, 'writable'), { recursive: true })
    await writeFile(join(root, 'writable/rules.md'), 'rules')
    await symlink('writable', join(root, '.agents'))
    const binding = createUserFilesystemBinding(createNodeWorkspace(root), normalizeRuntimeReadonlyFilesystemPolicy(['.agents']),
      async (path) => await sandboxRuntimeHostOperations.resolveRealWorkspacePath(root, path))
    await expect(binding.operations.write?.({ filesystem: 'user', path: '.agents/rules.md', content: 'bypass' }))
      .rejects.toMatchObject({ code: READONLY_FILESYSTEM_MUTATION_CODE })
    await expect(readFile(join(root, 'writable/rules.md'), 'utf8')).resolves.toBe('rules')
  })

  test('enforces readonly mutations while preserving writable siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-user-binding-'))
    await mkdir(join(root, 'mixed/protected'), { recursive: true })
    await writeFile(join(root, 'mixed/protected/locked.txt'), 'locked')
    const binding = createUserFilesystemBinding(
      createNodeWorkspace(root),
      normalizeRuntimeReadonlyFilesystemPolicy(['mixed/protected']),
      async (path) => await sandboxRuntimeHostOperations.resolveRealWorkspacePath(root, path),
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
