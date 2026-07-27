export type AutomationRunStatus = "queued" | "dispatching" | "running" | "succeeded" | "failed" | "cancelled" | "outcome-unknown"
export type AutomationRunTrigger = "manual" | "scheduled"

export interface Automation {
  id: string
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  thinkingLevel?: "off" | "low" | "medium" | "high"
  promptRef: string
  createdAt: string
  updatedAt: string
}

export interface AutomationCreate {
  title: string
  enabled?: boolean
  cron: string
  timezone: string
  model: string
  thinkingLevel?: "off" | "low" | "medium" | "high"
  prompt?: string
}

export interface AutomationPatch {
  title?: string
  enabled?: boolean
  cron?: string
  timezone?: string
  model?: string
  thinkingLevel?: "off" | "low" | "medium" | "high"
}

export interface AutomationDispatchReceipt {
  ref: { agentTypeId: string; sessionId: string }
  accepted: true
  cursor: number
  disposition: "prompt" | "followup"
  clientNonce: string
  duplicate?: boolean
  clientSeq?: number
}

export interface AutomationRun {
  id: string
  automationId: string
  /** Durable invocation-to-run receipt key, persisted atomically with the run. */
  invocationId?: string
  /** Gateway idempotency key; always equal to id. */
  dispatchRequestId?: string
  dispatchReceipt?: AutomationDispatchReceipt | null
  sessionId: string | null
  status: AutomationRunStatus
  trigger: AutomationRunTrigger
  scheduledFor: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  promptSnapshot: string
  modelSnapshot: string
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationRunBegin {
  automationId: string
  invocationId?: string
  trigger: AutomationRunTrigger
  scheduledFor?: string | null
  promptSnapshot: string
  modelSnapshot: string
  createdAt?: string
}

export interface AutomationRunLifecyclePatch {
  sessionId?: string | null
  dispatchReceipt?: AutomationDispatchReceipt | null
  status?: AutomationRunStatus
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  error?: string | null
}
