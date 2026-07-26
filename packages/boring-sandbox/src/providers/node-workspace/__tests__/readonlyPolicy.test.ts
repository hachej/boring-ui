import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import type { Workspace } from '@hachej/boring-agent/shared'

import {
  createNodeWorkspace,
  disposeNodeWorkspace,
  whenNodeWorkspaceReady,
} from '../createNodeWorkspace'

const roots: string[] = []
const workspaces: Workspace[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'boring-readonly-workspace-'))
  roots.push(root)
  await mkdir(join(root, 'mixed', 'protected', 'nested'), { recursive: true })
  await mkdir(join(root, 'mixed', 'writable'), { recursive: true })
  await mkdir(join(root, 'safe'), { recursive: true })
  await writeFile(join(root, 'mixed', 'protected', 'locked.txt'), 'LOCKED', 'utf8')
  await writeFile(join(root, 'mixed', 'protected', 'nested', 'deep.txt'), 'DEEP', 'utf8')
  await writeFile(join(root, 'mixed', 'writable', 'open.txt'), 'OPEN', 'utf8')
  await writeFile(join(root, 'safe', 'open.txt'), 'SAFE', 'utf8')
  const workspace = createNodeWorkspace(root, {
    readonlyWorkspacePolicy: {
      readonlyPaths: ['mixed/protected', 'future/locked'],
      revision: 'policy-v1',
    },
  })
  workspaces.push(workspace)
  await whenNodeWorkspaceReady(workspace)
  return { root, workspace }
}

function isReadonlyFilesystemMutationError(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { code?: unknown }).code === 'readonly')
}

