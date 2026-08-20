import { randomUUID } from "node:crypto"

import type { FastifyRequest } from "fastify"
import type { AgentEvent } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import type { AutomationRun, AutomationRunTrigger } from "../shared/types"
import type { AutomationRunEventPublisher } from "./runEventBus"
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

const RUN_HEARTBEAT_INTERVAL_MS = 30_000

interface UsageTotals {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

interface UsageAccumulator {
  input: number | null
  output: number | null
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
        // After admission, run() persists its own terminal failure whenever the
        // durable run lease remains available. Detached callers read that record.
      })
    })
  }

  async run(input: DispatchRunInput): Promise<AutomationRun> {
    const actor = input.actor ?? (input.request
      ? await this.options.actorResolver(input.request)
      : (() => { throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE, "automation actor is required") })())
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
    const trigger = input.trigger ?? "manual"
    const scheduledFor = trigger === "scheduled" ? input.scheduledFor ?? null : null
    if (trigger === "scheduled" && !scheduledFor) {
      throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_BODY, "scheduled runs require scheduledFor")
    }
    const invocationId = input.invocationId ?? (trigger === "scheduled"
      ? `scheduled:${automation.id}:${scheduledFor}`
      : `${trigger}:${randomUUID()}`)
    const continuationSessionId = automation.sessionMode === "continue"
      ? (await store.listRuns(automation.id)).find((candidate) => candidate.sessionId)?.sessionId ?? null
      : null
    const run = await store.beginRun({
      automationId: automation.id,
      invocationId,
      trigger,
      scheduledFor,
      promptSnapshot,
      modelSnapshot,
      createdAt,
    })
    await this.publishRunChange(actor, run)
    // beginRun is the durable invocation-to-run receipt. A retry of a terminal
    // invocation returns that receipt verbatim and must never enter dispatch
    // again, especially after restart reconciliation made the outcome unknown.
    if (isTerminalRunStatus(run.status)) {
      await input.onStarted?.(run)
      return run
    }

    const usage: UsageAccumulator = { input: null, output: null }
    let sessionId: string | null = null
    let terminalStatus: "succeeded" | "failed" | "cancelled" | null = null
    let terminalError: string | null = null
    let dispatchAccepted = false
    let dispatchIdentityPersistenceFailed = false
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
      let dispatchReceipt: AutomationRun["dispatchReceipt"] | null = null
      let durableSessionId: string | null = null
      const persistDispatchIdentity = async (
        ref: { agentTypeId: string; sessionId: string },
        receipt?: Omit<NonNullable<AutomationRun["dispatchReceipt"]>, "ref">,
      ) => {
        sessionId = ref.sessionId
        if (receipt) {
          dispatchAccepted = true
          dispatchReceipt = { ref, ...receipt }
        }
        if (durableSessionId === ref.sessionId && (!receipt || current.dispatchReceipt)) return
        try {
          current = await store.updateRunLifecycle(run.id, {
            status: "dispatching",
            sessionId: ref.sessionId,
            ...(dispatchReceipt ? { dispatchReceipt } : {}),
          })
        } catch (error) {
          dispatchIdentityPersistenceFailed = true
          throw error
        }
        durableSessionId = ref.sessionId
        await this.publishRunChange(actor, current)
      }
      await runWithWorkspaceAgent.call(this.options.dispatcherResolver, {
        agentTypeId,
        context: actor,
        requestId: run.id,
        ...(input.request ? { request: input.request } : {}),
      }, async (binding) => {
        const dispatchOnce = async (existingSessionId?: string) => {
          const dispatched = await binding.dispatch({
            requestId: run.id,
            ...(existingSessionId ? { sessionId: existingSessionId } : {}),
            title: automationSessionTitle(automation.title, promptSnapshot),
            content: promptSnapshot,
            model,
            ...(automation.thinkingLevel ? { thinkingLevel: automation.thinkingLevel } : {}),
            actor: { id: actor.userId },
            originSurface: "boring-automation",
          }, async (event) => {
            const eventSessionId = sessionIdFromEvent(event)
            if (!durableSessionId && eventSessionId) {
              await persistDispatchIdentity({ agentTypeId, sessionId: eventSessionId })
            }
            aggregateUsage(usage, event)
            const outcome = terminalOutcomeFromEvent(event)
            if (outcome && !terminalStatus) {
              terminalStatus = outcome.status
              terminalError = outcome.error
            }
          }, async ({ ref, receipt }) => {
            await persistDispatchIdentity(ref, receipt)
          })
          if (!dispatchReceipt) await persistDispatchIdentity(dispatched.ref, dispatched.receipt)
        }
        try {
          await dispatchOnce(continuationSessionId ?? undefined)
        } catch (error) {
          if (!continuationSessionId || dispatchReceipt || !isContinuationUnavailable(error)) throw error
          const note = `Stored continuation session ${continuationSessionId} was unavailable; started a new session.`
          current = await store.updateRunLifecycle(run.id, { note, sessionId: null, dispatchReceipt: null })
          sessionId = null
          durableSessionId = null
          dispatchReceipt = null
          await this.publishRunChange(actor, current)
          await dispatchOnce()
        }
      })
      current = await store.updateRunLifecycle(run.id, {
        status: "running",
        sessionId,
        dispatchReceipt,
      })
      await this.publishRunChange(actor, current)

      const completedAt = this.nowIso()
      await stopHeartbeat()
      const finalized = await this.finalizeRun(store, run.id, {
        current,
        sessionId,
        startedAt,
        completedAt,
        status: terminalStatus ?? "succeeded",
        error: terminalStatus === "failed" ? (terminalError ?? "Automation run failed") : null,
        usage,
      })
      await this.publishRunChange(actor, finalized)
      return finalized
    } catch (error) {
      const completedAt = this.nowIso()
      await stopHeartbeat()
      if (isRunLeaseLost(error)) return await this.readDurableRun(store, automation.id, run.id, current)
      const cancelled = isCancellationError(error)
      const status = terminalStatus
        ?? (cancelled ? "cancelled" : (dispatchAccepted || dispatchIdentityPersistenceFailed ? "outcome-unknown" : "failed"))
      let finalized: AutomationRun
      try {
        finalized = await this.finalizeRun(store, run.id, {
          current,
          sessionId,
          startedAt,
          completedAt,
          status,
          error: status === "failed" || status === "outcome-unknown" ? (terminalError ?? safeErrorMessage(error)) : null,
          usage,
        })
      } catch (finalizeError) {
        if (isRunLeaseLost(finalizeError)) return await this.readDurableRun(store, automation.id, run.id, current)
        throw finalizeError
      }
      await this.publishRunChange(actor, finalized)
      return finalized
    }
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
      ...finalizeUsage(input.usage),
      error: input.error,
    })
  }

  private nowIso(): string {
    return this.clock().toISOString()
  }
}

