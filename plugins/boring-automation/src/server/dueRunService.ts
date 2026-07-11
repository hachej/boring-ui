import type { FastifyRequest } from "fastify"
import { BORING_AUTOMATION_ERROR_CODES, evaluateAutomationSchedule, type AutomationScheduleDecision } from "../shared"
import type { AutomationRun } from "../shared/types"
import { AutomationStoreError, type AutomationStore } from "./store"
import type { ManualRunExecutor } from "./manualRunExecutor"

export type DueRunSummary = Pick<AutomationRun,
  | "id"
  | "automationId"
  | "sessionId"
  | "status"
  | "trigger"
  | "scheduledFor"
  | "startedAt"
  | "completedAt"
  | "durationMs"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
>

export type DueRunOutcome =
  | { kind: "started"; automationId: string; scheduledFor: string; run: DueRunSummary }
  | { kind: "skipped"; automationId: string; scheduledFor: string | null; reason: string; message: string }
  | { kind: "failed"; automationId: string; scheduledFor: string; code: string; message: string }

export interface DueRunResult {
  now: string
  decisions: AutomationScheduleDecision[]
  outcomes: DueRunOutcome[]
}

export interface DueRunServiceOptions {
  store: AutomationStore
  executor: Pick<ManualRunExecutor, "run">
  clock?: () => Date
}

/** Deterministic, externally invoked due-run orchestration. It owns no timer. */
export class DueRunService {
  private readonly clock: () => Date

  constructor(private readonly options: DueRunServiceOptions) {
    this.clock = options.clock ?? (() => new Date())
  }

  async runDue(request: FastifyRequest): Promise<DueRunResult> {
    const now = this.clock()
    const automations = await this.options.store.listAutomations()
    const runs = (await Promise.all(automations.map(async (automation) => {
      await this.options.store.reconcileOrphanedRuns(automation.id)
      return await this.options.store.listRuns(automation.id)
    }))).flat()
    const evaluated = evaluateAutomationSchedule({ automations, runs, now })
    const outcomes: DueRunOutcome[] = evaluated.decisions
      .filter((decision) => decision.kind === "skip")
      .map((decision) => ({
        kind: "skipped",
        automationId: decision.automationId,
        scheduledFor: decision.scheduledFor,
        reason: decision.reason,
        message: decision.message,
      }))

    for (const decision of evaluated.due) {
      try {
        const run = await this.options.executor.run({
          automationId: decision.automationId,
          request,
          trigger: "scheduled",
          scheduledFor: decision.scheduledFor,
        })
        outcomes.push({ kind: "started", automationId: decision.automationId, scheduledFor: decision.scheduledFor, run: toDueRunSummary(run) })
      } catch (error) {
        if (error instanceof AutomationStoreError && (
          error.code === BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE
          || error.code === BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED
        )) {
          outcomes.push({
            kind: "skipped",
            automationId: decision.automationId,
            scheduledFor: decision.scheduledFor,
            reason: error.code === BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE ? "active-run" : "duplicate-scheduled-run",
            message: error.message,
          })
          continue
        }
        outcomes.push({
          kind: "failed",
          automationId: decision.automationId,
          scheduledFor: decision.scheduledFor,
          code: error instanceof AutomationStoreError ? error.code : BORING_AUTOMATION_ERROR_CODES.RUN_FAILED,
          message: safeErrorMessage(error),
        })
      }
    }

    outcomes.sort((a, b) => a.automationId.localeCompare(b.automationId) || (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""))
    return { now: now.toISOString(), decisions: evaluated.decisions, outcomes }
  }
}

function toDueRunSummary(run: AutomationRun): DueRunSummary {
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
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Automation run failed"
  const firstLine = message.split(/\r?\n/u)[0]?.trim() || "Automation run failed"
  return firstLine.length > 300 ? `${firstLine.slice(0, 297)}...` : firstLine
}
