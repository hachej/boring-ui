export type JSONSchema = Record<string, unknown>

export type ToolReadinessRequirement =
  | 'workspace-fs'
  | 'sandbox-exec'
  | 'ui-bridge'
  | 'runtime-dependencies'
  | `runtime:${string}`

export interface RemoteCapabilityDescriptor {
  readonly kind: string
  readonly workspaceId: string
  readonly address: string
  readonly version: number
  readonly sha: string
  readonly toolName: string
  readonly description: string
  readonly inputSchema: JSONSchema
}

export interface AgentTool {
  name: string
  /** Required on tools admitted through the dynamic remote-capability seam. */
  executionKind?: 'remote'
  provenance?: Readonly<{ kind: string; address: string; version: number; sha: string }>
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