function isContinuationUnavailable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === "AGENT_SESSION_NOT_FOUND"
    || code === "AGENT_COMMAND_INVALID_STATE"
    || code === "AGENT_SCOPE_DENIED"
}

function startRunHeartbeat(store: AutomationStore, runId: string): () => Promise<void> {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> = Promise.resolve()
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      inFlight = store.heartbeatRun(runId)
        .then((renewed) => {
          if (renewed) schedule()
          else stopped = true
        })
        .catch(() => schedule())
    }, RUN_HEARTBEAT_INTERVAL_MS)
    timer.unref?.()
  }
  schedule()
  return async () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    await inFlight
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
  const index = value.indexOf(":")
  if (index <= 0 || index === value.length - 1) {
    throw new AutomationStoreError(
      BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL,
      "automation model must use explicit provider:model-id syntax",
    )
  }
  const provider = value.slice(0, index).trim()
  const id = value.slice(index + 1).trim()
  if (!provider || !id) {
    throw new AutomationStoreError(
      BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL,
      "automation model must use explicit provider:model-id syntax",
    )
  }
  return { provider, id }
}

function sessionIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null
  const sessionId = (event as { sessionId?: unknown }).sessionId
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null
}

function chunkFromEvent(event: unknown): AgentEvent["chunk"] | null {
  if (!event || typeof event !== "object") return null
  const chunk = (event as { chunk?: unknown }).chunk
  if (!chunk || typeof chunk !== "object") return null
  return chunk as AgentEvent["chunk"]
}

function aggregateUsage(accumulator: UsageAccumulator, event: unknown): void {
  const chunk = chunkFromEvent(event)
  if (!chunk || chunk.type !== "usage") return
  const usage = chunk.usage
  if (!usage || typeof usage !== "object") return
  const record = usage as Record<string, unknown>
  const input = sumObservedNumbers(record.input, record.inputTokens, record.cacheRead, record.cacheReadTokens, record.cacheWrite, record.cacheWriteTokens)
  const output = sumObservedNumbers(record.output, record.outputTokens)
  if (input !== null) accumulator.input = (accumulator.input ?? 0) + input
  if (output !== null) accumulator.output = (accumulator.output ?? 0) + output
}

function sumObservedNumbers(...values: unknown[]): number | null {
  let observed = false
  let total = 0
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue
    observed = true
    total += Math.trunc(value)
  }
  return observed ? total : null
}

function finalizeUsage(usage: UsageAccumulator): UsageTotals {
  if (usage.input === null && usage.output === null) {
    return { inputTokens: null, outputTokens: null, totalTokens: null }
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: (usage.input ?? 0) + (usage.output ?? 0),
  }
}

function terminalOutcomeFromEvent(event: unknown): { status: "succeeded" | "failed" | "cancelled"; error: string | null } | null {
  const chunk = chunkFromEvent(event)
  if (!chunk) return null
  if (chunk.type === "agent-end" && !chunk.willRetry) {
    if (chunk.status === "ok") return { status: "succeeded", error: null }
    if (chunk.status === "aborted") return { status: "cancelled", error: null }
    return { status: "failed", error: "Automation run failed" }
  }
  if (chunk.type === "error") {
    return { status: "failed", error: safeErrorMessage(chunk.error) }
  }
  return null
}

function isTerminalRunStatus(status: AutomationRun["status"]): boolean {
  return status === "succeeded"
    || status === "failed"
    || status === "cancelled"
    || status === "outcome-unknown"
}

function isRunLeaseLost(error: unknown): boolean {
  return error instanceof AutomationStoreError && error.code === BORING_AUTOMATION_ERROR_CODES.RUN_LEASE_LOST
}

function isCancellationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const record = error as { name?: unknown; code?: unknown }
  return record.name === "AbortError" || record.code === "ABORT_ERR"
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Automation run failed"
  const firstLine = raw.split(/\r?\n/u)[0]?.trim() || "Automation run failed"
  return firstLine.length > 300 ? `${firstLine.slice(0, 297)}...` : firstLine
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
}
