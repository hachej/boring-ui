import Fastify from 'fastify'
import { expect, test, vi } from 'vitest'

import {
  createRuntimeBindingLifecycle,
  type ManagedRuntimeBinding,
} from '../runtimeBindingLifecycle'

interface TestBinding extends ManagedRuntimeBinding {
  id: string
}

function createTestLifecycle(capacity = 2) {
  const app = Fastify({ logger: false })
  const activeProviders = new Set<string>()
  const evicted: string[] = []
  let maxActiveProviders = 0
  const lifecycle = createRuntimeBindingLifecycle<TestBinding>({
    app,
    capacity,
    createDisposedError: (workspaceId) => Object.assign(new Error('host closing'), { workspaceId }),
    evictCachedRuntime: ({ workspaceId }) => {
      evicted.push(workspaceId)
      activeProviders.delete(workspaceId)
    },
  })
  const createBinding = async (id: string): Promise<TestBinding> => {
    activeProviders.add(id)
    maxActiveProviders = Math.max(maxActiveProviders, activeProviders.size)
    return {
      id,
      retire: vi.fn(async () => {}),
      agent: { dispose: vi.fn(async () => {}) },
    }
  }
  return {
    app,
    lifecycle,
    activeProviders,
    evicted,
    createBinding,
    get maxActiveProviders() { return maxActiveProviders },
  }
}

test('capacity skips pending construction when an idle ready entry can retire', async () => {
  const fixture = createTestLifecycle()
  let releasePending!: () => void
  const pendingGate = new Promise<void>((resolve) => { releasePending = resolve })
  let markPendingStarted!: () => void
  const pendingStarted = new Promise<void>((resolve) => { markPendingStarted = resolve })
  let pendingCreates = 0

  const pending = await fixture.lifecycle.admit({
    key: 'pending',
    workspaceId: 'pending',
    create: async () => {
      pendingCreates += 1
      markPendingStarted()
      await pendingGate
      return await fixture.createBinding('pending')
    },
  })
  await pendingStarted
  const idle = await fixture.lifecycle.admit({
    key: 'idle',
    workspaceId: 'idle',
    create: () => fixture.createBinding('idle'),
  })
  await idle.entry.promise

  const overflow = await fixture.lifecycle.admit({
    key: 'overflow',
    workspaceId: 'overflow',
    create: () => fixture.createBinding('overflow'),
  })
  await overflow.entry.promise

  expect(fixture.lifecycle.isCurrentEntry('pending', pending.entry)).toBe(true)
  expect(pendingCreates).toBe(1)
  expect(fixture.evicted).toContain('idle')
  expect(fixture.evicted).not.toContain('pending')
  releasePending()
  await pending.entry.promise
  await fixture.lifecycle.close()
  await fixture.app.close()
})

test('concurrent misses rescan pending entries without exceeding capacity or waiting on a pinned oldest entry', async () => {
  const fixture = createTestLifecycle()
  const oldest = await fixture.lifecycle.admit({
    key: 'oldest',
    workspaceId: 'oldest',
    create: () => fixture.createBinding('oldest'),
  })
  const oldestBinding = await oldest.entry.promise
  const releaseOldest = fixture.lifecycle.tryLeaseOperation(oldestBinding)
  expect(releaseOldest).toBeDefined()
  const idle = await fixture.lifecycle.admit({
    key: 'idle',
    workspaceId: 'idle',
    create: () => fixture.createBinding('idle'),
  })
  await idle.entry.promise

  const misses = await Promise.all([
    fixture.lifecycle.admit({
      key: 'miss-1',
      workspaceId: 'miss-1',
      create: () => fixture.createBinding('miss-1'),
    }),
    fixture.lifecycle.admit({
      key: 'miss-2',
      workspaceId: 'miss-2',
      create: () => fixture.createBinding('miss-2'),
    }),
  ])
  await Promise.all(misses.map(({ entry }) => entry.promise))

  expect(fixture.activeProviders.size).toBe(2)
  expect(fixture.maxActiveProviders).toBe(2)
  expect(fixture.activeProviders.has('oldest')).toBe(true)
  expect(fixture.evicted).not.toContain('oldest')
  releaseOldest?.()
  await fixture.lifecycle.close()
  await fixture.app.close()
})

