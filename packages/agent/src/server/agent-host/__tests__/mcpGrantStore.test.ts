import { describe, expect, test } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
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

    expect(await store.listGrants('ws-1')).toEqual({
      grants: [{ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] }],
      diagnostics: [],
    })
    expect(await store.listGrants('ws-2')).toEqual({ grants: [], diagnostics: [] })
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

    expect(await store.listGrants('ws-1')).toEqual({ grants: [], diagnostics: [] })
  })

  test('rejects a glob metacharacter in allowedTools at write time instead of storing a footgun', async () => {
    const host = createFakeWorkspaceRuntimeResourceHost()
    const store = createWorkspaceRuntimeResourceMcpGrantStore(host)

    await expect(
      store.putGrant({ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: ['*'] }),
    ).rejects.toMatchObject({ code: ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NAME_INVALID })
    expect(await store.listGrants('ws-1')).toEqual({ grants: [], diagnostics: [] })
  })

  test('skips a malformed grant row (missing config) with a stable diagnostic instead of crashing listGrants', async () => {
    const host = createFakeWorkspaceRuntimeResourceHost()
    const store = createWorkspaceRuntimeResourceMcpGrantStore(host)

    await store.putGrant({ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] })
    await store.putGrant({ workspaceId: 'ws-1', agentTypeId: 'airtable-agent', connectorId: 'airtable', allowedTools: [] })
    // Simulate a malformed row from another writer that skipped this store's
    // own validation (e.g. an older schema, or a direct DB write): the
    // in-memory fake host stores object references, so mutating the row
    // returned by listWorkspaceRuntimeResources mutates the "persisted" row.
    const airtableRow = (await host.listWorkspaceRuntimeResources('ws-1')).find(
      (r) => r.provider === 'airtable',
    ) as { config: unknown }
    airtableRow.config = undefined

    const result = await store.listGrants('ws-1')
    expect(result.grants).toEqual([{ workspaceId: 'ws-1', agentTypeId: 'researcher', connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] }])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: ErrorCode.enum.AGENT_MCP_GRANT_RECORD_MALFORMED, connectorId: 'airtable' }),
    ])
  })
})

describe('createInMemoryMcpGrantStore', () => {
  test('supports put/list/delete and stays workspace-scoped', async () => {
    const store = createInMemoryMcpGrantStore()
    await store.putGrant({ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t1'] })
    await store.putGrant({ workspaceId: 'b', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t2'] })

    expect(await store.listGrants('a')).toEqual({ grants: [{ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t1'] }], diagnostics: [] })
    expect(await store.listGrants('b')).toEqual({ grants: [{ workspaceId: 'b', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['t2'] }], diagnostics: [] })

    await store.deleteGrant({ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion' })
    expect(await store.listGrants('a')).toEqual({ grants: [], diagnostics: [] })
  })

  test('rejects a glob metacharacter in allowedTools at write time', async () => {
    const store = createInMemoryMcpGrantStore()
    await expect(
      store.putGrant({ workspaceId: 'a', agentTypeId: 'x', connectorId: 'notion', allowedTools: ['*'] }),
    ).rejects.toMatchObject({ code: ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NAME_INVALID })
  })
})
