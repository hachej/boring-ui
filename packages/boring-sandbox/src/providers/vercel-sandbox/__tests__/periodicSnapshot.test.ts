import { afterEach, expect, test, vi } from 'vitest'
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../sandboxHandleStore'

import {
  applySnapshotRetention,
  createPeriodicSnapshotScheduler,
  type SnapshotHandle,
} from '../periodicSnapshot'

interface MockSnapshot extends SnapshotHandle {
  delete: ReturnType<typeof vi.fn<SnapshotHandle['delete']>>
}

function createHandleStore(
  initial: SandboxHandleRecord[] = [],
): SandboxHandleStore & { puts: SandboxHandleRecord[] } {
  const records = new Map(initial.map((record) => [record.workspaceId, record]))
  const puts: SandboxHandleRecord[] = []

  return {
    puts,
    async get(workspaceId: string) {
      return records.get(workspaceId) ?? null
    },
    async put(record: SandboxHandleRecord) {
      puts.push(record)
      records.set(record.workspaceId, record)
    },
    async delete(workspaceId: string) {
      records.delete(workspaceId)
    },
    async list() {
      return [...records.values()]
    },
  }
}

function createSnapshot(snapshotId: string): MockSnapshot {
  return {
    snapshotId,
    delete: vi.fn<SnapshotHandle['delete']>(async () => {
      // no-op
    }),
  }
}

function createEnvGetter(value: string | undefined): (name: string) => string | undefined {
  return (name: string) => {
    if (name !== 'BORING_AGENT_SNAPSHOT_KEEP') {
      return undefined
    }
    return value
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('third snapshot deletes the oldest with default keep-last-2 policy', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-default'
  const first = createSnapshot('snap-1')
  const second = createSnapshot('snap-2')
  const third = createSnapshot('snap-3')

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId)

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(second.delete).not.toHaveBeenCalled()
  expect(third.delete).not.toHaveBeenCalled()
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-3', 'snap-2'])
})

test('retention is a no-op when only one or two snapshots exist', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-noop'
  const first = createSnapshot('snap-a')
  const second = createSnapshot('snap-b')

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId)

  expect(first.delete).not.toHaveBeenCalled()
  expect(second.delete).not.toHaveBeenCalled()
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-b', 'snap-a'])
})

test('BORING_AGENT_SNAPSHOT_KEEP bounds retention window', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-env'
  const getEnvVar = createEnvGetter('3')
  const first = createSnapshot('snap-1')
  const second = createSnapshot('snap-2')
  const third = createSnapshot('snap-3')
  const fourth = createSnapshot('snap-4')

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId, { getEnvVar })
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId, { getEnvVar })
  await applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId, { getEnvVar })
  await applySnapshotRetention(workspaceId, fourth, snapshotsByWorkspaceId, { getEnvVar })

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(second.delete).not.toHaveBeenCalled()
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-4', 'snap-3', 'snap-2'])
})

test('invalid BORING_AGENT_SNAPSHOT_KEEP values fall back to default keep-last-2', async () => {
  for (const raw of ['0', '-1', 'abc', '1.5']) {
    const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
    const workspaceId = `workspace-retention-invalid-${raw}`
    const first = createSnapshot('snap-1')
    const second = createSnapshot('snap-2')
    const third = createSnapshot('snap-3')
    const getEnvVar = createEnvGetter(raw)

    await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId, { getEnvVar })
    await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId, { getEnvVar })
    await applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId, { getEnvVar })

    expect(first.delete).toHaveBeenCalledTimes(1)
    expect(
      snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
    ).toEqual(['snap-3', 'snap-2'])
  }
})

test('retention attempts all stale deletes and keeps failed ones tracked', async () => {
  const snapshotsByWorkspaceId = new Map<string, SnapshotHandle[]>()
  const workspaceId = 'workspace-retention-delete-failure'

  const first = createSnapshot('snap-1')
  const second = createSnapshot('snap-2')
  const third = createSnapshot('snap-3')
  first.delete.mockImplementationOnce(async () => {
    throw new Error('delete failed')
  })

  await applySnapshotRetention(workspaceId, first, snapshotsByWorkspaceId)
  await applySnapshotRetention(workspaceId, second, snapshotsByWorkspaceId)
  await expect(
    applySnapshotRetention(workspaceId, third, snapshotsByWorkspaceId),
  ).rejects.toThrow('delete failed')

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(
    snapshotsByWorkspaceId.get(workspaceId)?.map((snapshot) => snapshot.snapshotId),
  ).toEqual(['snap-3', 'snap-2', 'snap-1'])
})