test('entry-operation leases keep health work pinned while idle capacity retires', async () => {
  const fixture = createTestLifecycle()
  const health = await fixture.lifecycle.admit({
    key: 'health',
    workspaceId: 'health',
    create: () => fixture.createBinding('health'),
  })
  await health.entry.promise
  const releaseHealth = fixture.lifecycle.tryLeaseEntryOperation(health.entry)
  expect(releaseHealth).toBeDefined()
  const idle = await fixture.lifecycle.admit({
    key: 'idle',
    workspaceId: 'idle',
    create: () => fixture.createBinding('idle'),
  })
  await idle.entry.promise

  const overflow = await fixture.lifecycle.admit({
    key: 'overflow',
    workspaceId: 'overflow',
    create: () => fixture.createBinding('overflow'),
  })
  await overflow.entry.promise

  expect(fixture.lifecycle.isCurrentEntry('health', health.entry)).toBe(true)
  expect(fixture.evicted).toContain('idle')
  expect(fixture.evicted).not.toContain('health')
  releaseHealth?.()
  await fixture.lifecycle.close()
  await fixture.app.close()
})

test('close detaches pending creation at its deadline and tears down a late binding exactly once', async () => {
  const app = Fastify({ logger: false })
  let releaseCreate!: () => void
  let markCreateStarted!: () => void
  const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve })
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  const retire = vi.fn(async () => {})
  const dispose = vi.fn(async () => {})
  const disposeRuntime = vi.fn(async () => {})
  const lifecycle = createRuntimeBindingLifecycle<TestBinding>({
    app,
    capacity: 1,
    shutdownGraceMs: 10,
    createDisposedError: () => new Error('host closing'),
  })
  const admitted = await lifecycle.admit({
    key: 'pending-close',
    workspaceId: 'pending-close',
    create: async () => {
      markCreateStarted()
      await createGate
      return { id: 'pending-close', retire, agent: { dispose }, disposeRuntime }
    },
  })
  await createStarted

  const before = Date.now()
  await Promise.all([lifecycle.close(), lifecycle.close()])
  expect(Date.now() - before).toBeLessThan(250)
  expect(retire).not.toHaveBeenCalled()

  releaseCreate()
  await admitted.entry.retirementPromise
  expect(retire).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
  expect(disposeRuntime).toHaveBeenCalledOnce()
  await lifecycle.close()
  expect(retire).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
  expect(disposeRuntime).toHaveBeenCalledOnce()
  await app.close()
})

test('retirement preserves the first error while attempting agent disposal and provider eviction', async () => {
  const app = Fastify({ logger: false })
  const retireError = new Error('retire failed first')
  const disposeError = new Error('agent dispose failed second')
  const evictionError = new Error('provider eviction failed third')
  const retire = vi.fn(async () => { throw retireError })
  const dispose = vi.fn(async () => { throw disposeError })
  const evictCachedRuntime = vi.fn(() => { throw evictionError })
  const warn = vi.spyOn(app.log, 'warn')
  const lifecycle = createRuntimeBindingLifecycle<TestBinding>({
    app,
    capacity: 1,
    createDisposedError: () => new Error('host closing'),
    evictCachedRuntime,
  })
  const admitted = await lifecycle.admit({
    key: 'failing',
    workspaceId: 'failing',
    create: async () => ({ id: 'failing', retire, agent: { dispose } }),
  })
  await admitted.entry.promise

  await expect(lifecycle.retire('failing', admitted.entry)).rejects.toBe(retireError)

  expect(retire).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'failing' })
  expect(warn).toHaveBeenCalledWith(
    { err: disposeError, workspaceId: 'failing' },
    '[agent] failed to dispose agent after an earlier cleanup error',
  )
  expect(warn).toHaveBeenCalledWith(
    { err: evictionError, workspaceId: 'failing' },
    '[agent] failed to evict cached runtime after an earlier cleanup error',
  )
  await lifecycle.close()
  await app.close()
})

