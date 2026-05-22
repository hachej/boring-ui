import { describe, expect, it } from 'vitest'

import { WorkspaceRuntimeSandboxHandleStore } from '../WorkspaceRuntimeSandboxHandleStore.js'
import type { WorkspaceRuntimeResource, WorkspaceRuntimeResourceInput, WorkspaceRuntimeResourceSelector } from '../../../shared/types.js'

function key(workspaceId: string, selector: WorkspaceRuntimeResourceSelector): string {
  return `${workspaceId}:${selector.kind}:${selector.purpose}:${selector.provider}`
}

function makeResourceStore(initial: WorkspaceRuntimeResource[] = []) {
  const resources = new Map<string, WorkspaceRuntimeResource>()
  for (const resource of initial) resources.set(key(resource.workspaceId, resource), resource)
  return {
    resources,
    store: {
      async getWorkspaceRuntimeResource(workspaceId: string, selector: WorkspaceRuntimeResourceSelector) {
        return resources.get(key(workspaceId, selector)) ?? null
      },
      async putWorkspaceRuntimeResource(workspaceId: string, resource: WorkspaceRuntimeResourceInput) {
        const row: WorkspaceRuntimeResource = {
          id: resource.id ?? `resource-${resources.size + 1}`,
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
        resources.set(key(workspaceId, row), row)
        return row
      },
      async deleteWorkspaceRuntimeResource(workspaceId: string, selector: WorkspaceRuntimeResourceSelector) {
        resources.delete(key(workspaceId, selector))
      },
      async listWorkspaceRuntimeResources() {
        return Array.from(resources.values())
      },
    },
  }
}

describe('WorkspaceRuntimeSandboxHandleStore', () => {
  it('stores sandbox handles as runtime resources only', async () => {
    const { store, resources } = makeResourceStore()
    const handles = new WorkspaceRuntimeSandboxHandleStore(store)

    await handles.put({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_123',
      snapshotId: 'snap_123',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:02:00.000Z',
    })

    expect(resources.size).toBe(1)
    expect(await handles.get('ws-1')).toMatchObject({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_123',
      snapshotId: 'snap_123',
      provider: 'vercel',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:02:00.000Z',
    })
    expect(await handles.list()).toHaveLength(1)

    await handles.delete('ws-1')
    expect(await handles.get('ws-1')).toBeNull()
  })

  it('preserves resource metadata fields on readback', async () => {
    const { store } = makeResourceStore()
    const handles = new WorkspaceRuntimeSandboxHandleStore(store)

    await handles.put({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_beta',
      snapshotId: 'snap_beta',
      stableKey: 'boring-dev-ws-1',
      handleKind: 'named',
      persistenceMode: 'persistent',
      providerMeta: { region: 'iad1' },
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:02:00.000Z',
    })

    expect(await handles.get('ws-1')).toMatchObject({
      workspaceId: 'ws-1',
      sandboxId: 'sbx_beta',
      snapshotId: 'snap_beta',
      stableKey: 'boring-dev-ws-1',
      handleKind: 'named',
      persistenceMode: 'persistent',
      providerMeta: { region: 'iad1', snapshotId: 'snap_beta' },
    })
  })

  it('lists only live main vercel sandbox resources', async () => {
    const { store } = makeResourceStore([
      {
        id: 'live',
        workspaceId: 'ws-live',
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
        handleKind: 'session',
        stableKey: null,
        providerResourceId: 'sbx_live',
        parentResourceId: null,
        state: 'ready',
        persistenceMode: 'snapshot',
        config: {},
        providerMeta: {},
        lastError: null,
        lastErrorCode: null,
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:03:00.000Z',
        lastSeenAt: null,
        lastUsedAt: null,
        expiresAt: null,
        generation: 0,
      },
      {
        id: 'deleted',
        workspaceId: 'ws-deleted',
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
        handleKind: 'session',
        stableKey: null,
        providerResourceId: 'sbx_deleted',
        parentResourceId: null,
        state: 'deleted',
        persistenceMode: 'snapshot',
        config: {},
        providerMeta: {},
        lastError: null,
        lastErrorCode: null,
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:03:00.000Z',
        lastSeenAt: null,
        lastUsedAt: null,
        expiresAt: null,
        generation: 0,
      },
    ])
    const handles = new WorkspaceRuntimeSandboxHandleStore(store)
    expect(await handles.list()).toEqual([
      expect.objectContaining({ workspaceId: 'ws-live', sandboxId: 'sbx_live' }),
    ])
  })
})
