import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '@hachej/boring-agent/shared'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { SandboxProviderCreateContextV1 } from '../../../shared/providerV1'
import { createMockVercelSandboxHarness } from '../../__tests__/mockVercelSandbox'
import { createVercelSandboxProvider } from '../createVercelSandboxProvider'
import {
  resetSandboxHandleCacheForTests,
  type VercelSandboxClient,
} from '../resolveSandboxHandle'

interface StoreHarness {
  store: SandboxHandleStore
  deleteRecord: ReturnType<typeof vi.fn>
}

function createStore(initial: SandboxHandleRecord[] = []): StoreHarness {
  const records = new Map(initial.map((record) => [record.workspaceId, record]))
  const deleteRecord = vi.fn(async (workspaceId: string) => {
    records.delete(workspaceId)
  })
  return {
    store: {
      async get(workspaceId) { return records.get(workspaceId) ?? null },
      async put(record) { records.set(record.workspaceId, record) },
      delete: deleteRecord,
      async list() { return [...records.values()] },
    },
    deleteRecord,
  }
}

function getEnvVar(name: string): string | undefined {
  return ({
    VERCEL_TOKEN: 'token-1',
    VERCEL_TEAM_ID: 'team-1',
  })[name]
}

function createScheduler() {
  return {
    trackWorkspace: vi.fn(),
    markDirty: vi.fn(),
    stopWorkspace: vi.fn(),
    shutdown: vi.fn(async () => {}),
  }
}

function addDurableHandleMetadata(sandbox: VercelSandbox, sandboxId: string) {
  const stop = vi.fn(async () => {})
  const snapshot = vi.fn(async () => ({ snapshotId: 'unexpected-snapshot' }))
  Object.assign(sandbox, {
    sandboxId,
    name: sandboxId,
    persistent: true,
    status: 'running',
    stop,
    snapshot,
  })
  return { stop, snapshot }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  resetSandboxHandleCacheForTests()
  await Promise.all(cleanups.splice(0).map(async (cleanup) => { await cleanup() }))
})

