import { describe, expect, it } from 'vitest'

import { WorkspaceRuntimeSandboxHandleStore } from '../WorkspaceRuntimeSandboxHandleStore.js'
import type { WorkspaceRuntime } from '../../../shared/types.js'

function makeRuntime(
  workspaceId: string,
  overrides: Partial<WorkspaceRuntime> = {},
): WorkspaceRuntime {
  return {
    workspaceId,
    spriteUrl: null,
    spriteName: null,
    state: 'pending',
    lastError: null,
    volumePath: null,
    lastErrorOp: null,
    provisioningStep: null,
    stepStartedAt: null,
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}

describe('WorkspaceRuntimeSandboxHandleStore', () => {
  it('maps sandbox handles onto workspace runtime rows', async () => {
    const runtimes = new Map<string, WorkspaceRuntime>([
      ['ws-1', makeRuntime('ws-1')],
    ])
    const store = new WorkspaceRuntimeSandboxHandleStore({
      async getWorkspaceRuntime(workspaceId) {
        return runtimes.get(workspaceId) ?? null
      },
      async putWorkspaceRuntime(workspaceId, state) {
        const existing = runtimes.get(workspaceId)
        if (!existing) throw new Error('missing')
        const updated = makeRuntime(workspaceId, {
          ...existing,
          ...state,
          updatedAt: '2026-04-29T00:01:00.000Z',
        })
        runtimes.set(workspaceId, updated)
        return updated
      },
      async listWorkspaceRuntimes() {
        return Array.from(runtimes.values())
      },
    })

    await store.put({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_123',
      snapshotId: 'snap_123',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:02:00.000Z',
    })

    expect(await store.get('ws-1')).toMatchObject({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_123',
      snapshotId: 'snap_123',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:02:00.000Z',
    })
    expect(runtimes.get('ws-1')?.sandboxProvider).toBe('vercel')
    expect(runtimes.get('ws-1')?.state).toBe('ready')
    expect(await store.list()).toHaveLength(1)

    await store.delete('ws-1')
    expect(await store.get('ws-1')).toBeNull()
  })

  it('prefers generic runtime resource rows and mirrors legacy runtime columns', async () => {
    const runtimes = new Map<string, WorkspaceRuntime>([
      ['ws-1', makeRuntime('ws-1')],
    ])
    const resources = new Map<string, any>()
    const store = new WorkspaceRuntimeSandboxHandleStore({
      async getWorkspaceRuntime(workspaceId) {
        return runtimes.get(workspaceId) ?? null
      },
      async putWorkspaceRuntime(workspaceId, state) {
        const existing = runtimes.get(workspaceId)
        if (!existing) throw new Error('missing')
        const updated = makeRuntime(workspaceId, {
          ...existing,
          ...state,
          updatedAt: '2026-04-29T00:01:00.000Z',
        })
        runtimes.set(workspaceId, updated)
        return updated
      },
      async getWorkspaceRuntimeResource(workspaceId, selector) {
        return resources.get(`${workspaceId}:${selector.kind}:${selector.purpose}:${selector.provider}`) ?? null
      },
      async putWorkspaceRuntimeResource(workspaceId, resource) {
        const row = {
          id: 'resource-1',
          workspaceId,
          kind: resource.kind,
          purpose: resource.purpose,
          provider: resource.provider,
          handleKind: resource.handleKind,
          stableKey: resource.stableKey ?? null,
          providerResourceId: resource.providerResourceId ?? null,
          parentResourceId: null,
          state: resource.state,
          persistenceMode: resource.persistenceMode,
          config: resource.config ?? {},
          providerMeta: resource.providerMeta ?? {},
          lastError: null,
          lastErrorCode: null,
          createdAt: '2026-04-29T00:00:00.000Z',
          updatedAt: '2026-04-29T00:03:00.000Z',
          lastSeenAt: resource.lastSeenAt ?? null,
          lastUsedAt: resource.lastUsedAt ?? null,
          expiresAt: null,
          generation: 0,
        }
        resources.set(`${workspaceId}:${resource.kind}:${resource.purpose}:${resource.provider}`, row)
        return row
      },
      async deleteWorkspaceRuntimeResource(workspaceId, selector) {
        resources.delete(`${workspaceId}:${selector.kind}:${selector.purpose}:${selector.provider}`)
      },
    })

    await store.put({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_beta',
      snapshotId: 'snap_beta',
      stableKey: 'boring-dev-ws-1',
      handleKind: 'named',
      persistenceMode: 'persistent',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:02:00.000Z',
    })

    expect(await store.get('ws-1')).toMatchObject({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_beta',
      snapshotId: 'snap_beta',
      stableKey: 'boring-dev-ws-1',
      handleKind: 'named',
      persistenceMode: 'persistent',
    })
    expect(runtimes.get('ws-1')?.sandboxId).toBe('sbx_beta')

    await store.delete('ws-1')
    expect(resources.size).toBe(0)
    expect(await store.get('ws-1')).toBeNull()
  })

  it('rolls back generic resource writes when legacy runtime mirror update fails', async () => {
    const runtimes = new Map<string, WorkspaceRuntime>([
      ['ws-1', makeRuntime('ws-1', {
        sandboxId: 'sbx_old',
        sandboxSnapshotId: 'snap_old',
      })],
    ])
    const resources = new Map<string, any>([
      ['ws-1:sandbox:main:vercel', {
        id: 'resource-old',
        workspaceId: 'ws-1',
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
        handleKind: 'session',
        stableKey: null,
        providerResourceId: 'sbx_old',
        parentResourceId: null,
        state: 'ready',
        persistenceMode: 'snapshot',
        config: {},
        providerMeta: { snapshotId: 'snap_old' },
        lastError: null,
        lastErrorCode: null,
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:03:00.000Z',
        lastSeenAt: null,
        lastUsedAt: '2026-04-29T00:02:00.000Z',
        expiresAt: null,
        generation: 0,
      }],
    ])
    const store = new WorkspaceRuntimeSandboxHandleStore({
      async getWorkspaceRuntime(workspaceId) {
        return runtimes.get(workspaceId) ?? null
      },
      async putWorkspaceRuntime() {
        throw new Error('runtime mirror failed')
      },
      async getWorkspaceRuntimeResource(workspaceId, selector) {
        return resources.get(`${workspaceId}:${selector.kind}:${selector.purpose}:${selector.provider}`) ?? null
      },
      async putWorkspaceRuntimeResource(workspaceId, resource) {
        const row = {
          id: resource.id ?? 'resource-new',
          workspaceId,
          kind: resource.kind,
          purpose: resource.purpose,
          provider: resource.provider,
          handleKind: resource.handleKind,
          stableKey: resource.stableKey ?? null,
          providerResourceId: resource.providerResourceId ?? null,
          parentResourceId: resource.parentResourceId ?? null,
          state: resource.state,
          persistenceMode: resource.persistenceMode,
          config: resource.config ?? {},
          providerMeta: resource.providerMeta ?? {},
          lastError: resource.lastError ?? null,
          lastErrorCode: resource.lastErrorCode ?? null,
          createdAt: '2026-04-29T00:00:00.000Z',
          updatedAt: '2026-04-29T00:03:00.000Z',
          lastSeenAt: resource.lastSeenAt ?? null,
          lastUsedAt: resource.lastUsedAt ?? null,
          expiresAt: resource.expiresAt ?? null,
          generation: resource.generation ?? 0,
        }
        resources.set(`${workspaceId}:${resource.kind}:${resource.purpose}:${resource.provider}`, row)
        return row
      },
      async deleteWorkspaceRuntimeResource(workspaceId, selector) {
        resources.delete(`${workspaceId}:${selector.kind}:${selector.purpose}:${selector.provider}`)
      },
    })

    await expect(store.put({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_new',
      snapshotId: 'snap_new',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:04:00.000Z',
    })).rejects.toThrow('runtime mirror failed')

    expect(await store.get('ws-1')).toMatchObject({
      sandboxId: 'sbx_old',
      snapshotId: 'snap_old',
    })
  })
})
