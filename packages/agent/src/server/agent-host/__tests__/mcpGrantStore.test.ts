import { describe, expect, test } from 'vitest'
import {
  createInMemoryMcpGrantStore,
  createWorkspaceRuntimeResourceMcpGrantStore,
  MCP_GRANT_RESOURCE_KIND,
  type WorkspaceRuntimeResourceHost,
  type WorkspaceRuntimeResourceInputLike,
  type WorkspaceRuntimeResourceLike,
} from '../mcpGrantStore'

/** Minimal fake mirroring LocalWorkspaceStore's runtime-resource behavior (key = workspaceId:kind:purpose:provider). */
function createFakeWorkspaceRuntimeResourceHost(): WorkspaceRuntimeResourceHost {
  const resources = new Map<string, WorkspaceRuntimeResourceLike>()
  const key = (workspaceId: string, r: { kind: string; purpose: string; provider: string }) =>
    `${workspaceId}:${r.kind}:${r.purpose}:${r.provider}`
  return {
    async listWorkspaceRuntimeResources(workspaceId) {
      return Array.from(resources.values()).filter((r) => !workspaceId || r.workspaceId === workspaceId)
    },
    async putWorkspaceRuntimeResource(workspaceId, resource: WorkspaceRuntimeResourceInputLike) {
      const next: WorkspaceRuntimeResourceLike = {
        workspaceId,
        kind: resource.kind,
        purpose: resource.purpose,
        provider: resource.provider,
        state: resource.state,
        config: resource.config ?? {},
      }
      resources.set(key(workspaceId, resource), next)
      return next
    },
    async deleteWorkspaceRuntimeResource(workspaceId, selector) {
      const existing = resources.get(key(workspaceId, selector))
      if (existing) resources.set(key(workspaceId, selector), { ...existing, state: 'deleted' })
    },
  }
}

describe('createWorkspaceRuntimeResourceMcpGrantStore', () => {
  test('round-trips a grant through the workspace runtime-resource store', async () => {
    const host = createFakeWorkspaceRuntimeResourceHost()
    const store = createWorkspaceRuntimeResourceMcpGrantStore(host)

    await store.putGrant({
      workspaceId: 'ws-1',
      agentTypeId: 'researcher',
      connectorId: 'notion',
      allowedTools: ['NOTION_RETRIEVE_PAGE'],
    })

    expect(await store.listGrants('ws-1')).toEqual([
      { workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] },
    ])
    expect(await store.listGrants('ws-2')).toEqual([])
  })

  test('persists as a kind=mcp-grant resource keyed by (purpose=agentTypeId, provider=connectorId)', async () => {
    const host = createFakeWorkspaceRuntimeResourceHost()
    const store = createWorkspaceRuntimeResourceMcpGrantStore(host)

    await store.putGrant({ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: [] })

    const raw = await host.listWorkspaceRuntimeResources('ws-1')
    expect(raw).toEqual([
      expect.objectContaining({ kind: MCP_GRANT_RESOURCE_KIND, purpose: 'researcher', provider: 'notion' }),
    ])
  })

  test('deleteGrant removes the grant from subsequent listGrants calls', async () => {
    const host = createFakeWorkspaceRuntimeResourceHost()
    const store = createWorkspaceRuntimeResourceMcpGrantStore(host)

    await store.putGrant({ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: ['x'] })
    await store.deleteGrant({ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion' })

    expect(await store.listGrants('ws-1')).toEqual([])
  })
})

describe('createInMemoryMcpGrantStore', () => {
  test('supports put/list/delete and stays workspace-scoped', async () => {
    const store = createInMemoryMcpGrantStore()
    await store.putGrant({ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t1'] })
    await store.putGrant({ workspaceId: 'b', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t2'] })

    expect(await store.listGrants('a')).toEqual([{ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t1'] }])
    expect(await store.listGrants('b')).toEqual([{ workspaceId: 'b', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t2'] }])

    await store.deleteGrant({ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion' })
    expect(await store.listGrants('a')).toEqual([])
  })
})
