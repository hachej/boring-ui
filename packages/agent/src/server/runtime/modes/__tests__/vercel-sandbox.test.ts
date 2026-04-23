import { afterEach, expect, test, vi } from 'vitest'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../../../../shared/sandbox-handle-store'
import {
  resetSandboxHandleCacheForTests,
  type VercelSandboxClient,
} from '../../../sandbox/vercel-sandbox/resolveSandboxHandle'
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

afterEach(() => {
  resetSandboxHandleCacheForTests()
})

test('mode requires VERCEL_OIDC_TOKEN', async () => {
  const adapter = createVercelSandboxModeAdapter({
    getEnvVar(name) {
      if (name === 'VERCEL_OIDC_TOKEN') return undefined
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
  })

  await expect(
    adapter.create({
      workspaceRoot: 'workspace-a',
      sessionId: 'session-a',
    }),
  ).rejects.toThrow('VERCEL_OIDC_TOKEN is required for vercel-sandbox mode')
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

test('mode creates working bundle with shared workspace/exec substrate', async () => {
  const harness = await createMockVercelSandboxHarness()
  const sandboxWithMeta = harness.sandbox as unknown as {
    sandboxId: string
    sourceSnapshotId?: string
    status?: string
  }
  sandboxWithMeta.sandboxId = 'sb-mode-1'
  sandboxWithMeta.sourceSnapshotId = 'snap-mode-1'
  sandboxWithMeta.status = 'running'

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
      if (name === 'VERCEL_OIDC_TOKEN') return 'token-1'
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
