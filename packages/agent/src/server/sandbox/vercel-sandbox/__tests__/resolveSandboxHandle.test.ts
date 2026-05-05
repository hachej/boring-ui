import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import { afterEach, expect, test, vi } from 'vitest'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../../../../shared/sandbox-handle-store'
import { ErrorCode } from '../../../../shared/error-codes'
import {
  SandboxHandleUnavailableError,
  type VercelSandboxClient,
  resetSandboxHandleCacheForTests,
  resolveSandboxHandle,
} from '../resolveSandboxHandle'

type MutableSandbox = VercelSandbox & {
  setStatus(next: 'running' | 'stopped' | 'failed' | 'aborted'): void
  stop(opts?: { signal?: AbortSignal; blocking?: boolean }): Promise<unknown>
}

function createSandboxHandle(
  sandboxId: string,
  opts: {
    status?: 'running' | 'stopped' | 'failed' | 'aborted'
    sourceSnapshotId?: string
  } = {},
): MutableSandbox {
  let status = opts.status ?? 'running'
  const stop = vi.fn(async () => ({}))

  const sandbox = {
    sandboxId,
    name: sandboxId,
    persistent: true,
    sourceSnapshotId: opts.sourceSnapshotId,
    stop,
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

function createDirectStatusError(status: number): Error & { status: number } {
  const error = new Error(`HTTP ${status}`) as Error & { status: number }
  error.status = status
  return error
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolveFn: ((value: T | PromiseLike<T>) => void) | null = null
  let rejectFn: ((reason?: unknown) => void) | null = null
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })

  return {
    promise,
    resolve(value: T) {
      if (resolveFn) {
        resolveFn(value)
      }
    },
    reject(error: unknown) {
      if (rejectFn) {
        rejectFn(error)
      }
    },
  }
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

test('create emits sandbox lifecycle log with cost annotation', async () => {
  const store = createStore()
  const created = createSandboxHandle('sb-created-log')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => created),
    get: vi.fn(),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  }

  await resolveSandboxHandle('workspace-created-log', store, client, { logger })

  expect(logger.info).toHaveBeenCalledWith(
    '[sandbox] created',
    expect.objectContaining({
      workspaceId: 'workspace-created-log',
      sandboxId: 'sb-created-log',
      sourceType: 'empty',
      estimatedAbandonedSessionCostUsd: 0.1,
    }),
  )
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

test('workspace ids are normalized before cache/store lookup', async () => {
  const store = createStore()
  const created = createSandboxHandle('sb-normalized')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => created),
    get: vi.fn(),
  }

  await resolveSandboxHandle('  workspace-normalized  ', store, client)
  const resolved = await resolveSandboxHandle('workspace-normalized', store, client)

  expect(resolved).toBe(created)
  expect(client.create).toHaveBeenCalledTimes(1)
  expect(store.puts).toHaveLength(1)
  expect(store.puts[0].workspaceId).toBe('workspace-normalized')
})

test('stale persisted sandbox is stopped by orphan guard and recreated from snapshot', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-orphan-guard',
    sandboxId: 'sb-orphan-old',
    snapshotId: 'snap-orphan',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const stale = createSandboxHandle('sb-orphan-old', {
    status: 'running',
    sourceSnapshotId: 'snap-orphan',
  })
  const recreated = createSandboxHandle('sb-orphan-new', {
    status: 'running',
    sourceSnapshotId: 'snap-orphan',
  })
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => stale),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  }

  const resolved = await resolveSandboxHandle(
    'workspace-orphan-guard',
    store,
    client,
    {
      maxIdleMs: 5 * 60 * 1000,
      now: () => Date.parse('2026-04-23T01:00:00.000Z'),
      logger,
    },
  )

  expect(resolved).toBe(recreated)
  expect(stale.stop).toHaveBeenCalledTimes(1)
  expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
    name: expect.any(String),
    persistent: true,
    snapshotExpiration: 0,
    source: {
      type: 'snapshot',
      snapshotId: 'snap-orphan',
    },
  }))
  expect(logger.warn).toHaveBeenCalledWith(
    '[sandbox] orphan-guard stale sandbox detected',
    expect.objectContaining({
      workspaceId: 'workspace-orphan-guard',
      sandboxId: 'sb-orphan-old',
      maxIdleMs: 5 * 60 * 1000,
    }),
  )
  expect(logger.info).toHaveBeenCalledWith(
    '[sandbox] stopped',
    expect.objectContaining({
      workspaceId: 'workspace-orphan-guard',
      sandboxId: 'sb-orphan-old',
      reason: 'orphan-guard-idle',
      estimatedAbandonedSessionCostUsd: 0.1,
    }),
  )
})

