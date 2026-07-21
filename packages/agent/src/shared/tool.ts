export type JSONSchema = Record<string, unknown>

export type ToolReadinessRequirement =
  | 'workspace-fs'
  | 'sandbox-exec'
  | 'ui-bridge'
  | 'runtime-dependencies'
  | `runtime:${string}`

export interface AgentTool {
  name: string
  description: string
  /** Optional one-line prompt entry. Pi-built tools should preserve pi's snippet verbatim. */
  promptSnippet?: string
  readinessRequirements?: ToolReadinessRequirement[]
  parameters: JSONSchema
  execute(
    params: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<ToolResult>
}

export interface ToolExecContext {
  abortSignal: AbortSignal
  toolCallId: string
  onUpdate?: (partial: string) => void
  /** Agent chat/session id executing this tool, when known. */
  sessionId?: string
  /** Authenticated human user executing this tool, when known. */
  userId?: string
  userEmail?: string
  userEmailVerified?: boolean
  workspaceId?: string
  requestId?: string
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  details?: unknown
}

/**
 * Host-assigned trust level for a catalog entry.
 *
 * - `trusted`: first-party tools owned/shipped by the platform or app. MAY
 *   execute in-process on the host.
 * - `untrusted`: tools loaded by a user/tenant (custom agent-bundle tools).
 *   Handler code is presumed unsafe and MUST NOT execute in-process; it is
 *   routed to the (currently stubbed) in-sandbox execution seam instead.
 *
 * Trust is declared where the host CONSTRUCTS the catalog (framework code),
 * never self-declared by a tool or its bundle — the same host-declared
 * authority shape that keeps behavior selection out of authored definitions.
 */
export type ToolTrustLevel = 'trusted' | 'untrusted'

/**
 * A host-assigned catalog entry. The trust level lives on this wrapper, not on
 * {@link AgentTool}, so a tool can never self-declare its own trust: the host
 * assigns it when composing the catalog.
 */
export interface CatalogTool {
  readonly trust: ToolTrustLevel
  readonly tool: AgentTool
}

/** First-party default: entries are trusted unless the host declares otherwise. */
export const DEFAULT_TOOL_TRUST_LEVEL: ToolTrustLevel = 'trusted'
