import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { SandboxProviderError } from '../../../shared/providerV1'
import { resolveEnvironmentMounts } from '../resolveEnvironmentMounts'

let root: string
let workspaceRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'boring-mounts-'))
  workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function expectMountInvalid(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
    expect.unreachable('expected SANDBOX_MOUNT_INVALID')
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxProviderError)
    expect((error as SandboxProviderError).code).toBe('SANDBOX_MOUNT_INVALID')
  }
}

test('empty mount set resolves to empty', async () => {
  expect(await resolveEnvironmentMounts(workspaceRoot, [])).toEqual([])
})

test('resolves symlinked source roots to their real paths once at create', async () => {
  const realSource = join(root, 'real-knowledge')
  await mkdir(realSource)
  const linkSource = join(root, 'linked-knowledge')
  await symlink(realSource, linkSource)

  const resolved = await resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: linkSource, logicalPath: '/mnt/knowledge', access: 'ro' },
  ])

  expect(resolved).toEqual([
    { sourceRoot: realSource, logicalPath: '/mnt/knowledge', access: 'ro' },
  ])
})

test('rejects a missing source root with a stable code', async () => {
  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: join(root, 'absent'), logicalPath: '/mnt/absent', access: 'ro' },
  ]))
})

test('rejects a non-directory source root', async () => {
  const filePath = join(root, 'file.txt')
  await writeFile(filePath, 'x')
  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: filePath, logicalPath: '/mnt/file', access: 'ro' },
  ]))
})

test('rejects source roots aliasing the primary workspace root', async () => {
  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: workspaceRoot, logicalPath: '/mnt/self', access: 'ro' },
  ]))

  const inside = join(workspaceRoot, 'nested')
  await mkdir(inside)
  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: inside, logicalPath: '/mnt/nested', access: 'ro' },
  ]))
})

test('rejects symlinks that resolve into the workspace root', async () => {
  const inside = join(workspaceRoot, 'secrets')
  await mkdir(inside)
  const sneaky = join(root, 'sneaky')
  await symlink(inside, sneaky)
  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: sneaky, logicalPath: '/mnt/sneaky', access: 'ro' },
  ]))
})

test('rejects the same resolved source root mounted at two logical paths', async () => {
  const source = join(root, 'shared')
  await mkdir(source)
  const alias = join(root, 'shared-alias')
  await symlink(source, alias)

  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: source, logicalPath: '/mnt/a', access: 'ro' },
    { sourceRoot: source, logicalPath: '/mnt/b', access: 'ro' },
  ]))

  // Also caught when the duplicate only appears after realpath resolution.
  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: source, logicalPath: '/mnt/a', access: 'ro' },
    { sourceRoot: alias, logicalPath: '/mnt/b', access: 'ro' },
  ]))
})

test('rejects nested source roots (ancestor declared first)', async () => {
  const parent = join(root, 'a')
  const child = join(parent, 'b')
  await mkdir(child, { recursive: true })

  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: parent, logicalPath: '/mnt/a', access: 'ro' },
    { sourceRoot: child, logicalPath: '/mnt/b', access: 'ro' },
  ]))
})

test('rejects nested source roots (descendant declared first)', async () => {
  const parent = join(root, 'a')
  const child = join(parent, 'b')
  await mkdir(child, { recursive: true })

  await expectMountInvalid(resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: child, logicalPath: '/mnt/b', access: 'ro' },
    { sourceRoot: parent, logicalPath: '/mnt/a', access: 'ro' },
  ]))
})

test('accepts sibling source roots with a common prefix string', async () => {
  const a = join(root, 'data')
  const b = join(root, 'data-extra')
  await mkdir(a)
  await mkdir(b)

  const resolved = await resolveEnvironmentMounts(workspaceRoot, [
    { sourceRoot: a, logicalPath: '/mnt/data', access: 'ro' },
    { sourceRoot: b, logicalPath: '/mnt/data-extra', access: 'ro' },
  ])
  expect(resolved).toHaveLength(2)
})