test('orphan guard reuses stale sandbox when no snapshot is available', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-orphan-no-snapshot',
    sandboxId: 'sb-orphan-no-snapshot',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const stale = createSandboxHandle('sb-orphan-no-snapshot', {
    status: 'running',
  })
  const client: VercelSandboxClient = {
    create: vi.fn(),
    get: vi.fn(async () => stale),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  }

  const resolved = await resolveSandboxHandle(
    'workspace-orphan-no-snapshot',
    store,
    client,
    {
      maxIdleMs: 5 * 60 * 1000,
      now: () => Date.parse('2026-04-23T01:00:00.000Z'),
      logger,
    },
  )

  expect(resolved).toBe(stale)
  expect(stale.stop).not.toHaveBeenCalled()
  expect(client.create).not.toHaveBeenCalled()
  expect(logger.warn).toHaveBeenCalledWith(
    '[sandbox] orphan-guard skipped; no snapshot available',
    expect.objectContaining({
      workspaceId: 'workspace-orphan-no-snapshot',
      sandboxId: 'sb-orphan-no-snapshot',
    }),
  )
})

test('concurrent requests use a single in-flight resolution', async () => {
  const store = createStore()
  const deferred = createDeferred<VercelSandbox>()
  const created = createSandboxHandle('sb-concurrent')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => await deferred.promise),
    get: vi.fn(),
  }

  const first = resolveSandboxHandle('workspace-concurrent', store, client)
  const second = resolveSandboxHandle('workspace-concurrent', store, client)

  await Promise.resolve()
  expect(client.create).toHaveBeenCalledTimes(1)

  deferred.resolve(created)
  const [firstResolved, secondResolved] = await Promise.all([first, second])

  expect(firstResolved).toBe(created)
  expect(secondResolved).toBe(created)
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
  expect(client.get).toHaveBeenCalledWith(expect.objectContaining({ sandboxId: 'sb-expired', name: 'sb-expired', resume: true }))
  expect(client.create).toHaveBeenCalledTimes(1)
  expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
    name: expect.any(String),
    persistent: true,
    snapshotExpiration: 0,
    source: {
      type: 'snapshot',
      snapshotId: 'snap-1',
    },
  }))
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
  expect(client.get).toHaveBeenCalledWith(expect.objectContaining({ sandboxId: 'sb-stopped', name: 'sb-stopped', resume: true }))
  expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
    name: expect.any(String),
    persistent: true,
    snapshotExpiration: 0,
    source: {
      type: 'snapshot',
      snapshotId: 'snap-2',
    },
  }))
})

test('persisted sandbox in expired status recreates empty when no snapshot is available', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-stopped-empty',
    sandboxId: 'sb-stopped-empty',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const stopped = createSandboxHandle('sb-stopped-empty', {
    status: 'stopped',
  })
  const recreated = createSandboxHandle('sb-fresh-empty')
  const logger = {
    warn: vi.fn(),
  }
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => stopped),
  }

  const resolved = await resolveSandboxHandle('workspace-stopped-empty', store, client, {
    logger,
  })

  expect(resolved).toBe(recreated)
  expect(client.get).toHaveBeenCalledWith(expect.objectContaining({ sandboxId: 'sb-stopped-empty', name: 'sb-stopped-empty', resume: true }))
  expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ name: expect.any(String), persistent: true, snapshotExpiration: 0 }))
  expect(logger.warn).toHaveBeenCalledWith(
    '[sandbox] recreating empty sandbox; no snapshot available',
    expect.objectContaining({
      workspaceId: 'workspace-stopped-empty',
      sandboxId: 'sb-stopped-empty',
      reason: 'sandbox status is stopped',
    }),
  )
  expect(store.puts[0]).toMatchObject({
    workspaceId: 'workspace-stopped-empty',
    sandboxId: 'sb-fresh-empty',
    createdAt: oldRecord.createdAt,
  })
  expect(store.puts[0]?.snapshotId).toBeUndefined()
})

