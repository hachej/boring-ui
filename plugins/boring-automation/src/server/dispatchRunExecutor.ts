import { randomUUID } from "node:crypto"

import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import { parseAutomationModelRef } from "../shared/model"
import { clampAutomationPersistedDurationMs, resolveAutomationRunDurationCapMs } from "../shared/schedule"
import { isAutomationRunSettled } from "../shared/runStatus"
import type { AutomationRun, AutomationRunTrigger } from "../shared/types"
import { aggregateUsage, finalizeUsage, safeErrorMessage, sessionIdFromEvent, terminalOutcomeFromEvent, type UsageAccumulator } from "./agentEventProjection"
import { AutomationSessionUnaddressableError, DispatchIdentity } from "./dispatchIdentity"
import type { AutomationRunEventPublisher } from "./runEventBus"
import { AutomationRunDurationCapExceededError, durationCapErrorMessage, runWithDurationCap, startRunHeartbeat, type DurationCapStopOutcome } from "./runTimers"
import type { AutomationStore } from "./store"
import { AutomationStoreError } from "./store"

export interface VerifiedAutomationActor {
  workspaceId: string
  userId: string
}

export interface DispatchRunExecutorOptions {
  /** Host-default Agent used by legacy automations without an explicit selection. */
  agentTypeId: string
  /** Host registry used to reject stale or unknown per-automation selections. */
  availableAgentTypeIds?: readonly string[]
  store: AutomationStore
  storeForRequest?: (request: FastifyRequest, actor: VerifiedAutomationActor) => Promise<AutomationStore> | AutomationStore
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  actorResolver: (request: FastifyRequest) => Promise<VerifiedAutomationActor> | VerifiedAutomationActor
  eventPublisher?: AutomationRunEventPublisher
  clock?: () => Date
  logger?: Pick<Console, "error">
}

export interface DispatchRunInput {
  automationId: string
  /** Present for HTTP routes; trusted in-process callers use the verified actor path without one. */
  request?: FastifyRequest
  trigger?: AutomationRunTrigger
  scheduledFor?: string | null
  actor?: VerifiedAutomationActor
  /** Optional caller idempotency key; explicit new runs omit it and get a new ID. */
  invocationId?: string
  /** Internal receipt hook used by detached dispatch starts after durable admission. */
  onStarted?: (run: AutomationRun) => void | Promise<void>
}


export class DispatchRunExecutor {
  private readonly clock: () => Date

  constructor(private readonly options: DispatchRunExecutorOptions) {
    this.clock = options.clock ?? (() => new Date())
  }

  /** Admit a dispatch run durably, then let the host-owned execution outlive its caller. */
  async start(input: DispatchRunInput): Promise<AutomationRun> {
    return await new Promise<AutomationRun>((resolve, reject) => {
      let admitted = false
      void this.run({
        ...input,
        onStarted: async (run) => {
          admitted = true
          resolve(run)
        },
      }).catch((error: unknown) => {
        if (!admitted) reject(error)
        else (this.options.logger ?? console).error(`Automation run failed after durable admission: ${safeErrorMessage(error)}`)
      })
    })
  }

