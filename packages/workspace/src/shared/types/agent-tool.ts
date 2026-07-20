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

export interface ToolExecContext {
  abortSignal: AbortSignal
  toolCallId: string
  onUpdate?: (partial: string) => void
  /** Agent chat/session id executing this tool, when known. */
  sessionId?: string
  /** Server-owned authenticated run context. Never sourced from tool parameters. */
  userId?: string
  userEmail?: string
  userEmailVerified?: boolean
  workspaceId?: string
  requestId?: string
  /** Immutable, opt-in structured details from successful tool results in this run. */
  currentRunStructuredDetails?: readonly ToolStructuredDetail[]
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
  details?: unknown
}

/**
 * Structural tool contract accepted from workspace plugins and UI tool
 * factories. Kept agent-runtime-neutral so only the app integration layer
 * needs to import @hachej/boring-agent.
 */
export interface AgentTool {
  name: string
  description: string
  promptSnippet?: string
  readinessRequirements?: ToolReadinessRequirement[]
  executionMode?: "sequential" | "parallel"
  /** Structured result detail kinds this tool may inspect from the current run. */
  currentRunDetailKinds?: readonly string[]
  parameters: JSONSchema
  execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult>
}
