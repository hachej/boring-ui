import { randomUUID } from "node:crypto"
import type postgres from "postgres"
import type { FastifyRequest } from "fastify"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import { evaluateAutomationSchedule } from "../shared/schedule"
import type { AutomationRun } from "../shared/types"
import { type DueRunOutcome, type DueRunSummary } from "./dueRunService"
import { ManualRunExecutor } from "./manualRunExecutor"
import { createLeaseBoundHostedAutomationStore } from "./hostedStore"
import { listHostedAutomationCandidates, PostgresAutomationStore, reconcileStaleHostedAutomationRuns, type HostedAutomationActor } from "./postgresStore"
import type { AutomationRunEventPublisher } from "./runEventBus"
import { AutomationStoreError } from "./store"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"

const HOSTED_RUN_STALE_AFTER_MS = 5 * 60_000

export interface HostedDueRunServiceOptions {
  agentTypeId: string
  availableAgentTypeIds?: readonly string[]
  sql: postgres.Sql
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  verifyActor: (actor: HostedAutomationActor) => Promise<boolean> | boolean
  eventPublisher?: AutomationRunEventPublisher
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
    const reconciled = await reconcileStaleHostedAutomationRuns(this.options.sql, HOSTED_RUN_STALE_AFTER_MS)
    for (const item of reconciled) {
      try {
        await this.options.eventPublisher?.publish({
          v: 1,
          eventId: randomUUID(),
          workspaceId: item.actor.workspaceId,
          userId: item.actor.userId,
          automationId: item.run.automationId,
          runId: item.run.id,
          status: item.run.status,
          updatedAt: item.run.updatedAt,
        })
      } catch {
        // Reconciliation is durable; UI invalidation remains best effort.
      }
    }
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

      try {
        const store = createLeaseBoundHostedAutomationStore(
          this.options.sql,
          candidate.actor,
          this.options.dispatcherResolver,
          this.options.agentTypeId,
          request,
        )
        const executor = new ManualRunExecutor({
          agentTypeId: this.options.agentTypeId,
          availableAgentTypeIds: this.options.availableAgentTypeIds,
          store,
          dispatcherResolver: this.options.dispatcherResolver,
          actorResolver: () => candidate.actor,
          eventPublisher: this.options.eventPublisher,
        })
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
