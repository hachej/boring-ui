import type { SandboxHandleRecord, SandboxHandleStore } from '@hachej/boring-agent/shared'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { resolveBlaxelConfig } from '../config'
import { createBlaxelSandboxProvider } from '../createBlaxelSandboxProvider'
import {
  blaxelExternalId,
  blaxelSandboxName,
  createBlaxelSandboxHandleResolver,
} from '../resolveSandboxHandle'
import { createMockBlaxelClient } from './mockBlaxelClient'

class MemoryStore implements SandboxHandleStore {
  readonly records = new Map<string, SandboxHandleRecord>()
  async get(id: string) { return this.records.get(id) ?? null }
  async put(record: SandboxHandleRecord) { this.records.set(record.workspaceId, record) }
  async delete(id: string) { this.records.delete(id) }
  async list() { return [...this.records.values()] }
}

const context = (workspaceId: string) => ({ workspaceRoot: '/ignored', workspaceId, sessionId: 'test' })

afterEach(() => vi.useRealTimers())

describe('Blaxel durable handle resolution', () => {
  test('rejects a poisoned stored sandbox binding before reconnecting', async () => {
    const client = await createMockBlaxelClient()
    const store = new MemoryStore()
    store.records.set('tenant-b', {
      workspaceId: 'tenant-b',
      sandboxId: blaxelSandboxName('tenant-a'),
      createdAt: new Date(0).toISOString(),
      lastUsedAt: new Date(0).toISOString(),
    })
    await expect(createBlaxelSandboxHandleResolver().resolve({
      workspaceId: 'tenant-b',
      client,
      store,
      config: resolveBlaxelConfig({ region: 'eu-fra-1' }, {}),
    })).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
  })

  test('verifies the stable external ID on an existing sandbox', async () => {
    const client = await createMockBlaxelClient()
    const name = blaxelSandboxName('workspace')
    await client.createSandbox({
      name,
      externalId: 'another-workspace',
      image: 'blaxel/base-image:latest',
      memory: 4096,
      region: 'eu-fra-1',
    })
    await expect(createBlaxelSandboxHandleResolver().resolve({
      workspaceId: 'workspace',
      client,
      store: new MemoryStore(),
      config: resolveBlaxelConfig({ region: 'eu-fra-1', volume: { enabled: false, sizeMb: 2048 } }, {}),
    })).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
    expect(blaxelExternalId('workspace')).not.toBe('another-workspace')
  })

  test('keeps caches provider-scoped and refreshes lastUsedAt on a cache hit', async () => {
    const clientA = await createMockBlaxelClient()
    const clientB = await createMockBlaxelClient()
    const storeA = new MemoryStore()
    const storeB = new MemoryStore()
    let now = new Date('2026-01-01T00:00:00.000Z')
    const providerA = createBlaxelSandboxProvider({ client: clientA, handleStore: storeA, region: 'eu-fra-1', now: () => now })
    const providerB = createBlaxelSandboxProvider({ client: clientB, handleStore: storeB, region: 'eu-fra-1' })
    const firstA = await providerA.create(context('same-id'))
    const firstB = await providerB.create(context('same-id'))
    await firstA.workspace.writeFile('only-a.txt', 'a')
    await expect(firstB.workspace.readFile('only-a.txt')).rejects.toMatchObject({ code: 'ENOENT' })
    await firstA.dispose()
    await firstB.dispose()

    now = new Date('2026-01-02T00:00:00.000Z')
    const resumed = await providerA.create(context('same-id'))
    expect(storeA.records.get('same-id')?.lastUsedAt).toBe(now.toISOString())
    await resumed.dispose()
  })

  test('waits for an empty Volume attachment and returns a stable busy error', async () => {
    vi.useFakeTimers()
    const client = await createMockBlaxelClient()
    client.getVolumeAttachment = async () => `sandbox:${blaxelSandboxName('busy')}`
    const promise = createBlaxelSandboxHandleResolver().resolve({
      workspaceId: 'busy',
      client,
      store: new MemoryStore(),
      config: resolveBlaxelConfig({ region: 'eu-fra-1' }, {}),
    })
    const expectation = expect(promise).rejects.toMatchObject({ code: 'BLAXEL_VOLUME_BUSY' })
    await vi.runAllTimersAsync()
    await expectation
  })

  test('recreates terminal compute only after it disappears and preserves the stable Volume binding', async () => {
    const client = await createMockBlaxelClient()
    const workspaceId = 'terminal-volume'
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const first = await provider.create(context(workspaceId))
    const name = first.sandbox.id
    await first.dispose()
    const terminal = client.sandboxes.get(name)!
    Object.assign(terminal, { status: 'TERMINATED' })
    await provider.invalidate?.({ workspaceId })
    const recreated = await provider.create(context(workspaceId))
    expect(recreated.sandbox.id).toBe(name)
    expect(client.sandboxes.get(name)?.status).toBe('DEPLOYED')
    await recreated.dispose()
  })

  test('returns SANDBOX_EXPIRED for terminal compute without a durable Volume', async () => {
    const client = await createMockBlaxelClient()
    const workspaceId = 'terminal-ephemeral'
    const provider = createBlaxelSandboxProvider({
      client,
      handleStore: new MemoryStore(),
      region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const first = await provider.create(context(workspaceId))
    Object.assign(client.sandboxes.get(first.sandbox.id)!, { status: 'FAILED' })
    await first.dispose()
    await provider.invalidate?.({ workspaceId })
    await expect(provider.create(context(workspaceId))).rejects.toMatchObject({ code: 'SANDBOX_EXPIRED' })
  })

  test('waits through deactivating standby and reuses the deactivated sandbox', async () => {
    const client = await createMockBlaxelClient()
    const workspaceId = 'standby-transition'
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const first = await provider.create(context(workspaceId))
    const original = client.sandboxes.get(first.sandbox.id)!
    Object.assign(original, { status: 'DEACTIVATING' })
    const get = client.getSandbox.bind(client)
    let calls = 0
    client.getSandbox = async (name) => {
      const value = await get(name)
      if (++calls === 2) Object.assign(value, { status: 'DEACTIVATED' })
      return value
    }
    await first.dispose()
    await provider.invalidate?.({ workspaceId })
    const resumed = await provider.create(context(workspaceId))
    expect(client.sandboxes.get(resumed.sandbox.id)).toBe(original)
    expect(client.sandboxes.get(resumed.sandbox.id)?.status).toBe('DEACTIVATED')
    await resumed.dispose()
  })

  test('does not persist a stale in-flight result after invalidation', async () => {
    const client = await createMockBlaxelClient()
    const store = new MemoryStore()
    const resolver = createBlaxelSandboxHandleResolver()
    const originalCreate = client.createSandbox.bind(client)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    client.createSandbox = async (config) => { await gate; return await originalCreate(config) }
    const pending = resolver.resolve({
      workspaceId: 'invalidate-race',
      client,
      store,
      config: resolveBlaxelConfig({ region: 'eu-fra-1' }, {}),
    })
    await Promise.resolve()
    resolver.invalidate('invalidate-race')
    release()
    await pending
    expect(await store.get('invalidate-race')).toBeNull()
  })

  test('does not return a cached remote invalidated while its store read is pending', async () => {
    const client = await createMockBlaxelClient()
    const store = new MemoryStore()
    const resolver = createBlaxelSandboxHandleResolver()
    const input = {
      workspaceId: 'cached-invalidate-race',
      client,
      store,
      config: resolveBlaxelConfig({ region: 'eu-fra-1' }, {}),
    }
    const first = await resolver.resolve(input)
    const originalGet = store.get.bind(store)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let delayed = false
    store.get = async (id) => {
      if (!delayed) { delayed = true; await gate }
      return await originalGet(id)
    }
    const pending = resolver.resolve(input)
    await Promise.resolve()
    resolver.invalidate(input.workspaceId)
    client.sandboxes.delete(first.name)
    release()
    const refreshed = await pending
    expect(refreshed).not.toBe(first)
    expect(refreshed.status).toBe('DEPLOYED')
  })
})