describe('createVercelSandboxProvider', () => {
  test('preserves stable auth and config error codes', async () => {
    const missingAuth = createVercelSandboxProvider({
      getEnvVar(name) {
        return name === 'VERCEL_TEAM_ID' ? 'team-1' : undefined
      },
    })
    await expect(missingAuth.create({
      workspaceRoot: 'workspace-auth',
      sessionId: 'session-auth',
    })).rejects.toMatchObject({ code: 'VERCEL_AUTH_FAILED' })

    const invalidTimeout = createVercelSandboxProvider({
      getEnvVar(name) {
        if (name === 'VERCEL_TOKEN') return 'token-1'
        if (name === 'VERCEL_TEAM_ID') return 'team-1'
        if (name === 'BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS') return 'soon'
        return undefined
      },
    })
    await expect(invalidTimeout.create({
      workspaceRoot: 'workspace-config',
      sessionId: 'session-config',
    })).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  test('cleans provider-local state when setup fails after handle acquisition', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { stop, snapshot } = addDurableHandleMetadata(harness.sandbox, 'sb-setup-failure')
    vi.spyOn((harness.sandbox as unknown as { fs: { mkdir(): Promise<void> } }).fs, 'mkdir')
      .mockRejectedValueOnce(Object.assign(
        new Error('workspace root setup failed'),
        { code: 'ECONNRESET' },
      ))
    const scheduler = createScheduler()
    const { store, deleteRecord } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      getEnvVar,
      snapshotScheduler: scheduler,
      logger: { info: vi.fn() },
    })

    await expect(provider.create({
      workspaceRoot: 'workspace-setup-failure',
      workspaceId: 'workspace-setup-failure',
      sessionId: 'session-setup-failure',
    })).rejects.toMatchObject({
      code: 'VERCEL_API_ERROR',
      message: 'workspace root setup failed',
    })

    expect(scheduler.trackWorkspace).toHaveBeenCalledTimes(1)
    expect(scheduler.stopWorkspace).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  test('pair disposal is idempotent and leaves the durable cached handle reusable', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { stop, snapshot } = addDurableHandleMetadata(harness.sandbox, 'sb-durable')
    const scheduler = createScheduler()
    const { store, deleteRecord } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      getEnvVar,
      snapshotScheduler: scheduler,
      logger: { info: vi.fn() },
    })
    const context: SandboxProviderCreateContextV1 = {
      workspaceRoot: 'workspace-durable',
      workspaceId: 'workspace-durable',
      sessionId: 'session-durable',
    }

    const firstPair = await provider.create(context)
    await firstPair.dispose()
    await firstPair.dispose()
    const secondPair = await provider.create(context)

    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.get).not.toHaveBeenCalled()
    expect(scheduler.stopWorkspace).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()

    await secondPair.dispose()
    await provider.close?.()
    expect(scheduler.stopWorkspace).toHaveBeenCalledTimes(2)
    expect(scheduler.shutdown).toHaveBeenCalledOnce()
  })

  test('invalidate evicts only the process cache and reacquires the persisted handle', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { stop, snapshot } = addDurableHandleMetadata(harness.sandbox, 'sb-invalidate')
    const { store, deleteRecord } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(async () => harness.sandbox),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      getEnvVar,
      logger: { info: vi.fn() },
    })
    const context: SandboxProviderCreateContextV1 = {
      workspaceRoot: 'workspace-invalidate',
      workspaceId: 'workspace-invalidate',
      sessionId: 'session-invalidate',
    }

    const firstPair = await provider.create(context)
    await firstPair.dispose()
    provider.invalidate?.({ workspaceId: 'workspace-invalidate' })
    const secondPair = await provider.create(context)

    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.get).toHaveBeenCalledOnce()
    expect(client.get).toHaveBeenCalledWith({
      sandboxId: 'sb-invalidate',
      name: 'sb-invalidate',
      resume: true,
    })
    expect(stop).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()
    await secondPair.dispose()
  })

  test('a provisioning-only lease uses one pair for exec and artifact materialization', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    addDurableHandleMetadata(harness.sandbox, 'sb-provisioning')
    const sourceRoot = await mkdtemp(join(tmpdir(), 'boring-sandbox-python-source-'))
    cleanups.push(async () => { await rm(sourceRoot, { recursive: true, force: true }) })
    await mkdir(join(sourceRoot, 'fixture'), { recursive: true })
    await writeFile(join(sourceRoot, 'fixture', '__init__.py'), 'VALUE = 1\n', 'utf8')

    const scheduler = createScheduler()
    const { store } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      getEnvVar,
      snapshotScheduler: scheduler,
      logger: { info: vi.fn() },
    })

    const pair = await provider.create({
      workspaceRoot: 'workspace-provisioning',
      workspaceId: 'workspace-provisioning',
      sessionId: 'session-provisioning',
    })
    try {
      const provisioning = pair.provisioning
      expect(provisioning).toBeDefined()
      const installSource = await provisioning!.resolveInstallSource(sourceRoot, {
        kind: 'python',
        id: 'fixture',
        fingerprint: 'sha256:abc123',
      })
      expect(installSource).toBe(
        '/workspace/.boring-agent/tmp/fixture-v1-abc123.tar.gz',
      )
      await expect(pair.workspace.stat(
        '.boring-agent/tmp/fixture-v1-abc123.tar.gz',
      )).resolves.toMatchObject({ kind: 'file' })
      await expect(provisioning!.exec('echo', ['same-pair']))
        .resolves.toMatchObject({ stdout: expect.stringContaining('same-pair') })
      expect(client.create).toHaveBeenCalledOnce()
      expect(client.get).not.toHaveBeenCalled()
    } finally {
      await pair.dispose()
    }
    expect(scheduler.stopWorkspace).toHaveBeenCalledOnce()
  })
})
