import { ErrorCode } from '../../shared/error-codes'
import { assertValidGrantToolNames, type McpGrant, type McpGrantDiagnostic } from './mcpGrants'

/** The kind tag used when per-agent MCP grants are persisted as workspace runtime resources. */
export const MCP_GRANT_RESOURCE_KIND = 'mcp-grant'

/** A grant listing that skipped one or more malformed rows; `diagnostics` carries a stable-coded entry per skipped row instead of throwing. */
export interface ListedMcpGrants {
  readonly grants: readonly McpGrant[]
  readonly diagnostics: readonly McpGrantDiagnostic[]
}

export interface McpGrantStore {
  listGrants(workspaceId: string): Promise<ListedMcpGrants>
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

/**
 * `WorkspaceRuntimeResourceLike.config` is typed as required, but the
 * underlying store's `config` field is optional/nullable in practice (older
 * rows, other writers, or a bad migration can leave it `null`/`undefined`).
 * A single such row must not crash `listGrants` for the whole workspace —
 * that would be a self-DoS on the authority path (every Agent in the
 * workspace loses every grant because of one bad row). Skip malformed rows
 * with a stable diagnostic instead of throwing.
 */
function toGrant(resource: WorkspaceRuntimeResourceLike): { grant: McpGrant } | { diagnostic: McpGrantDiagnostic } {
  const config = resource.config as Record<string, unknown> | null | undefined
  if (!config || typeof config !== 'object' || !Array.isArray(config.allowedTools)) {
    return {
      diagnostic: {
        code: ErrorCode.enum.AGENT_MCP_GRANT_RECORD_MALFORMED,
        connectorId: resource.provider,
        message: `MCP grant record for connector '${resource.provider}' (agentTypeId '${resource.purpose}') has a missing or malformed config and was skipped.`,
      },
    }
  }
  const allowedTools = config.allowedTools.filter((tool): tool is string => typeof tool === 'string')
  return {
    grant: {
      workspaceId: resource.workspaceId,
      agentTypeId: resource.purpose,
      connectorId: resource.provider,
      allowedTools,
    },
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
      const grants: McpGrant[] = []
      const diagnostics: McpGrantDiagnostic[] = []
      for (const outcome of resources.filter(isMcpGrantResource).map(toGrant)) {
        if ('grant' in outcome) grants.push(outcome.grant)
        else diagnostics.push(outcome.diagnostic)
      }
      return { grants, diagnostics }
    },
    async putGrant(grant) {
      assertValidGrantToolNames(grant.allowedTools)
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
      return { grants: Array.from(grants.values()).filter((g) => g.workspaceId === workspaceId), diagnostics: [] }
    },
    async putGrant(grant) {
      assertValidGrantToolNames(grant.allowedTools)
      grants.set(key(grant), grant)
    },
    async deleteGrant(input) {
      grants.delete(key(input))
    },
  }
}
