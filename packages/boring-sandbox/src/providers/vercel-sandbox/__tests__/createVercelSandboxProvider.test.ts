import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '@hachej/boring-agent/shared'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { IMMUTABLE_SANDBOX_CACHE_SOURCE_VERSION_V1 } from '../../../shared/immutableCacheV1'
import type { SandboxProviderCreateContextV1 } from '../../../shared/providerV1'
import { expectDisposableProviderProfile } from '../../__tests__/conformance/disposableProvider'
import { createMockVercelSandboxHarness } from '../../__tests__/mockVercelSandbox'
import { createVercelSandboxProvider } from '../createVercelSandboxProvider'
import {
  resetSandboxHandleCacheForTests,
  type VercelSandboxClient,
} from '../resolveSandboxHandle'

const { localSandboxDispose, localSandboxInit } = vi.hoisted(() => ({
  localSandboxDispose: vi.fn(async () => {}),
  localSandboxInit: vi.fn(async () => {}),
}))

vi.mock('../createVercelSandboxExec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../createVercelSandboxExec')>()
  return {
    ...original,
    createVercelSandboxExec(
      ...args: Parameters<typeof original.createVercelSandboxExec>
    ) {
      const sandbox = original.createVercelSandboxExec(...args)
      return {
        ...sandbox,
        async init(...initArgs: Parameters<NonNullable<typeof sandbox.init>>) {
          await localSandboxInit()
          return await sandbox.init?.(...initArgs)
        },
        dispose: localSandboxDispose,
      }
    },
  }
})

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
  const deleteSandbox = vi.fn(async () => {})
  Object.assign(sandbox, {
    sandboxId,
    name: sandboxId,
    persistent: true,
    status: 'running',
    stop,
    snapshot,
    delete: deleteSandbox,
  })
  return { stop, snapshot, deleteSandbox }
}

const cleanups: Array<() => Promise<void>> = []

