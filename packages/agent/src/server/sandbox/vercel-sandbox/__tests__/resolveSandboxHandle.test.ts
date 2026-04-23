import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import { afterEach, expect, test, vi } from 'vitest'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../../../../shared/sandbox-handle-store'
import {
  type VercelSandboxClient,
  resetSandboxHandleCacheForTests,
  resolveSandboxHandle,
} from '../resolveSandboxHandle'

type MutableSandbox = VercelSandbox & {
  setStatus(next: 'running' | 'stopped' | 'failed' | 'aborted'): void
}

function createSandboxHandle(
  sandboxId: string,
  opts: {
    status?: 'running' | 'stopped' | 'failed' | 'aborted'
    sourceSnapshotId?: string
  } = {},
): MutableSandbox {
  let status = opts.status ?? 'running'

  const sandbox = {
    sandboxId,
    sourceSnapshotId: opts.sourceSnapshotId,
    get status() {
      return status
    },
    setStatus(next: 'running' | 'stopped' | 'failed' | 'aborted') {
      status = next
    },
  } as unknown as MutableSandbox

  return sandbox
}

function createHttpStatusError(status: number): Error & { response: { status: number } } {
  const error = new Error(`HTTP ${status}`) as Error & { response: { status: number } }
  error.response = { status }
  return error
}

function createStore(
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

afterEach(() => {
  resetSandboxHandleCacheForTests()
})

test('first call creates sandbox and persists handle record', async () => {
  const store = createStore()
  const created = createSandboxHandle('sb-1')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => created),
    get: vi.fn(),
  }

  const resolved = await resolveSandboxHandle('workspace-a', store, client)

  expect(resolved).toBe(created)
  expect(client.create).toHaveBeenCalledTimes(1)
  expect(client.get).not.toHaveBeenCalled()
  expect(store.puts).toHaveLength(1)
  expect(store.puts[0]).toMatchObject({
    workspaceId: 'workspace-a',
    sandboxId: 'sb-1',
  })
  expect(Number.isNaN(Date.parse(store.puts[0].createdAt))).toBe(false)
  expect(Number.isNaN(Date.parse(store.puts[0].lastUsedAt))).toBe(false)
})

test('second call hits in-process cache without API calls', async () => {
  const store = createStore()
  const created = createSandboxHandle('sb-cache')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => created),
    get: vi.fn(),
  }

  await resolveSandboxHandle('workspace-cache', store, client)
  const resolved = await resolveSandboxHandle('workspace-cache', store, client)

  expect(resolved).toBe(created)
  expect(client.create).toHaveBeenCalledTimes(1)
  expect(client.get).not.toHaveBeenCalled()
  expect(store.puts).toHaveLength(1)
})

test('expired in-process/persisted handle transparently recreates from snapshot', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-expired',
    sandboxId: 'sb-expired',
    snapshotId: 'snap-1',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const stale = createSandboxHandle('sb-expired', { status: 'running', sourceSnapshotId: 'snap-1' })
  const recreated = createSandboxHandle('sb-new', { status: 'running', sourceSnapshotId: 'snap-1' })

  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => {
      throw createHttpStatusError(410)
    }),
  }

  // Prime in-process cache with stale handle, then mark it stopped.
  await resolveSandboxHandle('workspace-expired', store, {
    create: vi.fn(async () => stale),
    get: vi.fn(async () => stale),
  })
  stale.setStatus('stopped')
  store.puts.length = 0

  const resolved = await resolveSandboxHandle('workspace-expired', store, client)

  expect(resolved).toBe(recreated)
  expect(client.get).toHaveBeenCalledTimes(1)
  expect(client.get).toHaveBeenCalledWith({ sandboxId: 'sb-expired' })
  expect(client.create).toHaveBeenCalledTimes(1)
  expect(client.create).toHaveBeenCalledWith({
    source: {
      type: 'snapshot',
      snapshotId: 'snap-1',
    },
  })
  expect(store.puts).toHaveLength(1)
  expect(store.puts[0]).toMatchObject({
    workspaceId: 'workspace-expired',
    sandboxId: 'sb-new',
    snapshotId: 'snap-1',
    createdAt: oldRecord.createdAt,
  })
})

test('persisted sandbox in expired status recreates from snapshot', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-stopped',
    sandboxId: 'sb-stopped',
    snapshotId: 'snap-2',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const stopped = createSandboxHandle('sb-stopped', {
    status: 'stopped',
    sourceSnapshotId: 'snap-2',
  })
  const recreated = createSandboxHandle('sb-fresh', {
    status: 'running',
    sourceSnapshotId: 'snap-2',
  })
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => stopped),
  }

  const resolved = await resolveSandboxHandle('workspace-stopped', store, client)

  expect(resolved).toBe(recreated)
  expect(client.get).toHaveBeenCalledWith({ sandboxId: 'sb-stopped' })
  expect(client.create).toHaveBeenCalledWith({
    source: {
      type: 'snapshot',
      snapshotId: 'snap-2',
    },
  })
})

test('404 from get recreates, and missing snapshot falls back to create() with no args', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-404',
    sandboxId: 'sb-404',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const recreated = createSandboxHandle('sb-new-404')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => {
      throw createHttpStatusError(404)
    }),
  }

  const resolved = await resolveSandboxHandle('workspace-404', store, client)

  expect(resolved).toBe(recreated)
  expect(client.create).toHaveBeenCalledTimes(1)
  expect(client.create).toHaveBeenCalledWith()
})

test('non-retryable get errors are propagated', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-auth-error',
    sandboxId: 'sb-auth-error',
    snapshotId: 'snap-auth-error',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const client: VercelSandboxClient = {
    create: vi.fn(),
    get: vi.fn(async () => {
      throw createHttpStatusError(401)
    }),
  }

  await expect(
    resolveSandboxHandle('workspace-auth-error', store, client),
  ).rejects.toThrow('HTTP 401')
  expect(client.create).not.toHaveBeenCalled()
})

test('empty workspaceId is rejected', async () => {
  const store = createStore()
  const client: VercelSandboxClient = {
    create: vi.fn(),
    get: vi.fn(),
  }

  await expect(resolveSandboxHandle('   ', store, client)).rejects.toThrow(
    'workspaceId must not be empty',
  )
  expect(client.get).not.toHaveBeenCalled()
  expect(client.create).not.toHaveBeenCalled()
})
