export type JSONSchema = Record<string, unknown>

export type ToolReadinessRequirement =
  | 'workspace-fs'
  | 'sandbox-exec'
  | 'ui-bridge'
  | 'runtime-dependencies'
  | `runtime:${string}`

export interface ToolStructuredDetail {
  entryId: string
  toolCallId?: string
  toolName?: string
  kind: string
  detail: unknown
}

export interface AgentTool {
  name: string
  description: string
  /** Optional one-line prompt entry. Pi-built tools should preserve pi's snippet verbatim. */
  promptSnippet?: string
  readinessRequirements?: ToolReadinessRequirement[]
  executionMode?: 'sequential' | 'parallel'
  /** Structured result detail kinds this tool may inspect from the current run. */
  currentRunDetailKinds?: readonly string[]
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
  /** Immutable, opt-in structured details from successful tool results in this run. */
  currentRunStructuredDetails?: readonly ToolStructuredDetail[]
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  details?: unknown
}