  async run(input: DispatchRunInput): Promise<AutomationRun> {
    let actor = input.actor
    if (!actor) {
      if (!input.request) throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE, "automation actor is required")
      actor = await this.options.actorResolver(input.request)
    }
    const store = input.request
      ? await this.options.storeForRequest?.(input.request, actor) ?? this.options.store
      : this.options.store
    const automation = await store.getAutomation(input.automationId)
    if (!automation) {
      throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND, `automation ${input.automationId} not found`)
    }
    const agentTypeId = resolveAutomationAgentTypeId(
      automation.agentTypeId,
      this.options.agentTypeId,
      this.options.availableAgentTypeIds,
    )
    const promptSnapshot = await store.getPrompt(input.automationId)
    const modelSnapshot = automation.model
    const model = parseAutomationModel(modelSnapshot)
    const createdAt = this.nowIso()
    const runDurationCapMs = resolveAutomationRunDurationCapMs(automation, new Date(createdAt))
    const trigger = input.trigger ?? "manual"
    const scheduledFor = trigger === "scheduled" ? input.scheduledFor ?? null : null
    if (trigger === "scheduled" && !scheduledFor) {
      throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_BODY, "scheduled runs require scheduledFor")
    }
    const invocationId = input.invocationId ?? (trigger === "scheduled"
      ? `scheduled:${automation.id}:${scheduledFor}`
      : `${trigger}:${randomUUID()}`)
    const run = await store.beginRun({
      automationId: automation.id,
      invocationId,
      trigger,
      scheduledFor,
      promptSnapshot,
      modelSnapshot,
      createdAt,
    })
    // beginRun is the durable invocation-to-run receipt. A retry of a terminal
    // invocation returns that receipt verbatim and must never enter dispatch or
    // republish a lifecycle transition that did not occur.
    if (isAutomationRunSettled(run.status)) {
      await input.onStarted?.(run)
      return run
    }
    await this.publishRunChange(actor, run)

    const usage: UsageAccumulator = { input: null, output: null }
    let terminalStatus: "succeeded" | "failed" | "cancelled" | null = null
    let terminalError: string | null = null
    let identity: DispatchIdentity | undefined
    const claimed = await store.claimRunForDispatch(run.id)
    if (!claimed) {
      const durable = await this.readDurableRun(store, automation.id, run.id, run)
      await input.onStarted?.(durable)
      return durable
    }
    let current = claimed
    const stopHeartbeat = startRunHeartbeat(store, run.id)
    await this.publishRunChange(actor, current)
    await input.onStarted?.(current)
    let startedAt: string | null = null

    try {
      const runWithWorkspaceAgent = this.options.dispatcherResolver.runWithWorkspaceAgent
      if (!runWithWorkspaceAgent) {
        throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE, "automation dispatcher does not support callback-scoped AgentHost runs")
      }
      startedAt = this.nowIso()
      current = await store.updateRunLifecycle(run.id, { status: "dispatching", startedAt, sessionId: null })
      await this.publishRunChange(actor, current)
      identity = new DispatchIdentity({
        store,
        runId: run.id,
        current,
        actor,
        requireAddressability: trigger === "scheduled",
        ...(input.request ? { request: input.request } : {}),
        dispatcherResolver: this.options.dispatcherResolver,
        publish: async (changed) => await this.publishRunChange(actor, changed),
      })
      let stopTimedOutSession: ((sessionId: string) => Promise<boolean>) | undefined
      await runWithDurationCap({
        durationCapMs: runDurationCapMs,
        sessionId: () => identity!.sessionId,
        stop: async (timedOutSessionId) => {
          return stopTimedOutSession ? await stopTimedOutSession(timedOutSessionId) : false
        },
      }, async () => {
        await runWithWorkspaceAgent.call(this.options.dispatcherResolver, {
          agentTypeId,
          context: actor,
          requestId: run.id,
          ...(input.request ? { request: input.request } : {}),
        }, async (binding) => {
          stopTimedOutSession = async (timedOutSessionId) => {
            const receipt = await binding.stop(timedOutSessionId, `duration-cap:${run.id}`)
            return receipt.stopped === true
          }
          const dispatched = await binding.dispatch({
            requestId: run.id,
            title: automationSessionTitle(automation.title, promptSnapshot),
            content: promptSnapshot,
            model,
            ...(automation.thinkingLevel ? { thinkingLevel: automation.thinkingLevel } : {}),
            actor: { id: actor.userId },
            originSurface: "boring-automation",
          }, async (event) => {
            const eventSessionId = sessionIdFromEvent(event)
            if (!identity!.sessionId && eventSessionId) {
              await identity!.persist({ agentTypeId, sessionId: eventSessionId })
            }
            aggregateUsage(usage, event)
            const outcome = terminalOutcomeFromEvent(event)
            if (outcome && !terminalStatus) {
              terminalStatus = outcome.status
              terminalError = outcome.error
            }
          }, async ({ ref, receipt }) => {
            await identity!.persist(ref, receipt)
          })
          if (!identity!.dispatchReceipt) await identity!.persist(dispatched.ref, dispatched.receipt)
        })

      })
      current = identity.current
      current = await store.updateRunLifecycle(run.id, {
        status: "running",
        sessionId: identity.sessionId,
        dispatchReceipt: identity.dispatchReceipt,
      })
      await this.publishRunChange(actor, current)

      const completedAt = this.nowIso()
      await stopHeartbeat()
      const finalized = await this.finalizeRun(store, run.id, {
        current,
        sessionId: identity.sessionId,
        dispatchReceipt: identity.dispatchReceipt,
        startedAt,
        completedAt,
        status: terminalStatus ?? "outcome-unknown",
        error: terminalStatus === "failed"
          ? (terminalError ?? "Automation run failed")
          : terminalStatus === null ? "Automation dispatch stream ended without a terminal outcome" : null,
        usage,
      })
      await this.publishRunChange(actor, finalized)
      return finalized
    } catch (error) {
      await stopHeartbeat()
      if (isRunLeaseLost(error)) {
        return await this.recoverLeaseLost(store, actor, automation.id, run.id, current, identity)
      }
      if (identity) current = identity.current
      const failure = await classifyFailure(error, identity ?? { dispatchInFlight: false })
      const completedAt = this.nowIso()
      const status = finalStatus(failure, terminalStatus)
      let finalized: AutomationRun
      try {
        finalized = await this.finalizeRun(store, run.id, {
          current,
          sessionId: identity?.sessionId ?? null,
          dispatchReceipt: identity?.dispatchReceipt ?? null,
          startedAt,
          completedAt,
          status,
          error: failure.kind === "duration-cap"
            ? durationCapErrorMessage(failure.error, failure.stop)
            : status === "failed" || status === "outcome-unknown" ? (terminalError ?? failure.message) : null,
          usage,
        })
      } catch (finalizeError) {
        if (isRunLeaseLost(finalizeError)) {
          return await this.recoverLeaseLost(store, actor, automation.id, run.id, current, identity)
        }
        throw finalizeError
      }
      await this.publishRunChange(actor, finalized)
      return finalized
    }
  }

  private async recoverLeaseLost(
    store: AutomationStore,
    actor: VerifiedAutomationActor,
    automationId: string,
    runId: string,
    fallback: AutomationRun,
    identity: DispatchIdentity | undefined,
  ): Promise<AutomationRun> {
    if (identity?.dispatchReceipt) {
      const preserved = await store.preserveAcceptedDispatch(
        runId,
        identity.dispatchReceipt,
        this.nowIso(),
        "Automation dispatch was accepted before its worker lease was lost; the outcome remains unknown",
      )
      if (preserved) {
        await this.publishRunChange(actor, preserved)
        return preserved
      }
    }
    return await this.readDurableRun(store, automationId, runId, fallback)
  }

  private async readDurableRun(store: AutomationStore, automationId: string, runId: string, fallback: AutomationRun): Promise<AutomationRun> {
    return (await store.listRuns(automationId)).find((candidate) => candidate.id === runId) ?? fallback
  }

  private async publishRunChange(actor: VerifiedAutomationActor, run: AutomationRun): Promise<void> {
    try {
      await this.options.eventPublisher?.publish({
        v: 1,
        eventId: randomUUID(),
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        automationId: run.automationId,
        runId: run.id,
        status: run.status,
        updatedAt: run.updatedAt,
      })
    } catch {
      // Notifications are best-effort invalidations; durable run state remains authoritative.
    }
  }

  private async finalizeRun(store: AutomationStore, runId: string, input: {
    current: AutomationRun
    sessionId: string | null
    dispatchReceipt: AutomationRun["dispatchReceipt"] | null
    startedAt: string | null
    completedAt: string
    status: "succeeded" | "failed" | "cancelled" | "outcome-unknown"
    error: string | null
    usage: UsageAccumulator
  }): Promise<AutomationRun> {
    return await store.updateRunLifecycle(runId, {
      status: input.status,
      completedAt: input.completedAt,
      durationMs: durationMs(input.startedAt ?? input.current.createdAt, input.completedAt),
      sessionId: input.sessionId,
      dispatchReceipt: input.dispatchReceipt,
      ...finalizeUsage(input.usage),
      error: input.error,
    })
  }

  private nowIso(): string {
    return this.clock().toISOString()
  }
}


