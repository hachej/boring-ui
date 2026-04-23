export type JSONSchema = Record<string, unknown>

export interface AgentTool {
  name: string
  description: string
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
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  details?: unknown
}