test('cron triggers snapshot and updates SandboxHandleStore when workspace is dirty', async () => {
  vi.useFakeTimers()

  const store = createHandleStore([
    {
      workspaceId: 'workspace-cron',
      sandboxId: 'sb-stale',
      snapshotId: 'snap-old',
      createdAt: '2026-04-23T00:00:00.000Z',
      lastUsedAt: '2026-04-23T00:00:00.000Z',
    },
  ])
  const snapshot = vi.fn(async () => ({ snapshotId: 'snap-new' }))
  const scheduler = createPeriodicSnapshotScheduler({ intervalMs: 1_000 })

  scheduler.trackWorkspace({
    workspaceId: 'workspace-cron',
    sandbox: {
      sandboxId: 'sb-cron',
      snapshot,
    },
    store,
  })
  scheduler.markDirty('workspace-cron')

  await vi.advanceTimersByTimeAsync(1_000)

  expect(snapshot).toHaveBeenCalledTimes(1)
  expect(store.puts).toHaveLength(1)
  expect(store.puts[0]).toMatchObject({
    workspaceId: 'workspace-cron',
    sandboxId: 'sb-cron',
    snapshotId: 'snap-new',
    createdAt: '2026-04-23T00:00:00.000Z',
  })
  await scheduler.shutdown()
})

test('dirty skip works for idle workspaces', async () => {
  vi.useFakeTimers()

  const store = createHandleStore()
  const snapshot = vi.fn(async () => ({ snapshotId: 'snap-idle' }))
  const scheduler = createPeriodicSnapshotScheduler({ intervalMs: 1_000 })

  scheduler.trackWorkspace({
    workspaceId: 'workspace-idle',
    sandbox: {
      sandboxId: 'sb-idle',
      snapshot,
    },
    store,
  })

  await vi.advanceTimersByTimeAsync(5_000)

  expect(snapshot).not.toHaveBeenCalled()
  expect(store.puts).toHaveLength(0)
  await scheduler.shutdown()
})

test('graceful shutdown cancels pending snapshot timers', async () => {
  vi.useFakeTimers()

  const store = createHandleStore()
  const snapshot = vi.fn(async () => ({ snapshotId: 'snap-shutdown' }))
  const scheduler = createPeriodicSnapshotScheduler({ intervalMs: 1_000 })

  scheduler.trackWorkspace({
    workspaceId: 'workspace-shutdown',
    sandbox: {
      sandboxId: 'sb-shutdown',
      snapshot,
    },
    store,
  })
  scheduler.markDirty('workspace-shutdown')
  await scheduler.shutdown()

  await vi.advanceTimersByTimeAsync(10_000)

  expect(snapshot).not.toHaveBeenCalled()
  expect(store.puts).toHaveLength(0)
})

test('shutdown awaits in-flight snapshot operations', async () => {
  vi.useFakeTimers()

  let releaseSnapshot: (() => void) | null = null
  const store = createHandleStore()
  const snapshot = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    return { snapshotId: 'snap-in-flight' }
  })
  const scheduler = createPeriodicSnapshotScheduler({ intervalMs: 1_000 })

  scheduler.trackWorkspace({
    workspaceId: 'workspace-in-flight',
    sandbox: {
      sandboxId: 'sb-in-flight',
      snapshot,
    },
    store,
  })
  scheduler.markDirty('workspace-in-flight')
  await vi.advanceTimersByTimeAsync(1_000)

  let shutdownFinished = false
  const shutdownPromise = scheduler.shutdown().then(() => {
    shutdownFinished = true
  })

  await Promise.resolve()
  expect(shutdownFinished).toBe(false)
  expect(releaseSnapshot).not.toBeNull()

  if (!releaseSnapshot) {
    throw new Error('releaseSnapshot should be assigned before shutdown awaits')
  }
  const release = releaseSnapshot as () => void
  release()
  await shutdownPromise

  expect(shutdownFinished).toBe(true)
  expect(store.puts).toHaveLength(1)
  expect(store.puts[0]).toMatchObject({
    workspaceId: 'workspace-in-flight',
    sandboxId: 'sb-in-flight',
    snapshotId: 'snap-in-flight',
  })
})
