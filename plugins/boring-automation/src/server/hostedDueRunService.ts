import type postgres from "postgres"
import type { FastifyRequest } from "fastify"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import { evaluateAutomationSchedule } from "../shared/schedule"
import type { AutomationRun } from "../shared/types"
import { type DueRunOutcome, type DueRunSummary } from "./dueRunService"
import { ManualRunExecutor } from "./manualRunExecutor"
import { listHostedAutomationCandidates, PostgresAutomationStore, type HostedAutomationActor } from "./postgresStore"
import { AutomationStoreError } from "./store"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"

export interface HostedDueRunServiceOptions {
  sql: postgres.Sql
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  verifyActor: (actor: HostedAutomationActor) => Promise<boolean> | boolean
  clock?: () => Date
}

export interface HostedDueRunResult {
  now: string
  outcomes: DueRunOutcome[]
}

/** Runs due work for every creator while preserving creator-scoped execution. */
export class HostedDueRunService {
  private readonly clock: () => Date

  constructor(private readonly options: HostedDueRunServiceOptions) {
    this.clock = options.clock ?? (() => new Date())
  }

  async runDue(request?: FastifyRequest): Promise<HostedDueRunResult> {
    const now = this.clock()
    const candidates = await listHostedAutomationCandidates(this.options.sql, floorToMinute(now).toISOString())
    const outcomes: DueRunOutcome[] = []

    for (const candidate of candidates) {
      if (!await this.options.verifyActor(candidate.actor)) {
        outcomes.push({
          kind: "failed",
          automationId: candidate.automation.id,
          scheduledFor: now.toISOString(),
          code: BORING_AUTOMATION_ERROR_CODES.OWNER_UNAUTHORIZED,
          message: "automation creator is no longer authorized",
        })
        continue
      }
      const evaluated = evaluateAutomationSchedule({
        automations: [candidate.automation],
        runs: candidate.runs,
        now,
      })
      const decision = evaluated.due[0]
      if (!decision) {
        const skipped = evaluated.decisions[0]
        if (skipped?.kind === "skip") outcomes.push({
          kind: "skipped",
          automationId: candidate.automation.id,
          scheduledFor: skipped.scheduledFor,
          reason: skipped.reason,
          message: skipped.message,
        })
        continue
      }

      const store = new PostgresAutomationStore(this.options.sql, candidate.actor, this.clock)
      const executor = new ManualRunExecutor({
        store,
        dispatcherResolver: this.options.dispatcherResolver,
        actorResolver: () => candidate.actor,
      })
      try {
        const run = await executor.run({
          automationId: candidate.automation.id,
          ...(request ? { request } : {}),
          trigger: "scheduled",
          scheduledFor: decision.scheduledFor,
          actor: candidate.actor,
        })
        outcomes.push({
          kind: "started",
          automationId: candidate.automation.id,
          scheduledFor: decision.scheduledFor,
          run: toSummary(run),
        })
      } catch (error) {
        if (error instanceof AutomationStoreError && (
          error.code === BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE
          || error.code === BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED
        )) {
          outcomes.push({
            kind: "skipped",
            automationId: candidate.automation.id,
            scheduledFor: decision.scheduledFor,
            reason: error.code === BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE ? "active-run" : "duplicate-scheduled-run",
            message: error.message,
          })
          continue
        }
        outcomes.push({
          kind: "failed",
          automationId: candidate.automation.id,
          scheduledFor: decision.scheduledFor,
          code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : BORING_AUTOMATION_ERROR_CODES.RUN_FAILED,
          message: error instanceof Error ? error.message : "Automation run failed",
        })
      }
    }

    outcomes.sort((a, b) => a.automationId.localeCompare(b.automationId))
    return { now: now.toISOString(), outcomes }
  }
}

function floorToMinute(value: Date): Date {
  const minute = new Date(value)
  minute.setUTCSeconds(0, 0)
  return minute
}

function toSummary(run: AutomationRun): DueRunSummary {
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
