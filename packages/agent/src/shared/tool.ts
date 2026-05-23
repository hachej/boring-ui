export type JSONSchema = Record<string, unknown>

export type ToolReadinessRequirement = 'workspace-fs' | 'sandbox-exec' | 'ui-bridge'

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
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  details?: unknown
}