beforeEach(() => {
  localSandboxDispose.mockReset().mockResolvedValue(undefined)
  localSandboxInit.mockReset().mockResolvedValue(undefined)
})

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

    const persistentCacheConsumer = createVercelSandboxProvider({
      immutableCacheSource: {
        contractVersion: IMMUTABLE_SANDBOX_CACHE_SOURCE_VERSION_V1,
        providerId: 'vercel-sandbox',
        opaqueRef: 'snap_trusted_main',
      },
      getEnvVar,
    })
    await expect(persistentCacheConsumer.create({
      workspaceRoot: 'workspace-persistent-cache',
      sessionId: 'session-persistent-cache',
    })).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  test('cleans provider-local state when setup fails after handle acquisition', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { stop, snapshot, deleteSandbox } = addDurableHandleMetadata(harness.sandbox, 'sb-setup-failure')
    deleteSandbox.mockRejectedValueOnce(new Error('first delete acknowledgement lost'))
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
      lifecycle: 'disposable',
      getEnvVar,
      snapshotScheduler: scheduler,
      logger: { info: vi.fn() },
    })

    expectDisposableProviderProfile(provider, 'vercel-sandbox')
    const pair = await provider.create({
      workspaceRoot: 'workspace-setup-failure',
      workspaceId: 'workspace-setup-failure',
      sessionId: 'session-setup-failure',
    })
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^boring-lease-[a-f0-9]{40}$/),
    }))
    await expect(pair.checkHealth?.()).rejects.toMatchObject({
      code: 'VERCEL_API_ERROR',
      message: 'workspace root setup failed',
    })
    await expect(pair.dispose()).rejects.toThrow('disposable sandbox cleanup failed')
    await expect(pair.dispose()).resolves.toBeUndefined()

    expect(scheduler.trackWorkspace).not.toHaveBeenCalled()
    expect(scheduler.stopWorkspace).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(deleteSandbox).toHaveBeenCalledTimes(2)
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  test('reconciles a disposable create whose acknowledgement is lost', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { deleteSandbox } = addDurableHandleMetadata(harness.sandbox, 'sb-response-loss')
    const client: VercelSandboxClient = {
      create: vi.fn(async () => { throw Object.assign(new Error('response lost'), { status: 503 }) }),
      get: vi.fn(async () => harness.sandbox),
    }
    const provider = createVercelSandboxProvider({
      vercelClient: client,
      lifecycle: 'disposable',
      getEnvVar,
      logger: { info: vi.fn() },
    })

    await expect(provider.create({
      workspaceRoot: 'workspace-response-loss',
      workspaceId: 'workspace-response-loss',
      sessionId: 'session-response-loss',
      requestId: 'request-response-loss',
    })).rejects.toBeTruthy()
    expect(client.get).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^boring-lease-/),
      resume: false,
    }))
    expect(deleteSandbox).toHaveBeenCalledOnce()
    await provider.close?.()
  })

  test('retains cleanup authority when post-create adaptation fails and deletion needs retry', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { deleteSandbox } = addDurableHandleMetadata(harness.sandbox, 'sb-post-create-failure')
    deleteSandbox.mockRejectedValueOnce(new Error('first delete acknowledgement lost'))
    const { store, deleteRecord } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const logger = {
      info: vi.fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => { throw new Error('logger failed after remote creation') }),
      warn: vi.fn(),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      lifecycle: 'disposable',
      getEnvVar,
      logger,
    })

    await expect(provider.create({
      workspaceRoot: 'workspace-post-create-failure',
      workspaceId: 'workspace-post-create-failure',
      sessionId: 'session-post-create-failure',
    })).rejects.toMatchObject({
      code: 'VERCEL_API_ERROR',
      message: 'logger failed after remote creation',
    })
    expect(deleteSandbox).toHaveBeenCalledOnce()

    await expect(provider.close!()).resolves.toBeUndefined()
    await expect(provider.close!()).resolves.toBeUndefined()
    expect(deleteSandbox).toHaveBeenCalledTimes(2)
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  test('remote setup cleanup continues when local sandbox cleanup fails', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { deleteSandbox } = addDurableHandleMetadata(harness.sandbox, 'sb-local-cleanup-failure')
    localSandboxInit.mockRejectedValueOnce(new Error('sandbox init failed'))
    localSandboxDispose.mockRejectedValueOnce(new Error('local dispose failed'))
    const { store, deleteRecord } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const logger = { info: vi.fn(), warn: vi.fn() }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      lifecycle: 'disposable',
      getEnvVar,
      logger,
    })

    const pair = await provider.create({
      workspaceRoot: 'workspace-local-cleanup-failure',
      workspaceId: 'workspace-local-cleanup-failure',
      sessionId: 'session-local-cleanup-failure',
    })
    await expect(pair.checkHealth?.()).rejects.toMatchObject({
      code: 'VERCEL_API_ERROR',
      message: 'sandbox init failed',
    })
    await expect(pair.dispose()).rejects.toThrow('disposable sandbox cleanup failed')
    await pair.dispose()

    expect(localSandboxDispose).toHaveBeenCalledTimes(2)
    expect(deleteSandbox).toHaveBeenCalledOnce()
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[vercel-sandbox:mode] local setup cleanup failed',
      expect.anything(),
    )
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

  test('disposable lifecycle bypasses resumable storage and converges remote deletion', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { deleteSandbox } = addDurableHandleMetadata(harness.sandbox, 'sb-disposable')
    const { store, deleteRecord } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      lifecycle: 'disposable',
      immutableCacheSource: {
        contractVersion: IMMUTABLE_SANDBOX_CACHE_SOURCE_VERSION_V1,
        providerId: 'vercel-sandbox',
        opaqueRef: 'snap_trusted_main',
      },
      getEnvVar,
      logger: { info: vi.fn() },
    })
    const context: SandboxProviderCreateContextV1 = {
      workspaceRoot: 'workspace-disposable',
      workspaceId: 'workspace-disposable',
      sessionId: 'session-disposable',
    }

    const firstPair = await provider.create(context)
    deleteSandbox.mockRejectedValueOnce(new Error('remote delete failed'))
    await expect(firstPair.dispose()).rejects.toThrow('disposable sandbox cleanup failed')
    expect(deleteRecord).not.toHaveBeenCalled()
    await firstPair.dispose()
    await firstPair.dispose()
    const secondPair = await provider.create(context)

    expect(deleteSandbox).toHaveBeenCalledTimes(2)
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(await store.list()).toEqual([])
    expect(client.create).toHaveBeenCalledTimes(2)
    expect(client.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      persistent: true,
      source: { type: 'snapshot', snapshotId: 'snap_trusted_main' },
    }))
    expect(client.get).not.toHaveBeenCalled()
    deleteSandbox.mockRejectedValueOnce(Object.assign(new Error('sandbox not found'), { status: 404 }))
    await expect(secondPair.dispose()).resolves.toBeUndefined()
    expect(deleteSandbox).toHaveBeenCalledTimes(3)
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  test('provider close leaves a published disposable pair under caller cleanup authority', async () => {
    const harness = await createMockVercelSandboxHarness()
    cleanups.push(harness.cleanup)
    const { deleteSandbox } = addDurableHandleMetadata(harness.sandbox, 'sb-published-owner')
    const { store } = createStore()
    const client: VercelSandboxClient = {
      create: vi.fn(async () => harness.sandbox),
      get: vi.fn(),
    }
    const provider = createVercelSandboxProvider({
      store,
      vercelClient: client,
      lifecycle: 'disposable',
      getEnvVar,
      logger: { info: vi.fn() },
    })

    const pair = await provider.create({
      workspaceRoot: 'workspace-published-owner',
      workspaceId: 'workspace-published-owner',
      sessionId: 'session-published-owner',
    })
    await expect(pair.checkHealth?.()).resolves.toEqual({ state: 'ok' })

    await expect(provider.close!()).resolves.toBeUndefined()
    expect(deleteSandbox).not.toHaveBeenCalled()
    expect(localSandboxDispose).not.toHaveBeenCalled()

    await expect(pair.dispose()).resolves.toBeUndefined()
    expect(deleteSandbox).toHaveBeenCalledOnce()
    expect(localSandboxDispose).toHaveBeenCalledOnce()
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