function expectReadonly(operation: string) {
  return expect.objectContaining({
    code: 'readonly',
    statusCode: 403,
    filesystem: 'user',
    operation,
  })
}

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) disposeNodeWorkspace(workspace)
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Node Workspace readonly policy', () => {
  test('keeps reads available and denies every protected write shape without partial effects', async () => {
    const { root, workspace } = await fixture()

    await expect(workspace.readFile('mixed/protected/locked.txt')).resolves.toBe('LOCKED')
    await expect(workspace.readdir('mixed/protected')).resolves.toContainEqual({ name: 'locked.txt', kind: 'file' })
    await expect(workspace.stat('mixed/protected/locked.txt')).resolves.toMatchObject({ kind: 'file' })

    await expect(workspace.writeFile('mixed/protected/locked.txt', 'changed')).rejects.toMatchObject(expectReadonly('write'))
    await expect(workspace.writeBinaryFile?.('mixed/protected/new.bin', new Uint8Array([1]))).rejects.toMatchObject(expectReadonly('write'))
    await expect(workspace.writeFileWithStat?.('mixed/protected/new.txt', 'new')).rejects.toMatchObject(expectReadonly('write'))
    await expect(workspace.writeBinaryFileWithStat?.('mixed/protected/new.bin', new Uint8Array([1]))).rejects.toMatchObject(expectReadonly('write'))
    await expect(workspace.mkdir('mixed/protected/new-dir', { recursive: true })).rejects.toMatchObject(expectReadonly('create-child'))
    await expect(workspace.mkdir('future', { recursive: true })).rejects.toMatchObject(expectReadonly('create-child'))
    await expect(workspace.unlink('mixed/protected/locked.txt')).rejects.toMatchObject(expectReadonly('delete'))
    await expect(workspace.unlink('mixed')).rejects.toMatchObject(expectReadonly('delete'))
    await expect(workspace.rename('mixed/protected/locked.txt', 'safe/moved.txt')).rejects.toMatchObject(expectReadonly('move-from'))
    await expect(workspace.rename('safe/open.txt', 'mixed/protected/replaced.txt')).rejects.toMatchObject(expectReadonly('create-child'))

    await expect(readFile(join(root, 'mixed', 'protected', 'locked.txt'), 'utf8')).resolves.toBe('LOCKED')
    await expect(readFile(join(root, 'mixed', 'protected', 'nested', 'deep.txt'), 'utf8')).resolves.toBe('DEEP')
    await expect(readFile(join(root, 'safe', 'open.txt'), 'utf8')).resolves.toBe('SAFE')
  })

  test('permits writable siblings under a mixed ancestor', async () => {
    const { workspace } = await fixture()

    await workspace.writeFile('mixed/writable/open.txt', 'UPDATED')
    await workspace.mkdir('mixed/writable/new/deep', { recursive: true })
    await workspace.writeFile('mixed/writable/new/deep/file.txt', 'NEW')
    await workspace.rename('mixed/writable/new/deep/file.txt', 'mixed/writable/new/deep/renamed.txt')
    await workspace.unlink('mixed/writable/new')

    await expect(workspace.readFile('mixed/writable/open.txt')).resolves.toBe('UPDATED')
    await expect(workspace.stat('mixed/writable/new')).rejects.toThrow()
  })

  test('protects canonical targets reached through safe in-workspace symlink aliases', async () => {
    const { root, workspace } = await fixture()
    await symlink(join(root, 'mixed', 'protected'), join(root, 'protected-alias'), 'dir')

    await expect(workspace.readFile('protected-alias/locked.txt')).resolves.toBe('LOCKED')
    const denial = await workspace.writeFile('protected-alias/locked.txt', 'BYPASS').catch((error) => error)
    expect(isReadonlyFilesystemMutationError(denial)).toBe(true)
    expect(denial).toMatchObject(expectReadonly('write'))
    expect(JSON.stringify(denial)).not.toContain(root)
    await expect(readFile(join(root, 'mixed', 'protected', 'locked.txt'), 'utf8')).resolves.toBe('LOCKED')
  })

  test('inherits the guarded root across every Node Workspace re-projection', async () => {
    const { root } = await fixture()
    const reprojected = createNodeWorkspace(root)
    workspaces.push(reprojected)
    await whenNodeWorkspaceReady(reprojected)

    await expect(reprojected.writeFile('mixed/protected/locked.txt', 'BYPASS'))
      .rejects.toMatchObject(expectReadonly('write'))
    await reprojected.writeFile('mixed/writable/open.txt', 'REPROJECTED')
    await expect(reprojected.readFile('mixed/writable/open.txt')).resolves.toBe('REPROJECTED')
  })

  test('keys nonexistent roots through a symlinked ancestor before and after creation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'boring-readonly-planned-root-'))
    roots.push(parent)
    const actualParent = join(parent, 'actual')
    const aliasParent = join(parent, 'alias')
    await mkdir(actualParent)
    await symlink(actualParent, aliasParent, 'dir')
    const aliasRoot = join(aliasParent, 'workspace')
    const actualRoot = join(actualParent, 'workspace')

    const first = createNodeWorkspace(aliasRoot)
    workspaces.push(first)
    await whenNodeWorkspaceReady(first)
    await mkdir(join(actualRoot, 'locked'), { recursive: true })
    await writeFile(join(actualRoot, 'locked', 'file.txt'), 'LOCKED', 'utf8')
    const guarded = createNodeWorkspace(actualRoot, {
      readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'planned-v1' },
    })
    workspaces.push(guarded)
    await whenNodeWorkspaceReady(guarded)

    await expect(first.writeFile('locked/file.txt', 'BYPASS')).rejects.toMatchObject(expectReadonly('write'))
    await expect(guarded.writeFile('locked/file.txt', 'BYPASS')).rejects.toMatchObject(expectReadonly('write'))
  })

  test('upgrades an earlier policy-less projection in place without opening a bypass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-readonly-upgrade-'))
    roots.push(root)
    await mkdir(join(root, 'locked'), { recursive: true })
    await writeFile(join(root, 'locked', 'file.txt'), 'LOCKED', 'utf8')
    const first = createNodeWorkspace(root)
    workspaces.push(first)
    await whenNodeWorkspaceReady(first)

    const guarded = createNodeWorkspace(root, {
      readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'upgrade-v1' },
    })
    workspaces.push(guarded)
    await whenNodeWorkspaceReady(guarded)

    await expect(guarded.writeFile('locked/file.txt', 'BYPASS')).rejects.toMatchObject(expectReadonly('write'))
    await expect(first.writeFile('locked/file.txt', 'BYPASS')).rejects.toMatchObject(expectReadonly('write'))
  })

  test('keeps root policy durable after the originating runtime is disposed', async () => {
    const { workspace, root } = await fixture()
    disposeNodeWorkspace(workspace)
    workspaces.splice(workspaces.indexOf(workspace), 1)

    const reprojected = createNodeWorkspace(root)
    workspaces.push(reprojected)
    await whenNodeWorkspaceReady(reprojected)
    await expect(reprojected.writeFile('mixed/protected/locked.txt', 'BYPASS'))
      .rejects.toMatchObject(expectReadonly('write'))
  })

  test('rejects reuse of a revision with a different normalized policy', async () => {
    const { root } = await fixture()
    const conflicting = createNodeWorkspace(root, {
      readonlyWorkspacePolicy: { readonlyPaths: ['safe'], revision: 'policy-v1' },
    })
    workspaces.push(conflicting)
    await expect(whenNodeWorkspaceReady(conflicting)).rejects.toMatchObject({
      code: 'RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID',
    })
  })

  test('serializes substitution attempts and never changes protected content', async () => {
    const { root, workspace } = await fixture()
    await symlink(join(root, 'safe'), join(root, 'safe-link'), 'dir')
    await symlink(join(root, 'mixed', 'protected'), join(root, 'protected-link'), 'dir')

    const attacker = createNodeWorkspace(root)
    workspaces.push(attacker)
    await whenNodeWorkspaceReady(attacker)

    const results = await Promise.allSettled([
      attacker.rename('protected-link', 'candidate-link'),
      workspace.writeFile('candidate-link/locked.txt', 'BYPASS'),
      workspace.writeFile('safe-link/open.txt', 'PERMITTED'),
      attacker.unlink('mixed'),
    ])

    expect(results[0]?.status).toBe('rejected')
    expect(results[1]?.status).toBe('rejected')
    expect(results[2]?.status).toBe('fulfilled')
    expect(results[3]?.status).toBe('rejected')
    await expect(readFile(join(root, 'mixed', 'protected', 'locked.txt'), 'utf8')).resolves.toBe('LOCKED')
    await expect(readFile(join(root, 'safe', 'open.txt'), 'utf8')).resolves.toBe('PERMITTED')
  })
})