export function resolveAutomationAgentTypeId(
  automationAgentTypeId: string | undefined,
  hostDefaultAgentTypeId: string,
  availableAgentTypeIds: readonly string[] | undefined,
): string {
  const agentTypeId = automationAgentTypeId ?? hostDefaultAgentTypeId
  const available = availableAgentTypeIds ?? [hostDefaultAgentTypeId]
  if (available.includes(agentTypeId)) return agentTypeId
  throw new AutomationStoreError(
    BORING_AUTOMATION_ERROR_CODES.AGENT_NOT_FOUND,
    `automation agent ${agentTypeId} is not available`,
  )
}

export function automationSessionTitle(automationTitle: string, prompt: string): string {
  const sessionName = prompt.trim().split(/\r?\n/, 1)[0]?.trim() || "Run"
  return `Automation ${automationTitle.trim()}: ${sessionName}`.slice(0, 80)
}

export function parseAutomationModel(value: string): { provider: string; id: string } {
  const parsed = parseAutomationModelRef(value)
  if (parsed) return parsed
  throw new AutomationStoreError(
    BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL,
    "automation model must use explicit provider:model-id syntax",
  )
}


export type RunFailure =
  | { kind: "duration-cap"; stop: DurationCapStopOutcome; error: AutomationRunDurationCapExceededError; message: string }
  | { kind: "unaddressable"; message: string }
  | { kind: "cancelled"; dispatchInFlight: boolean; message: string }
  | { kind: "unknown"; dispatchInFlight: boolean; message: string }

