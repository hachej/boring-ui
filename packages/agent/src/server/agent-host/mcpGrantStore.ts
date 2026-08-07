import type { McpGrant } from './mcpGrants'

/** The kind tag used when per-agent MCP grants are persisted as workspace runtime resources. */
export const MCP_GRANT_RESOURCE_KIND = 'mcp-grant'

export interface McpGrantStore {
  listGrants(workspaceId: string): Promise<readonly McpGrant[]>
  putGrant(grant: McpGrant): Promise<void>
  deleteGrant(input: { readonly workspaceId: string; readonly agentTypeId: string; readonly connectorId: string }): Promise<void>
}

/**
 * The minimal, structural shape of `@hachej/boring-core`'s `WorkspaceStore`
 * runtime-resource methods that a grant store needs. `packages/agent` does
 * not depend on `@hachej/boring-core`, so this is a duck-typed subset rather
 * than an imported type — any real `WorkspaceStore` instance already
 * satisfies it. Grants are persisted through this existing per-workspace
 * structured-resource store (kind/purpose/provider keyed, per workspace)
 * rather than a new store: `kind: 'mcp-grant'`, `purpose: agentTypeId`,
 * `provider: connectorId`, `config: { allowedTools }`.
 */
export interface WorkspaceRuntimeResourceHost {
  listWorkspaceRuntimeResources(workspaceId?: string): Promise<readonly WorkspaceRuntimeResourceLike[]>
  putWorkspaceRuntimeResource(
    workspaceId: string,
    resource: WorkspaceRuntimeResourceInputLike,
  ): Promise<WorkspaceRuntimeResourceLike>
  deleteWorkspaceRuntimeResource(
    workspaceId: string,
    selector: { readonly kind: string; readonly purpose: string; readonly provider: string },
  ): Promise<void>
}

export interface WorkspaceRuntimeResourceLike {
  readonly workspaceId: string
  readonly kind: string
  readonly purpose: string
  readonly provider: string
  readonly state: string
  readonly config: Record<string, unknown>
}

export interface WorkspaceRuntimeResourceInputLike {
  readonly kind: string
  readonly purpose: string
  readonly provider: string
  readonly handleKind: string
  readonly state: string
  readonly persistenceMode: string
  readonly config?: Record<string, unknown>
}

function isMcpGrantResource(resource: WorkspaceRuntimeResourceLike): boolean {
  return resource.kind === MCP_GRANT_RESOURCE_KIND && resource.state !== 'deleted'
}

function toGrant(resource: WorkspaceRuntimeResourceLike): McpGrant {
  const allowedTools = Array.isArray(resource.config.allowedTools)
    ? resource.config.allowedTools.filter((tool): tool is string => typeof tool === 'string')
    : []
  return {
    workspaceId: resource.workspaceId,
    agentTypeId: resource.purpose,
    connectorId: resource.provider,
    allowedTools,
  }
}

/**
 * Adapts a workspace's existing runtime-resource store (`WorkspaceStore` in
 * `@hachej/boring-core`, structurally satisfied here) into the per-agent
 * MCP grant seam. This is the canonical persistence home per gh-1087: no new
 * store, no new table — grants live alongside every other structured
 * per-workspace resource.
 */
export function createWorkspaceRuntimeResourceMcpGrantStore(host: WorkspaceRuntimeResourceHost): McpGrantStore {
  return {
    async listGrants(workspaceId) {
      const resources = await host.listWorkspaceRuntimeResources(workspaceId)
      return resources.filter(isMcpGrantResource).map(toGrant)
    },
    async putGrant(grant) {
      await host.putWorkspaceRuntimeResource(grant.workspaceId, {
        kind: MCP_GRANT_RESOURCE_KIND,
        purpose: grant.agentTypeId,
        provider: grant.connectorId,
        handleKind: 'mcp-grant',
        state: 'active',
        persistenceMode: 'durable',
        config: { allowedTools: [...grant.allowedTools] },
      })
    },
    async deleteGrant({ workspaceId, agentTypeId, connectorId }) {
      await host.deleteWorkspaceRuntimeResource(workspaceId, {
        kind: MCP_GRANT_RESOURCE_KIND,
        purpose: agentTypeId,
        provider: connectorId,
      })
    },
  }
}

/** In-memory reference implementation, useful for tests and for hosts with no persistent workspace store wired yet. Default-deny still holds: no grants means no connectors. */
export function createInMemoryMcpGrantStore(seed: readonly McpGrant[] = []): McpGrantStore {
  const grants = new Map<string, McpGrant>()
  const key = (g: Pick<McpGrant, 'workspaceId' | 'agentTypeId' | 'connectorId'>) =>
    `${g.workspaceId}:${g.agentTypeId}:${g.connectorId}`
  for (const grant of seed) grants.set(key(grant), grant)
  return {
    async listGrants(workspaceId) {
      return Array.from(grants.values()).filter((g) => g.workspaceId === workspaceId)
    },
    async putGrant(grant) {
      grants.set(key(grant), grant)
    },
    async deleteGrant(input) {
      grants.delete(key(input))
    },
  }
}
