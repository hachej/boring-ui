import { access, mkdtemp, mkdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  expectDisposablePairSurfaceLaws,
  expectDisposableProviderProfile,
  expectPersistentProviderDefault,
  expectPublishedPairLifecycle,
} from './conformance/disposableProvider'
import { createBwrapSandboxProvider } from '../bwrap/createBwrapProvider'
import { createDirectSandboxProvider } from '../direct/createDirectProvider'

const cleanupRoots: string[] = []
afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

test('bwrap config digest changes with trusted network policy', () => {
  const shared = createBwrapSandboxProvider({
    leaseMode: 'disposable', sandbox: { network: 'shared' },
  })
  const isolated = createBwrapSandboxProvider({
    leaseMode: 'disposable', sandbox: { network: 'isolated' },
  })
  expect(shared.disposableProfile.providerConfigDigest)
    .not.toBe(isolated.disposableProfile.providerConfigDigest)
})

describe.each([
  ['direct', createDirectSandboxProvider] as const,
  ['bwrap', createBwrapSandboxProvider] as const,
])('disposable %s provider', (_providerId, factory) => {
  test('creates two isolated roots and removes only the disposed lease', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'boring-disposable-local-'))
    cleanupRoots.push(parent)
    const rootA = join(parent, 'lease-aaaaaaaaaaaaaaaa')
    const rootB = join(parent, 'lease-bbbbbbbbbbbbbbbb')
    const provider = factory({ leaseMode: 'disposable' })
    expectDisposableProviderProfile(provider, _providerId)
    const pairA = await provider.create({ workspaceRoot: rootA, sessionId: 'lease-a' })
    const pairB = await provider.create({ workspaceRoot: rootB, sessionId: 'lease-b' })
    await pairA.workspace.writeFile('marker.txt', 'a')
    await pairB.workspace.writeFile('marker.txt', 'b')
    expect(Buffer.from((await pairA.sandbox.exec('cat marker.txt')).stdout).toString()).toBe('a')
    expect(Buffer.from((await pairB.sandbox.exec('cat marker.txt')).stdout).toString()).toBe('b')
    await expectDisposablePairSurfaceLaws(pairA)

    await expectPublishedPairLifecycle({
      provider,
      pair: pairA,
      assertUsableAfterProviderClose: async () => {
        expect(await pairA.workspace.readFile('marker.txt')).toBe('a')
      },
      assertTerminalCleanup: async () => {
        expect(await exists(rootA)).toBe(false)
      },
    })
    expect(await exists(rootB)).toBe(true)
    expect(await pairB.workspace.readFile('marker.txt')).toBe('b')
    await pairB.dispose()
  })

  test('rejects root aliases and pre-existing directory or symlink roots before effects', async () => {
    const provider = factory({ leaseMode: 'disposable' })
    for (const workspaceRoot of ['//', '/./', '/tmp/..', '/tmp/../']) {
      await expect(provider.create({ workspaceRoot, sessionId: 'unsafe' })).rejects.toMatchObject({
        code: 'CONFIG_INVALID',
      })
    }

    const parent = await mkdtemp(join(tmpdir(), 'boring-disposable-guard-'))
    cleanupRoots.push(parent)
    const existing = join(parent, 'existing')
    await mkdir(existing)
    await expect(provider.create({ workspaceRoot: existing, sessionId: 'existing' })).rejects.toMatchObject({
      code: 'EEXIST',
    })

    const target = join(parent, 'target')
    const linked = join(parent, 'linked')
    await mkdir(target)
    await writeFile(join(target, 'marker'), 'preserved')
    await symlink(target, linked)
    await expect(provider.create({ workspaceRoot: linked, sessionId: 'linked' })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    expect(await exists(join(target, 'marker'))).toBe(true)

    const realParent = join(parent, 'real-parent')
    const parentAlias = join(parent, 'parent-alias')
    await mkdir(realParent)
    await symlink(realParent, parentAlias)
    await expect(provider.create({
      workspaceRoot: join(parentAlias, 'lease-aliased'),
      sessionId: 'ancestor-linked',
    })).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  test('fails closed if the owned root is swapped before recursive deletion', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'boring-disposable-swap-'))
    cleanupRoots.push(parent)
    const root = join(parent, 'lease-aaaaaaaaaaaaaaaa')
    const moved = join(parent, 'moved-owned-root')
    const outside = join(parent, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'preserved'), 'yes')
    const provider = factory({ leaseMode: 'disposable' })
    const pair = await provider.create({ workspaceRoot: root, sessionId: 'swap' })
    await rename(root, moved)
    await symlink(outside, root)

    await expect(pair.dispose()).rejects.toThrow('disposable local sandbox cleanup failed')
    expect(await exists(join(outside, 'preserved'))).toBe(true)
    await unlink(root)
    await rename(moved, root)
    await expect(pair.dispose()).resolves.toBeUndefined()
  })

  test('keeps the primary root when disposable mode is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-primary-local-'))
    cleanupRoots.push(root)
    await mkdir(root, { recursive: true })
    const provider = factory()
    expectPersistentProviderDefault(provider)
    const pair = await provider.create({ workspaceRoot: root, sessionId: 'primary' })
    await pair.dispose()
    expect(await exists(root)).toBe(true)
  })
})