export async function classifyFailure(error: unknown, identity: { dispatchInFlight: boolean }): Promise<RunFailure> {
  const message = safeErrorMessage(error)
  if (error instanceof AutomationRunDurationCapExceededError) {
    return { kind: "duration-cap", stop: await error.stopCompletion, error, message }
  }
  if (error instanceof AutomationSessionUnaddressableError) return { kind: "unaddressable", message }
  if (isCancellationError(error)) return { kind: "cancelled", dispatchInFlight: identity.dispatchInFlight, message }
  return { kind: "unknown", dispatchInFlight: identity.dispatchInFlight, message }
}

export function finalStatus(
  failure: RunFailure,
  observed: "succeeded" | "failed" | "cancelled" | null,
): "succeeded" | "failed" | "cancelled" | "outcome-unknown" {
  if (failure.kind === "unaddressable") return "outcome-unknown"
  if (failure.kind === "duration-cap") return failure.stop.confirmed ? "cancelled" : "outcome-unknown"
  if (observed) return observed
  if (failure.kind === "cancelled") return failure.dispatchInFlight ? "outcome-unknown" : "cancelled"
  return failure.dispatchInFlight ? "outcome-unknown" : "failed"
}

function isRunLeaseLost(error: unknown): boolean {
  return error instanceof AutomationStoreError && error.code === BORING_AUTOMATION_ERROR_CODES.RUN_LEASE_LOST
}

function isCancellationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const record = error as { name?: unknown; code?: unknown }
  return record.name === "AbortError" || record.code === "ABORT_ERR"
}


function durationMs(startedAt: string, completedAt: string): number {
  return clampAutomationPersistedDurationMs(new Date(completedAt).getTime() - new Date(startedAt).getTime())
}