test('expired sandbox policy can reject stopped persisted sandbox instead of recreating', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-stopped-error',
    sandboxId: 'sb-stopped-error',
    snapshotId: 'snap-stopped-error',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const stopped = createSandboxHandle('sb-stopped-error', {
    status: 'stopped',
    sourceSnapshotId: 'snap-stopped-error',
  })
  const client: VercelSandboxClient = {
    create: vi.fn(),
    get: vi.fn(async () => stopped),
  }

  await expect(
    resolveSandboxHandle('workspace-stopped-error', store, client, {
      expiredSandboxPolicy: 'error',
    }),
  ).rejects.toMatchObject({
    name: 'SandboxHandleUnavailableError',
    code: ErrorCode.enum.SANDBOX_EXPIRED,
    statusCode: 410,
    workspaceId: 'workspace-stopped-error',
    sandboxId: 'sb-stopped-error',
    reason: 'sandbox status is stopped',
  })
  await expect(
    resolveSandboxHandle('workspace-stopped-error', store, client, {
      expiredSandboxPolicy: 'error',
    }),
  ).rejects.toBeInstanceOf(SandboxHandleUnavailableError)
  expect(client.create).not.toHaveBeenCalled()
})

test('404 from get recreates empty when persisted sandbox has no snapshot', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-404',
    sandboxId: 'sb-404',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const recreated = createSandboxHandle('sb-404-recreated')
  const logger = {
    warn: vi.fn(),
  }
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => {
      throw createHttpStatusError(404)
    }),
  }

  const resolved = await resolveSandboxHandle('workspace-404', store, client, {
    logger,
  })

  expect(resolved).toBe(recreated)
  expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ name: expect.any(String), persistent: true, snapshotExpiration: 0 }))
  expect(logger.warn).toHaveBeenCalledWith(
    '[sandbox] recreating empty sandbox; no snapshot available',
    expect.objectContaining({
      workspaceId: 'workspace-404',
      sandboxId: 'sb-404',
      reason: 'sandbox lookup returned HTTP 404',
    }),
  )
})

test('expired sandbox policy can reject missing persisted sandbox instead of recreating', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-410-error',
    sandboxId: 'sb-410-error',
    snapshotId: 'snap-410-error',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const client: VercelSandboxClient = {
    create: vi.fn(),
    get: vi.fn(async () => {
      throw createDirectStatusError(410)
    }),
  }

  await expect(
    resolveSandboxHandle('workspace-410-error', store, client, {
      expiredSandboxPolicy: 'error',
    }),
  ).rejects.toMatchObject({
    code: ErrorCode.enum.SANDBOX_EXPIRED,
    statusCode: 410,
    workspaceId: 'workspace-410-error',
    sandboxId: 'sb-410-error',
    reason: 'sandbox lookup returned HTTP 410',
  })
  expect(client.create).not.toHaveBeenCalled()
})

test('direct status 410 from get recreates from snapshot', async () => {
  const oldRecord: SandboxHandleRecord = {
    workspaceId: 'workspace-status-410',
    sandboxId: 'sb-status-410',
    snapshotId: 'snap-status-410',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastUsedAt: '2026-04-23T00:00:00.000Z',
  }
  const store = createStore([oldRecord])
  const recreated = createSandboxHandle('sb-status-410-recreated')
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recreated),
    get: vi.fn(async () => {
      throw createDirectStatusError(410)
    }),
  }

  const resolved = await resolveSandboxHandle('workspace-status-410', store, client)

  expect(resolved).toBe(recreated)
  expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
    name: expect.any(String),
    persistent: true,
    snapshotExpiration: 0,
    source: {
      type: 'snapshot',
      snapshotId: 'snap-status-410',
    },
  }))
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

test('store.put failure does not poison in-process cache', async () => {
  const emitted = [
    createSandboxHandle('sb-first-attempt'),
    createSandboxHandle('sb-second-attempt'),
  ]
  let putAttempts = 0
  const store: SandboxHandleStore = {
    async get() {
      return null
    },
    async put() {
      putAttempts += 1
      if (putAttempts === 1) {
        throw new Error('put failed')
      }
    },
    async delete() {
      // no-op
    },
    async list() {
      return []
    },
  }
  const client: VercelSandboxClient = {
    create: vi.fn(async () => emitted.shift() ?? createSandboxHandle('sb-fallback')),
    get: vi.fn(),
  }

  await expect(
    resolveSandboxHandle('workspace-put-failure', store, client),
  ).rejects.toThrow('put failed')
  const resolved = await resolveSandboxHandle('workspace-put-failure', store, client)

  expect((resolved as any).sandboxId).toBe('sb-second-attempt')
  expect(client.create).toHaveBeenCalledTimes(2)
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
