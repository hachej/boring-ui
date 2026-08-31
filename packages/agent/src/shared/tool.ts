export type JSONSchema = Record<string, unknown>

export type AgentToolEffectClass = 'observe' | 'propose' | 'mutate' | 'external-effect' | 'pause'

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
  /** Undeclared tools are treated as external effects and fail closed. */
  effect?: AgentToolEffectClass
  /** Allows restart reconciliation to return an interrupted child effect to admitted. */
  idempotent?: boolean
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
