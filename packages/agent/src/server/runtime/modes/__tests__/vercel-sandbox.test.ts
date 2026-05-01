import { afterEach, expect, test, vi } from 'vitest'

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../../../../shared/sandbox-handle-store'
import {
  evictSandboxHandleCacheForWorkspace,
  resetSandboxHandleCacheForTests,
  type VercelSandboxClient,
} from '../../../sandbox/vercel-sandbox/resolveSandboxHandle'
import type { PeriodicSnapshotScheduler } from '../../../sandbox/vercel-sandbox/periodicSnapshot'
import { createMockVercelSandboxHarness } from '../../../workspace/__tests__/helpers/mockVercelSandbox'
import { createVercelSandboxModeAdapter } from '../vercel-sandbox'

const decoder = new TextDecoder()

function createStore(
  initial: SandboxHandleRecord[] = [],
): SandboxHandleStore {
  const records = new Map(initial.map((record) => [record.workspaceId, record]))

  return {
    async get(workspaceId: string) {
      return records.get(workspaceId) ?? null
    },
    async put(record: SandboxHandleRecord) {
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

function addSandboxMeta(
  sandbox: VercelSandbox,
  meta: {
    sandboxId: string
    status?: string
    sourceSnapshotId?: string
    snapshot?: () => Promise<{ snapshotId: string }>
  },
): VercelSandbox {
  const target = sandbox as unknown as {
    sandboxId: string
    status?: string
    sourceSnapshotId?: string
    snapshot?: () => Promise<{ snapshotId: string }>
  }
  target.sandboxId = meta.sandboxId
  target.status = meta.status ?? 'running'
  target.sourceSnapshotId = meta.sourceSnapshotId
  if (meta.snapshot) target.snapshot = meta.snapshot
  return sandbox
}

function createManualSnapshotScheduler(): PeriodicSnapshotScheduler & {
  flush(workspaceId: string): Promise<void>
} {
  const tracked = new Map<string, {
    sandbox: VercelSandbox & {
      sandboxId: string
      snapshot?: () => Promise<{ snapshotId: string }>
    }
    store: SandboxHandleStore
    dirty: boolean
  }>()

  return {
    trackWorkspace({ workspaceId, sandbox, store }) {
      tracked.set(workspaceId, {
        sandbox: sandbox as VercelSandbox & {
          sandboxId: string
          snapshot?: () => Promise<{ snapshotId: string }>
        },
        store,
        dirty: false,
      })
    },
    markDirty(workspaceId) {
      const job = tracked.get(workspaceId)
      if (job) job.dirty = true
    },
    stopWorkspace(workspaceId) {
      tracked.delete(workspaceId)
    },
    async shutdown() {
      tracked.clear()
    },
    async flush(workspaceId) {
      const job = tracked.get(workspaceId)
      if (!job?.dirty) return
      if (typeof job.sandbox.snapshot !== 'function') {
        throw new Error('sandbox snapshot is unavailable')
      }
      job.dirty = false
      const previous = await job.store.get(workspaceId)
      const snapshot = await job.sandbox.snapshot()
      const now = new Date('2026-04-30T00:00:00.000Z').toISOString()
      await job.store.put({
        workspaceId,
        sandboxId: job.sandbox.sandboxId,
        snapshotId: snapshot.snapshotId,
        createdAt: previous?.createdAt ?? now,
        lastUsedAt: now,
      })
    },
  }
}

afterEach(() => {
  resetSandboxHandleCacheForTests()
})

test('mode requires one of VERCEL_OIDC_TOKEN / VERCEL_ACCESS_TOKEN / VERCEL_TOKEN', async () => {
  const adapter = createVercelSandboxModeAdapter({
    getEnvVar(name) {
      if (name === 'VERCEL_OIDC_TOKEN') return undefined
      if (name === 'VERCEL_ACCESS_TOKEN') return undefined
      if (name === 'VERCEL_TOKEN') return undefined
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
  })

  await expect(
    adapter.create({
      workspaceRoot: 'workspace-a',
      sessionId: 'session-a',
    }),
  ).rejects.toThrow('VERCEL_OIDC_TOKEN or VERCEL_ACCESS_TOKEN or VERCEL_TOKEN is required for vercel-sandbox mode')
})

test('mode requires VERCEL_TEAM_ID', async () => {
  const adapter = createVercelSandboxModeAdapter({
    getEnvVar(name) {
      if (name === 'VERCEL_OIDC_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return undefined
      return undefined
    },
  })

  await expect(
    adapter.create({
      workspaceRoot: 'workspace-a',
      sessionId: 'session-a',
    }),
  ).rejects.toThrow('VERCEL_TEAM_ID is required for vercel-sandbox mode')
})

test('mode rejects invalid BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS', async () => {
  const adapter = createVercelSandboxModeAdapter({
    vercelClient: {
      create: vi.fn(),
      get: vi.fn(),
    },
    getEnvVar(name) {
      if (name === 'VERCEL_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      if (name === 'BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS') return 'soon'
      return undefined
    },
  })

  await expect(
    adapter.create({
      workspaceRoot: 'workspace-timeout',
      sessionId: 'session-timeout',
    }),
  ).rejects.toThrow('BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS must be a positive integer')
})

test('mode accepts VERCEL_TOKEN fallback and creates working bundle with shared workspace/exec substrate', async () => {
  const harness = await createMockVercelSandboxHarness()
  const sandboxWithMeta = harness.sandbox as unknown as {
    sandboxId: string
    sourceSnapshotId?: string
    status?: string
  }
  sandboxWithMeta.sandboxId = 'sb-mode-1'
  sandboxWithMeta.sourceSnapshotId = 'snap-mode-1'
  sandboxWithMeta.status = 'running'

  const mkdirSpy = vi.spyOn((harness.sandbox as any).fs, 'mkdir')
  const store = createStore()
  const client: VercelSandboxClient = {
    create: vi.fn(async () => harness.sandbox),
    get: vi.fn(),
  }
  const logger = { info: vi.fn() }
  const adapter = createVercelSandboxModeAdapter({
    store,
    vercelClient: client,
    getEnvVar(name) {
      if (name === 'VERCEL_OIDC_TOKEN') return undefined
      if (name === 'VERCEL_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
    logger,
  })

  try {
    const bundle = await adapter.create({
      workspaceRoot: 'workspace-mode',
      sessionId: 'session-mode',
    })
    await bundle.workspace.writeFile('shared/hello.txt', 'hello-from-mode')

    const result = await bundle.sandbox.exec('cat /vercel/sandbox/shared/hello.txt')

    expect(bundle.workspace.root).toBe('/vercel/sandbox')
    expect(bundle.sandbox.id).toBe('vercel-sandbox')
    expect(decoder.decode(result.stdout)).toBe('hello-from-mode')
    expect(result.exitCode).toBe(0)
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledWith()
    expect(mkdirSpy).toHaveBeenCalledWith('/vercel/sandbox', { recursive: true })
    expect(logger.info).toHaveBeenCalledWith(
      '[vercel-sandbox:mode] auth resolved',
      { source: 'VERCEL_TOKEN', hasProjectId: false, timeoutMs: null },
    )
    expect(logger.info).toHaveBeenCalledWith(
      '[vercel-sandbox:mode] resolved sandbox handle',
      expect.objectContaining({
        workspaceId: 'workspace-mode',
        sandboxId: 'sb-mode-1',
        snapshotId: 'snap-mode-1',
      }),
    )
  } finally {
    await harness.cleanup()
  }
})

test('mode tracks workspace snapshots and marks dirty on mutations', async () => {
  const harness = await createMockVercelSandboxHarness()
  const sandboxWithMeta = harness.sandbox as unknown as {
    sandboxId: string
    status?: string
  }
  sandboxWithMeta.sandboxId = 'sb-mode-snapshot'
  sandboxWithMeta.status = 'running'

  const store = createStore()
  const client: VercelSandboxClient = {
    create: vi.fn(async () => harness.sandbox),
    get: vi.fn(),
  }
  const scheduler = {
    trackWorkspace: vi.fn(),
    markDirty: vi.fn(),
    stopWorkspace: vi.fn(),
    shutdown: vi.fn(async () => {}),
  }
  const adapter = createVercelSandboxModeAdapter({
    store,
    vercelClient: client,
    snapshotScheduler: scheduler,
    getEnvVar(name) {
      if (name === 'VERCEL_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
    logger: { info: vi.fn(), warn: vi.fn() },
  })

  try {
    const bundle = await adapter.create({
      workspaceRoot: 'workspace-mode-snapshot',
      workspaceId: 'workspace-mode-snapshot',
      sessionId: 'session-mode-snapshot',
    })

    expect(scheduler.trackWorkspace).toHaveBeenCalledWith({
      workspaceId: 'workspace-mode-snapshot',
      sandbox: harness.sandbox,
      store,
    })

    await bundle.workspace.writeFile('dirty.txt', 'dirty')
    await bundle.sandbox.exec('echo dirty')
    await adapter.dispose?.()

    expect(scheduler.markDirty).toHaveBeenCalledTimes(2)
    expect(scheduler.markDirty).toHaveBeenCalledWith('workspace-mode-snapshot')
    expect(scheduler.shutdown).toHaveBeenCalledTimes(1)
  } finally {
    await harness.cleanup()
  }
})

test('mode recreates a stopped sandbox from snapshot without losing workspace files', async () => {
  const firstHarness = await createMockVercelSandboxHarness()
  const createdHarnesses = [firstHarness]
  const snapshots = new Map<string, Array<{ path: string; content: Uint8Array }>>()
  let snapshotSeq = 0
  let sandboxSeq = 1

  const firstSandbox = addSandboxMeta(firstHarness.sandbox, {
    sandboxId: 'sb-persist-1',
    status: 'running',
    snapshot: async () => {
      const snapshotId = `snap-persist-${++snapshotSeq}`
      snapshots.set(snapshotId, firstHarness.lastWriteFiles.map((file) => ({
        path: file.path,
        content: new Uint8Array(file.content),
      })))
      return { snapshotId }
    },
  })

  const store = createStore()
  const client: VercelSandboxClient = {
    create: vi.fn(async (params) => {
      if (params?.source?.type !== 'snapshot') return firstSandbox

      const harness = await createMockVercelSandboxHarness()
      createdHarnesses.push(harness)
      const snapshotFiles = snapshots.get(params.source.snapshotId) ?? []
      if (snapshotFiles.length > 0) {
        await harness.sandbox.writeFiles(snapshotFiles)
      }

      return addSandboxMeta(harness.sandbox, {
        sandboxId: `sb-persist-${++sandboxSeq}`,
        status: 'running',
        sourceSnapshotId: params.source.snapshotId,
        snapshot: async () => ({ snapshotId: params.source.snapshotId }),
      })
    }),
    get: vi.fn(async ({ sandboxId }) => {
      if (sandboxId === 'sb-persist-1') return firstSandbox
      throw new Error(`unknown sandbox: ${sandboxId}`)
    }),
  }
  const scheduler = createManualSnapshotScheduler()
  const adapter = createVercelSandboxModeAdapter({
    store,
    vercelClient: client,
    snapshotScheduler: scheduler,
    orphanGuardMaxIdleMs: null,
    getEnvVar(name) {
      if (name === 'VERCEL_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
    logger: { info: vi.fn(), warn: vi.fn() },
  })

  try {
    const firstBundle = await adapter.create({
      workspaceRoot: 'workspace-persist',
      workspaceId: 'workspace-persist',
      sessionId: 'session-persist-1',
    })
    await firstBundle.workspace.writeFile('src/persisted.txt', 'persisted after stop')
    await scheduler.flush('workspace-persist')

    const storedBeforeStop = await store.get('workspace-persist')
    expect(storedBeforeStop).toMatchObject({
      workspaceId: 'workspace-persist',
      sandboxId: 'sb-persist-1',
      snapshotId: 'snap-persist-1',
    })

    ;(firstSandbox as unknown as { status: string }).status = 'stopped'
    evictSandboxHandleCacheForWorkspace('workspace-persist')

    const secondBundle = await adapter.create({
      workspaceRoot: 'workspace-persist',
      workspaceId: 'workspace-persist',
      sessionId: 'session-persist-2',
    })

    await expect(secondBundle.workspace.readFile('src/persisted.txt'))
      .resolves.toBe('persisted after stop')
    expect(client.create).toHaveBeenLastCalledWith({
      source: { type: 'snapshot', snapshotId: 'snap-persist-1' },
    })
    expect(await store.get('workspace-persist')).toMatchObject({
      sandboxId: 'sb-persist-2',
      snapshotId: 'snap-persist-1',
    })
  } finally {
    await adapter.dispose?.()
    await Promise.all(createdHarnesses.map((harness) => harness.cleanup()))
  }
})
