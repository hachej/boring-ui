export type AutomationRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"
export type AutomationRunTrigger = "manual" | "scheduled"

export interface Automation {
  id: string
  workspaceId?: string
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  promptRef?: string
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
  workspaceId?: string
  sessionId?: string
  status: AutomationRunStatus
  trigger: AutomationRunTrigger
  scheduledFor?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  promptSnapshot: string
  modelSnapshot: string
  cronSnapshot: string
  timezoneSnapshot: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface AutomationRunCreate {
  automationId: string
  sessionId?: string
  status?: AutomationRunStatus
  trigger: AutomationRunTrigger
  scheduledFor?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  promptSnapshot: string
  modelSnapshot: string
  cronSnapshot: string
  timezoneSnapshot: string
  error?: string
}

export interface AutomationRunPatch {
  sessionId?: string | null
  status?: AutomationRunStatus
  scheduledFor?: string | null
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  error?: string | null
}

export interface AutomationStoreCtx {
  workspaceId?: string
}

export interface AutomationStore {
  listAutomations(ctx: AutomationStoreCtx): Promise<Automation[]>
  getAutomation(ctx: AutomationStoreCtx, id: string): Promise<Automation | null>
  createAutomation(ctx: AutomationStoreCtx, input: AutomationCreate): Promise<Automation>
  updateAutomation(ctx: AutomationStoreCtx, id: string, patch: AutomationPatch): Promise<Automation>
  deleteAutomation(ctx: AutomationStoreCtx, id: string): Promise<void>

  getPrompt(ctx: AutomationStoreCtx, automationId: string): Promise<string>
  updatePrompt(ctx: AutomationStoreCtx, automationId: string, body: string): Promise<void>

  createRun(ctx: AutomationStoreCtx, input: AutomationRunCreate): Promise<AutomationRun>
  updateRun(ctx: AutomationStoreCtx, runId: string, patch: AutomationRunPatch): Promise<AutomationRun>
  listRuns(ctx: AutomationStoreCtx, automationId: string): Promise<AutomationRun[]>
  findRunningRun(ctx: AutomationStoreCtx, automationId: string): Promise<AutomationRun | null>
}
