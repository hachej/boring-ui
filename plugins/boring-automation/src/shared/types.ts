export type AutomationRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"
export type AutomationRunTrigger = "manual" | "scheduled"

export interface Automation {
  id: string
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
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
  prompt?: string
}

export interface AutomationPatch {
  title?: string
  enabled?: boolean
  cron?: string
  timezone?: string
  model?: string
}

export interface AutomationRun {
  id: string
  automationId: string
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
  trigger: AutomationRunTrigger
  scheduledFor?: string | null
  promptSnapshot: string
  modelSnapshot: string
  createdAt?: string
}

export interface AutomationRunLifecyclePatch {
  sessionId?: string | null
  status?: AutomationRunStatus
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  error?: string | null
}
