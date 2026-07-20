import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
} from "../shared/types"
import type { ManualRunInput, VerifiedAutomationActor } from "./manualRunExecutor"
import { AutomationStoreError, automationNotFound, type AutomationStore } from "./store"

export const AUTOMATION_TOOL_DEFAULT_LIMIT = 50
export const AUTOMATION_TOOL_MAX_LIMIT = 100
export const AUTOMATION_TOOL_PROMPT_CHARACTER_LIMIT = 16_384
export const AUTOMATION_TOOL_ERROR_CHARACTER_LIMIT = 300

export type AutomationStoreMode = "local" | "hosted"

export interface AutomationSummary {
  id: string
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  thinkingLevel?: Automation["thinkingLevel"]
  createdAt: string
  updatedAt: string
}

export interface SafeAutomationRunSummary {
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
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface BoundedAutomationList<T> {
  items: T[]
  truncated: boolean
}

export interface AutomationWithPrompt {
  automation: AutomationSummary
  prompt: {
    text: string
    characterCount: number
    truncated: boolean
  }
}

export interface AutomationUpdateInput extends AutomationPatch {
  prompt?: string
}

export interface AutomationOperations {
  list(limit?: number): Promise<BoundedAutomationList<AutomationSummary>>
  get(automationId: string): Promise<AutomationWithPrompt>
  create(input: AutomationCreate): Promise<AutomationSummary>
  update(automationId: string, input: AutomationUpdateInput): Promise<AutomationSummary>
  pause(automationId: string): Promise<AutomationSummary>
  resume(automationId: string): Promise<AutomationSummary>
  delete(automationId: string): Promise<{ automationId: string; title: string }>
  run(automationId: string): Promise<SafeAutomationRunSummary>
  listRuns(automationId: string, limit?: number): Promise<BoundedAutomationList<SafeAutomationRunSummary>>
}

export interface AutomationOperationsResolverOptions {
  mode: AutomationStoreMode
  resolveStore(actor: VerifiedAutomationActor): Promise<AutomationStore> | AutomationStore
  resolveExecutor?: (
    actor: VerifiedAutomationActor,
    store: AutomationStore,
  ) => Promise<Pick<{ run(input: ManualRunInput): Promise<AutomationRun> }, "run"> | undefined> | Pick<{ run(input: ManualRunInput): Promise<AutomationRun> }, "run"> | undefined
  localUserId?: string
}

/**
 * Resolve a service bound to one host-derived actor and store. Tool adapters must
 * pass only ToolExecContext values here; model input is never a source of scope.
 */
export async function resolveAutomationOperationsForActor(
  options: AutomationOperationsResolverOptions,
  actorContext: { workspaceId?: string; userId?: string },
): Promise<{ actor: VerifiedAutomationActor; operations: AutomationOperations }> {
  const workspaceId = actorContext.workspaceId?.trim()
  if (!workspaceId) throw contextUnavailable()

  const userId = options.mode === "hosted"
    ? actorContext.userId?.trim()
    : (options.localUserId ?? "local").trim()
  if (!userId) throw contextUnavailable()

  const actor = { workspaceId, userId }
  const store = await options.resolveStore(actor)
  if (!store) throw contextUnavailable()
  const executor = await options.resolveExecutor?.(actor, store)
  return { actor, operations: createAutomationOperations({ store, actor, executor }) }
}

export function createAutomationOperations({
  store,
  actor,
  executor,
}: {
  store: AutomationStore
  actor: VerifiedAutomationActor
  executor?: Pick<{ run(input: ManualRunInput): Promise<AutomationRun> }, "run">
}): AutomationOperations {
  return {
    async list(limit) {
      return bounded(await store.listAutomations(), limit, automationSummary)
    },
    async get(automationId) {
      const automation = await requireAutomation(store, automationId)
      const prompt = await store.getPrompt(automationId)
      return {
        automation: automationSummary(automation),
        prompt: {
          text: prompt.slice(0, AUTOMATION_TOOL_PROMPT_CHARACTER_LIMIT),
          characterCount: prompt.length,
          truncated: prompt.length > AUTOMATION_TOOL_PROMPT_CHARACTER_LIMIT,
        },
      }
    },
    async create(input) {
      return automationSummary(await store.createAutomation(input))
    },
    async update(automationId, input) {
      await requireAutomation(store, automationId)
      const { prompt, ...metadata } = input
      if (prompt === undefined && Object.keys(metadata).length === 0) {
        throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_BODY, "automation update requires at least one field")
      }
      if (prompt !== undefined) await store.updatePrompt(automationId, prompt)
      const automation = Object.keys(metadata).length > 0
        ? await store.updateAutomation(automationId, metadata)
        : await requireAutomation(store, automationId)
      return automationSummary(automation)
    },
    async pause(automationId) {
      await requireAutomation(store, automationId)
      return automationSummary(await store.updateAutomation(automationId, { enabled: false }))
    },
    async resume(automationId) {
      await requireAutomation(store, automationId)
      return automationSummary(await store.updateAutomation(automationId, { enabled: true }))
    },
    async delete(automationId) {
      const automation = await requireAutomation(store, automationId)
      await store.deleteAutomation(automationId)
      return { automationId, title: automation.title }
    },
    async run(automationId) {
      if (!executor) {
        throw new AutomationStoreError(
          BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE,
          "automation run executor is unavailable",
        )
      }
      return safeRunSummary(await executor.run({ automationId, actor }))
    },
    async listRuns(automationId, limit) {
      return bounded(await store.listRuns(automationId), limit, safeRunSummary)
    },
  }
}

function bounded<T, R>(values: T[], requestedLimit: number | undefined, project: (value: T) => R): BoundedAutomationList<R> {
  const limit = normalizeLimit(requestedLimit)
  return { items: values.slice(0, limit).map(project), truncated: values.length > limit }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return AUTOMATION_TOOL_DEFAULT_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > AUTOMATION_TOOL_MAX_LIMIT) {
    throw new AutomationStoreError(
      BORING_AUTOMATION_ERROR_CODES.INVALID_BODY,
      `limit must be an integer between 1 and ${AUTOMATION_TOOL_MAX_LIMIT}`,
    )
  }
  return value
}

async function requireAutomation(store: AutomationStore, automationId: string): Promise<Automation> {
  const automation = await store.getAutomation(automationId)
  if (!automation) throw automationNotFound(automationId)
  return automation
}

function automationSummary(automation: Automation): AutomationSummary {
  return {
    id: automation.id,
    title: automation.title,
    enabled: automation.enabled,
    cron: automation.cron,
    timezone: automation.timezone,
    model: automation.model,
    ...(automation.thinkingLevel ? { thinkingLevel: automation.thinkingLevel } : {}),
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  }
}

function safeRunSummary(run: AutomationRun): SafeAutomationRunSummary {
  return {
    id: run.id,
    automationId: run.automationId,
    sessionId: run.sessionId,
    status: run.status,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    totalTokens: run.totalTokens,
    error: sanitizeRunError(run.error),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function sanitizeRunError(error: string | null): string | null {
  if (!error) return null
  const firstLine = error.split(/\r?\n/, 1)[0]!.trim()
  return firstLine.slice(0, AUTOMATION_TOOL_ERROR_CHARACTER_LIMIT)
}

function contextUnavailable(): AutomationStoreError {
  return new AutomationStoreError(
    BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
    "automation tool context is unavailable",
  )
}
