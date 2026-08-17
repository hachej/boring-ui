export type AutomationRunStatus = "queued" | "dispatching" | "running" | "succeeded" | "failed" | "cancelled" | "outcome-unknown"
export type AutomationRunTrigger = "manual" | "scheduled" | "dispatch"
export type AutomationSessionMode = "new" | "continue"

export interface AutomationRunChangedEvent {
  v: 1
  eventId: string
  workspaceId: string
  userId: string
  automationId: string
  runId: string
  status: AutomationRunStatus
  updatedAt: string
}

export interface Automation {
  id: string
  title: string
  enabled: boolean
  cron: string | null
  timezone: string
  model: string
  agentTypeId?: string
  thinkingLevel?: "off" | "low" | "medium" | "high"
  sessionMode?: AutomationSessionMode
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
  agentTypeId?: string
  thinkingLevel?: "off" | "low" | "medium" | "high"
  sessionMode?: AutomationSessionMode
  prompt?: string
}

export interface AutomationPatch {
  title?: string
  enabled?: boolean
  cron?: string
  timezone?: string
  model?: string
  agentTypeId?: string
  thinkingLevel?: "off" | "low" | "medium" | "high"
  sessionMode?: AutomationSessionMode
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
  /** Informational execution note; unlike error, this does not imply failure. */
  note?: string | null
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
  note?: string | null
}
