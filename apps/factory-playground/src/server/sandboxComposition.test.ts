import { describe, expect, it, vi } from 'vitest'
import type { DisposableSandboxProviderV1, SandboxProviderCreateContextV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { createPerEpicVercelProvider } from './sandboxComposition'
import type { ResolvedEpicSnapshot } from './snapshotRegistry'

function fakeExecResult(exitCode: number, stdout = '', stderr = '') {
  return {
    stdout: new TextEncoder().encode(stdout),
    stderr: new TextEncoder().encode(stderr),
    exitCode,
    durationMs: 1,
    truncated: false,
  }
}

/** Fake `buildInnerProvider`: one fake `DisposableSandboxProviderV1` per snapshot id, whose `sandbox.exec('true')` succeeds or fails according to `behaviorBySnapshotId`. */
function fakeBuildInnerProvider(behaviorBySnapshotId: Record<string, 'ok' | 'refresh-needed' | 'other-failure'>) {
  const disposed: string[] = []
  const created: string[] = []
  const build = vi.fn((snapshotId: string) => {
    const behavior = behaviorBySnapshotId[snapshotId] ?? 'ok'
    const pair: WorkspaceSandboxPairV1 = {
      workspace: {} as WorkspaceSandboxPairV1['workspace'],
      sandbox: {
        exec: async (cmd: string) => {
          if (cmd !== 'true') return fakeExecResult(0)
          if (behavior === 'ok') return fakeExecResult(0)
          if (behavior === 'refresh-needed') {
            return fakeExecResult(1, '', 'factory-bootstrap: 42 packages changed since deadbeef; refresh the epic snapshot')
          }
          return fakeExecResult(1, '', 'some other unrelated bootstrap failure')
        },
      } as unknown as WorkspaceSandboxPairV1['sandbox'],
      async dispose() { disposed.push(snapshotId) },
    }
    created.push(snapshotId)
    const provider: DisposableSandboxProviderV1 = {
      contractVersion: 'boring-sandbox-provider.v1' as never,
      providerId: 'vercel-sandbox',
      capabilities: {} as never,
      resolveRuntimeRoot: (context: SandboxProviderCreateContextV1) => context.workspaceRoot,
      async create() { return pair },
      disposableProfile: {
        contractVersion: 'boring-sandbox.disposable-provider.v1',
        resume: false,
        publishedCleanupOwner: 'returned-pair',
        ambiguousCreate: 'correlated-reconciliation',
        providerConfigDigest: `sha256:${'0'.repeat(64)}`,
      },
    }
    return provider
  })
  return { build, disposed, created }
}

function resolvedSnapshot(overrides: Partial<ResolvedEpicSnapshot> = {}): ResolvedEpicSnapshot {
  return {
    snapshotId: 'snap_1',
    baseSha: 'deadbeef',
    lockfileSha256: 'sha256:fixed',
    builtAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    epicKey: 'epic-a',
    reused: true,
    ...overrides,
  }
}

const AUTH_ENV = { VERCEL_TOKEN: 'tok', VERCEL_TEAM_ID: 'team', VERCEL_PROJECT_ID: 'proj' } as NodeJS.ProcessEnv

describe('createPerEpicVercelProvider', () => {
  it('lazily resolves the epic snapshot on create() and delegates to the matching inner provider', async () => {
    const resolveSnapshotFn = vi.fn(async (params: { epicKey: string; workspaceRoot: string; stateRoot: string }) => {
      void params
      return resolvedSnapshot({ snapshotId: 'snap_lazy' })
    })
    const { build } = fakeBuildInnerProvider({ snap_lazy: 'ok' })

    const provider = createPerEpicVercelProvider({
      workspaceRoot: '/ws',
      stateRoot: '/state',
      epicKey: 'epic-a',
      env: AUTH_ENV,
      leaseTimeoutMs: 1000,
      telemetrySalt: undefined,
      scratchRoot: '/scratch',
      remoteSource: undefined,
      log: () => {},
      buildInnerProvider: build,
      resolveSnapshotFn,
    })

    expect(resolveSnapshotFn).not.toHaveBeenCalled()
    const pair = await provider.create({ workspaceRoot: '/ws', sessionId: 's1' })
    expect(resolveSnapshotFn).toHaveBeenCalledTimes(1)
    expect(resolveSnapshotFn.mock.calls[0]![0]).toMatchObject({ epicKey: 'epic-a', workspaceRoot: '/ws', stateRoot: '/state' })
    expect(build).toHaveBeenCalledWith('snap_lazy', expect.anything())
    expect(pair).toBeDefined()
  })

  it('caches the inner provider per snapshot id across multiple create() calls', async () => {
    const resolveSnapshotFn = vi.fn(async () => resolvedSnapshot({ snapshotId: 'snap_cached' }))
    const { build } = fakeBuildInnerProvider({ snap_cached: 'ok' })

    const provider = createPerEpicVercelProvider({
      workspaceRoot: '/ws',
      stateRoot: '/state',
      epicKey: 'epic-a',
      env: AUTH_ENV,
      leaseTimeoutMs: 1000,
      telemetrySalt: undefined,
      scratchRoot: '/scratch',
      remoteSource: undefined,
      log: () => {},
      buildInnerProvider: build,
      resolveSnapshotFn,
    })

    await provider.create({ workspaceRoot: '/ws', sessionId: 's1' })
    await provider.create({ workspaceRoot: '/ws', sessionId: 's2' })
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('refreshes and retries once when the bootstrap guard reports too many changed packages', async () => {
    const resolveSnapshotFn = vi.fn()
      .mockResolvedValueOnce(resolvedSnapshot({ snapshotId: 'snap_stale', reused: true }))
      .mockResolvedValueOnce(resolvedSnapshot({ snapshotId: 'snap_fresh', reused: false }))
    const invalidateSnapshotFn = vi.fn(async () => {})
    const { build, disposed } = fakeBuildInnerProvider({ snap_stale: 'refresh-needed', snap_fresh: 'ok' })

    const provider = createPerEpicVercelProvider({
      workspaceRoot: '/ws',
      stateRoot: '/state',
      epicKey: 'epic-a',
      env: AUTH_ENV,
      leaseTimeoutMs: 1000,
      telemetrySalt: undefined,
      scratchRoot: '/scratch',
      remoteSource: undefined,
      log: () => {},
      buildInnerProvider: build,
      resolveSnapshotFn,
      invalidateSnapshotFn,
    })

    const pair = await provider.create({ workspaceRoot: '/ws', sessionId: 's1' })
    expect(pair).toBeDefined()
    expect(resolveSnapshotFn).toHaveBeenCalledTimes(2)
    expect(invalidateSnapshotFn).toHaveBeenCalledWith('/state', 'epic-a', 'sha256:fixed')
    expect(disposed).toEqual(['snap_stale'])
    expect(build).toHaveBeenCalledWith('snap_stale', expect.anything())
    expect(build).toHaveBeenCalledWith('snap_fresh', expect.anything())

    // The retried (fresh) snapshot's provider is now cached; a later create() reuses it without
    // resolving or building again.
    resolveSnapshotFn.mockResolvedValueOnce(resolvedSnapshot({ snapshotId: 'snap_fresh', reused: true }))
    await provider.create({ workspaceRoot: '/ws', sessionId: 's2' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('does not refresh on an unrelated bootstrap failure, returning the pair as-is for the caller to see the real error on its own exec', async () => {
    const resolveSnapshotFn = vi.fn(async () => resolvedSnapshot({ snapshotId: 'snap_broken' }))
    const invalidateSnapshotFn = vi.fn(async () => {})
    const { build } = fakeBuildInnerProvider({ snap_broken: 'other-failure' })

    const provider = createPerEpicVercelProvider({
      workspaceRoot: '/ws',
      stateRoot: '/state',
      epicKey: 'epic-a',
      env: AUTH_ENV,
      leaseTimeoutMs: 1000,
      telemetrySalt: undefined,
      scratchRoot: '/scratch',
      remoteSource: undefined,
      log: () => {},
      buildInnerProvider: build,
      resolveSnapshotFn,
      invalidateSnapshotFn,
    })

    const pair = await provider.create({ workspaceRoot: '/ws', sessionId: 's1' })
    expect(pair).toBeDefined()
    expect(resolveSnapshotFn).toHaveBeenCalledTimes(1)
    expect(invalidateSnapshotFn).not.toHaveBeenCalled()
  })

  it('throws when the refreshed snapshot still fails the bootstrap guard', async () => {
    const resolveSnapshotFn = vi.fn()
      .mockResolvedValueOnce(resolvedSnapshot({ snapshotId: 'snap_stale' }))
      .mockResolvedValueOnce(resolvedSnapshot({ snapshotId: 'snap_still_stale' }))
    const invalidateSnapshotFn = vi.fn(async () => {})
    const { build } = fakeBuildInnerProvider({ snap_stale: 'refresh-needed', snap_still_stale: 'refresh-needed' })

    const provider = createPerEpicVercelProvider({
      workspaceRoot: '/ws',
      stateRoot: '/state',
      epicKey: 'epic-a',
      env: AUTH_ENV,
      leaseTimeoutMs: 1000,
      telemetrySalt: undefined,
      scratchRoot: '/scratch',
      remoteSource: undefined,
      log: () => {},
      buildInnerProvider: build,
      resolveSnapshotFn,
      invalidateSnapshotFn,
    })

    await expect(provider.create({ workspaceRoot: '/ws', sessionId: 's1' }))
      .rejects.toThrow(/factory-bootstrap failed even after refreshing/)
    expect(resolveSnapshotFn).toHaveBeenCalledTimes(2)
    expect(invalidateSnapshotFn).toHaveBeenCalledTimes(1)
  })
})
