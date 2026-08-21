import { randomUUID } from "node:crypto"
import type { AgentSendIfIdleReceipt, AgentSessionRef, AgentSessionSummary, StopReceipt } from "@hachej/boring-agent/shared"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
} from "../shared/types"
import type { DispatchRunInput, VerifiedAutomationActor } from "./dispatchRunExecutor"
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
  cron: string | null
  timezone: string
  model: string
  agentTypeId?: string
  thinkingLevel?: Automation["thinkingLevel"]
  runDurationCapMs?: number | null
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


export interface DispatchRunFleetSummary extends SafeAutomationRunSummary {
  automationTitle: string
  agentTypeId: string
  sessionTitle: string | null
  sessionStatus: AgentSessionSummary["status"] | "gone" | null
  sessionAgeMs: number | null
}

export interface AutomationSessionController {
  list(agentTypeId: string): Promise<readonly AgentSessionSummary[]>
  nudge(agentTypeId: string, sessionId: string, message: string, requestId: string): Promise<AgentSendIfIdleReceipt>
  cancel(agentTypeId: string, sessionId: string, requestId: string): Promise<StopReceipt>
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
  listDispatchRuns?(limit?: number): Promise<BoundedAutomationList<DispatchRunFleetSummary>>
  nudge?(ref: AgentSessionRef, message: string): Promise<
    | { agentTypeId: string; sessionId: string; accepted: true }
    | { agentTypeId: string; sessionId: string; skipped: "session-busy" }
  >
  cancel?(ref: AgentSessionRef): Promise<
    | { agentTypeId: string; sessionId: string; cancelled: true }
    | { agentTypeId: string; sessionId: string; skipped: "session-not-running" }
  >
  get(automationId: string): Promise<AutomationWithPrompt>
  create(input: AutomationCreate): Promise<AutomationSummary>
  update(automationId: string, input: AutomationUpdateInput): Promise<AutomationSummary>
  pause(automationId: string): Promise<AutomationSummary>
  resume(automationId: string): Promise<AutomationSummary>
  delete(automationId: string): Promise<{ automationId: string; title: string }>
  run(automationId: string): Promise<SafeAutomationRunSummary>
  listRuns(automationId: string, limit?: number): Promise<BoundedAutomationList<SafeAutomationRunSummary>>
}

export interface DispatchRunStarter {
  start(input: DispatchRunInput): Promise<AutomationRun>
}

export interface AutomationOperationsResolverOptions {
  mode: AutomationStoreMode
  resolveStore(actor: VerifiedAutomationActor): Promise<AutomationStore> | AutomationStore
  resolveExecutor?: (
    actor: VerifiedAutomationActor,
    store: AutomationStore,
  ) => Promise<DispatchRunStarter | undefined> | DispatchRunStarter | undefined
  localUserId?: string
  defaultAgentTypeId?: string
  sessionController?: AutomationSessionController
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
  return { actor, operations: createAutomationOperations({
    store, actor, executor,
    defaultAgentTypeId: options.defaultAgentTypeId,
    sessionController: options.sessionController,
  }) }
}

export function createAutomationOperations({
  store,
  actor,
  executor,
  defaultAgentTypeId = "default",
  sessionController,
}: {
  store: AutomationStore
  actor: VerifiedAutomationActor
  defaultAgentTypeId?: string
  sessionController?: AutomationSessionController
  executor?: DispatchRunStarter
}): AutomationOperations {
  return {
    async list(limit) {
      return bounded(await store.listAutomations(), limit, automationSummary)
    },
    async listDispatchRuns(limit) {
      const rowLimit = normalizeLimit(limit)
      const automations = await store.listAutomations()
      const automationById = new Map(automations.map((automation) => [automation.id, automation]))
      const recentRuns = await store.listRecentRuns(rowLimit + 1)
      const agentTypeIds = [...new Set(recentRuns.flatMap((run) => {
        const automation = automationById.get(run.automationId)
        return automation ? [sessionRefForRun(run, automation, defaultAgentTypeId).agentTypeId] : []
      }))]
      const sessionsByAgent = new Map(await Promise.all(agentTypeIds.map(async (agentTypeId) => [
        agentTypeId,
        sessionController ? await sessionController.list(agentTypeId) : [],
      ] as const)))
      const rows: DispatchRunFleetSummary[] = []
      for (const run of recentRuns) {
        const automation = automationById.get(run.automationId)
        if (!automation) continue
        const ref = sessionRefForRun(run, automation, defaultAgentTypeId)
        const agentTypeId = ref.agentTypeId
        const session = ref.sessionId
          ? sessionsByAgent.get(agentTypeId)?.find((candidate) => candidate.ref.sessionId === ref.sessionId)
          : undefined
        rows.push({
          ...safeRunSummary(run),
          automationTitle: automation.title,
          agentTypeId,
          sessionTitle: session?.title ?? null,
          sessionStatus: ref.sessionId ? session?.status ?? "gone" : null,
          sessionAgeMs: session ? Math.max(0, Date.now() - session.updatedAt) : null,
        })
      }
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return bounded(rows, rowLimit, (row) => row)
    },
    async nudge(ref, message) {
      if (!sessionController) throw contextUnavailable()
      await requireSessionTarget(store, ref)
      const receipt = await sessionController.nudge(ref.agentTypeId, ref.sessionId, message, `nudge:${randomUUID()}`)
      return receipt.status === "not-idle"
        ? { ...ref, skipped: "session-busy" }
        : { ...ref, accepted: true }
    },
    async cancel(ref) {
      if (!sessionController) throw contextUnavailable()
      await requireSessionTarget(store, ref)
      const receipt = await sessionController.cancel(ref.agentTypeId, ref.sessionId, `cancel:${randomUUID()}`)
      return receipt.stopped
        ? { ...ref, cancelled: true }
        : { ...ref, skipped: "session-not-running" }
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
      const input = { automationId, actor, trigger: "manual" as const }
      return safeRunSummary(await executor.start(input))
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
    ...(automation.agentTypeId ? { agentTypeId: automation.agentTypeId } : {}),
    ...(automation.thinkingLevel ? { thinkingLevel: automation.thinkingLevel } : {}),
    ...(automation.runDurationCapMs === undefined ? {} : { runDurationCapMs: automation.runDurationCapMs }),
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

function sessionRefForRun(run: AutomationRun, automation: Automation, defaultAgentTypeId: string): AgentSessionRef {
  return run.dispatchReceipt?.ref ?? {
    agentTypeId: automation.agentTypeId ?? defaultAgentTypeId,
    sessionId: run.sessionId ?? "",
  }
}

async function requireSessionTarget(store: AutomationStore, ref: AgentSessionRef): Promise<void> {
  if (await store.findRunBySessionRef(ref)) return
  throw new AutomationStoreError(
    BORING_AUTOMATION_ERROR_CODES.SESSION_NOT_FOUND,
    `session ${ref.agentTypeId}/${ref.sessionId} is not owned by an automation run`,
  )
}
