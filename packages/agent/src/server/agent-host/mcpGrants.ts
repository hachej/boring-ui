import { ErrorCode } from '../../shared/error-codes'

/**
 * Per-agent MCP grant: the only thing that lets an Agent's declared
 * `mcpServerRefs` resolve into anything. Resolution is default-deny — a
 * connectorId with no matching grant for the exact `(workspaceId,
 * agentTypeId)` pair yields nothing, ever, regardless of what other Agents
 * in the same workspace are granted.
 */
/**
 * Thrown by {@link assertValidGrantToolNames} when a grant's `allowedTools`
 * contains a glob metacharacter. `allowedTools` here is meant to be an
 * exact-match allowlist of tool names; `plugins/boring-mcp`'s
 * `deniedTools`/`wildcardMatch` glob-interprets `"*"` (and other glob
 * metacharacters) as "match everything". Storing `["*"]` here and later
 * interpreting it as a glob at the consumption seam would silently flip an
 * intended single-item allowlist into "every tool is allowed" — the exact
 * opposite of the grant model's default-deny intent. Reject it at
 * grant-write time instead so this footgun can never be stored.
 */
export class McpGrantToolNameInvalidError extends Error {
  readonly code = ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NAME_INVALID
  readonly tool: string

  constructor(tool: string) {
    super(`MCP grant tool name '${tool}' contains a glob metacharacter, which is not a valid exact tool name for allowedTools.`)
    this.name = 'McpGrantToolNameInvalidError'
    this.tool = tool
  }
}

const GLOB_METACHARACTER_PATTERN = /[*?[\]]/

/** Throws {@link McpGrantToolNameInvalidError} if any tool name in `allowedTools` contains a glob metacharacter (`*`, `?`, `[`, `]`). Call before persisting a grant. */
export function assertValidGrantToolNames(allowedTools: readonly string[]): void {
  for (const tool of allowedTools) {
    if (GLOB_METACHARACTER_PATTERN.test(tool)) throw new McpGrantToolNameInvalidError(tool)
  }
}

export interface McpGrant {
  readonly workspaceId: string
  readonly agentTypeId: string
  readonly connectorId: string
  /** Empty array means the connector is granted but no tools are allowed. */
  readonly allowedTools: readonly string[]
}

/**
 * Typed seam for validating a grant's `allowedTools` against a connector's
 * real tool surface (e.g. the static `DEFAULT_MCP_PROVIDER_TEMPLATES` catalog
 * in `plugins/boring-mcp`). Deliberately decoupled from any specific
 * provider/catalog implementation and from credential resolution (BYOK,
 * out of scope here) — a caller wires its own catalog in.
 */
export interface McpConnectorCatalog {
  /** Returns the connector's known tool names, or `undefined` if the connector itself is unknown to the catalog. */
  getConnectorTools(connectorId: string): readonly string[] | undefined
}

export type McpGrantDiagnosticCode =
  | typeof ErrorCode.enum.AGENT_MCP_GRANT_REF_UNGRANTED
  | typeof ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NOT_ALLOWED
  | typeof ErrorCode.enum.AGENT_MCP_GRANT_RECORD_MALFORMED
  | typeof ErrorCode.enum.AGENT_MCP_GRANT_CONNECTOR_UNKNOWN
  | typeof ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NAME_INVALID

export interface McpGrantDiagnostic {
  readonly code: McpGrantDiagnosticCode
  readonly connectorId: string
  readonly message: string
  readonly tool?: string
}

export interface ResolvedMcpConnectorGrant {
  readonly connectorId: string
  readonly allowedTools: readonly string[]
}

export interface ResolvedAgentMcpGrants {
  readonly connectors: readonly ResolvedMcpConnectorGrant[]
  readonly diagnostics: readonly McpGrantDiagnostic[]
}

export interface ResolveAgentMcpGrantsInput {
  readonly workspaceId: string
  readonly agentTypeId: string
  /** The Agent definition's declared `mcpServerRefs`, treated as connector ids. */
  readonly mcpServerRefs: readonly string[]
  readonly grants: readonly McpGrant[]
  readonly catalog?: McpConnectorCatalog
}

/**
 * Resolves an Agent's declared `mcpServerRefs` into the connectors/tools it
 * is actually allowed to use, through per-agent grants only — never a
 * parallel authorization path.
 *
 * - Default-deny: no grants for `(workspaceId, agentTypeId)` -> no connectors.
 * - Every declared ref without a matching grant is dropped with a stable
 *   diagnostic; it is never silently ignored.
 * - A granted connector does not imply all of its tools: `allowedTools` is
 *   the tool-level filter, and (when a catalog is supplied) is further
 *   intersected with the connector's known tool surface.
 * - Isolation: resolution only ever consults grants whose `agentTypeId`
 *   exactly matches the requested Agent, so two Agents in one workspace
 *   never see each other's connectors.
 */
export function resolveAgentMcpGrants(input: ResolveAgentMcpGrantsInput): ResolvedAgentMcpGrants {
  const { workspaceId, agentTypeId, mcpServerRefs, grants, catalog } = input
  const connectors: ResolvedMcpConnectorGrant[] = []
  const diagnostics: McpGrantDiagnostic[] = []

  const grantsByConnector = new Map<string, McpGrant>()
  for (const grant of grants) {
    if (grant.workspaceId !== workspaceId || grant.agentTypeId !== agentTypeId) continue
    grantsByConnector.set(grant.connectorId, grant)
  }

  for (const ref of new Set(mcpServerRefs)) {
    const grant = grantsByConnector.get(ref)
    if (!grant) {
      diagnostics.push({
        code: ErrorCode.enum.AGENT_MCP_GRANT_REF_UNGRANTED,
        connectorId: ref,
        message: `mcpServerRefs entry '${ref}' has no matching MCP grant for this Agent in this workspace; it was dropped.`,
      })
      continue
    }

    const catalogTools = catalog?.getConnectorTools(grant.connectorId)
    if (catalog && !catalogTools) {
      // The connector is unknown to the catalog. This must DENY, not skip
      // filtering: silently admitting every grant.allowedTools entry here
      // would mean an unrecognized/misconfigured connectorId gets a free
      // pass to every tool a grant happens to list, which is the opposite
      // of default-deny.
      diagnostics.push({
        code: ErrorCode.enum.AGENT_MCP_GRANT_CONNECTOR_UNKNOWN,
        connectorId: grant.connectorId,
        message: `Grant for connector '${grant.connectorId}' references a connector unknown to the supplied catalog; the connector was dropped.`,
      })
      continue
    }

    const allowedTools: string[] = []
    // Defend against a grant sourced from a third-party/legacy store where
    // `allowedTools` may be missing or non-array despite the interface
    // declaring it required — iterating it directly would throw "not
    // iterable" and take down resolution for every other ref.
    for (const tool of Array.isArray(grant.allowedTools) ? grant.allowedTools : []) {
      if (catalogTools && !catalogTools.includes(tool)) {
        diagnostics.push({
          code: ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NOT_ALLOWED,
          connectorId: grant.connectorId,
          tool,
          message: `Grant for connector '${grant.connectorId}' allows tool '${tool}', which is not part of the connector's known tool catalog; it was dropped.`,
        })
        continue
      }
      allowedTools.push(tool)
    }

    connectors.push({ connectorId: grant.connectorId, allowedTools })
  }

  return { connectors, diagnostics }
}