test('retirement does not settle before asynchronous provider eviction completes', async () => {
  const app = Fastify({ logger: false })
  let releaseEviction!: () => void
  let markEvictionStarted!: () => void
  const evictionStarted = new Promise<void>((resolve) => { markEvictionStarted = resolve })
  const evictCachedRuntime = vi.fn(() => new Promise<void>((resolve) => {
    releaseEviction = resolve
    markEvictionStarted()
  }))
  const lifecycle = createRuntimeBindingLifecycle<TestBinding>({
    app,
    capacity: 1,
    createDisposedError: () => new Error('host closing'),
    evictCachedRuntime,
  })
  const admitted = await lifecycle.admit({
    key: 'async-eviction',
    workspaceId: 'async-eviction',
    create: async () => ({
      id: 'async-eviction',
      retire: vi.fn(async () => {}),
      agent: { dispose: vi.fn(async () => {}) },
    }),
  })
  await admitted.entry.promise

  let settled = false
  const retirement = lifecycle.retire('async-eviction', admitted.entry)
    .then(() => { settled = true })
  await evictionStarted
  expect(settled).toBe(false)
  releaseEviction()
  await retirement
  expect(evictCachedRuntime).toHaveBeenCalledWith({ workspaceId: 'async-eviction' })
  await lifecycle.close()
  await app.close()
})

test('touching an entry updates access order so the idle least-recently-used entry retires', async () => {
  const fixture = createTestLifecycle()
  const first = await fixture.lifecycle.admit({
    key: 'a',
    workspaceId: 'a',
    create: () => fixture.createBinding('a'),
  })
  const second = await fixture.lifecycle.admit({
    key: 'b',
    workspaceId: 'b',
    create: () => fixture.createBinding('b'),
  })
  await Promise.all([first.entry.promise, second.entry.promise])
  fixture.lifecycle.touchEntry('a', first.entry)

  const third = await fixture.lifecycle.admit({
    key: 'c',
    workspaceId: 'c',
    create: () => fixture.createBinding('c'),
  })
  await third.entry.promise

  expect(fixture.evicted).toContain('b')
  expect(fixture.evicted).not.toContain('a')
  expect(fixture.lifecycle.isCurrentEntry('a', first.entry)).toBe(true)
  expect(fixture.lifecycle.isCurrentEntry('c', third.entry)).toBe(true)
  await fixture.lifecycle.close()
  await fixture.app.close()
})

test('admission waits while every entry is leased, then release wakes a bounded rescan', async () => {
  const fixture = createTestLifecycle()
  const first = await fixture.lifecycle.admit({
    key: 'a',
    workspaceId: 'a',
    create: () => fixture.createBinding('a'),
  })
  const second = await fixture.lifecycle.admit({
    key: 'b',
    workspaceId: 'b',
    create: () => fixture.createBinding('b'),
  })
  const [firstBinding, secondBinding] = await Promise.all([first.entry.promise, second.entry.promise])
  const releaseFirst = fixture.lifecycle.tryLeaseOperation(firstBinding)
  const releaseSecond = fixture.lifecycle.tryLeaseOperation(secondBinding)
  const createOverflow = vi.fn(() => fixture.createBinding('overflow'))

  const overflow = fixture.lifecycle.admit({
    key: 'overflow',
    workspaceId: 'overflow',
    create: createOverflow,
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(createOverflow).not.toHaveBeenCalled()

  releaseSecond?.()
  const admitted = await overflow
  await admitted.entry.promise

  expect(fixture.evicted).toContain('b')
  expect(fixture.activeProviders).toEqual(new Set(['a', 'overflow']))
  expect(fixture.maxActiveProviders).toBe(2)
  releaseFirst?.()
  await fixture.lifecycle.close()
  await fixture.app.close()
})

test.each(['draining', 'closing'] as const)('%s wakes a capacity-blocked admission and rejects it', async (phase) => {
  const fixture = createTestLifecycle(1)
  const pinned = await fixture.lifecycle.admit({
    key: 'pinned',
    workspaceId: 'pinned',
    create: () => fixture.createBinding('pinned'),
  })
  const binding = await pinned.entry.promise
  const releasePinned = fixture.lifecycle.tryLeaseOperation(binding)
  const createBlocked = vi.fn(() => fixture.createBinding('blocked'))
  const blocked = fixture.lifecycle.admit({
    key: 'blocked',
    workspaceId: 'blocked',
    create: createBlocked,
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(createBlocked).not.toHaveBeenCalled()

  let closing: Promise<void>
  if (phase === 'closing') {
    closing = fixture.lifecycle.close()
  } else {
    fixture.lifecycle.startDraining()
    closing = Promise.resolve()
  }
  await expect(blocked).rejects.toMatchObject({ workspaceId: 'blocked' })
  expect(createBlocked).not.toHaveBeenCalled()
  releasePinned?.()
  await closing
  if (phase === 'draining') await fixture.lifecycle.close()
  await fixture.app.close()
})
