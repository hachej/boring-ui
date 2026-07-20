import type { FastifyRequest } from "fastify"
import type { AgentEvent } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import type { AutomationRun } from "../shared/types"
import type { AutomationStore } from "./store"
import { AutomationStoreError } from "./store"

export interface VerifiedAutomationActor {
  workspaceId: string
  userId: string
}

export interface ManualRunExecutorOptions {
  store: AutomationStore
  storeForRequest?: (request: FastifyRequest, actor: VerifiedAutomationActor) => Promise<AutomationStore> | AutomationStore
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  actorResolver: (request: FastifyRequest) => Promise<VerifiedAutomationActor> | VerifiedAutomationActor
  clock?: () => Date
}

export interface ManualRunInput {
  automationId: string
  /** Present for HTTP routes; trusted in-process callers use the verified actor path without one. */
  request?: FastifyRequest
  trigger?: "manual" | "scheduled"
  scheduledFor?: string | null
  actor?: VerifiedAutomationActor
}

interface UsageTotals {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

interface UsageAccumulator {
  input: number | null
  output: number | null
}

export class ManualRunExecutor {
  private readonly clock: () => Date

  constructor(private readonly options: ManualRunExecutorOptions) {
    this.clock = options.clock ?? (() => new Date())
  }

  async run(input: ManualRunInput): Promise<AutomationRun> {
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
    const promptSnapshot = await store.getPrompt(input.automationId)
    const modelSnapshot = automation.model
    const model = parseAutomationModel(modelSnapshot)
    const createdAt = this.nowIso()
    const trigger = input.trigger ?? "manual"
    const scheduledFor = trigger === "scheduled" ? input.scheduledFor ?? null : null
    if (trigger === "scheduled" && !scheduledFor) {
      throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_BODY, "scheduled runs require scheduledFor")
    }
    const run = await store.beginRun({
      automationId: automation.id,
      trigger,
      scheduledFor,
      promptSnapshot,
      modelSnapshot,
      createdAt,
    })

    const usage: UsageAccumulator = { input: null, output: null }
    let current = run
    let sessionId: string | null = null
    let terminalStatus: "succeeded" | "failed" | "cancelled" | null = null
    let terminalError: string | null = null
    let startedAt: string | null = null

    try {
      const resolveOptions = input.request ? { request: input.request } : undefined
      const binding = this.options.dispatcherResolver.resolveWithWorkspace
        ? await this.options.dispatcherResolver.resolveWithWorkspace(actor, resolveOptions)
        : undefined
      const promptPath = automationPromptFilePath(automation.id)
      if (binding) {
        await binding.workspace.mkdir(".pi/automation/prompts", { recursive: true })
        await binding.workspace.writeFile(promptPath, promptSnapshot)
      }
      const dispatcher = binding?.dispatcher ?? await this.options.dispatcherResolver.resolve(actor, resolveOptions)
      startedAt = this.nowIso()
      current = await store.updateRunLifecycle(run.id, {
        status: "running",
        startedAt,
        sessionId: null,
      })

      for await (const event of dispatcher.send({
        content: automationPromptInstruction(promptPath),
        model,
        strictModel: true,
        sessionTitle: automationSessionTitle(automation.title, createdAt),
        ...(automation.thinkingLevel ? { thinkingLevel: automation.thinkingLevel } : {}),
        actor: { id: actor.userId },
        originSurface: "boring-automation",
      })) {
        const eventSessionId = sessionIdFromEvent(event)
        if (!sessionId && eventSessionId) {
          sessionId = eventSessionId
          current = await store.updateRunLifecycle(run.id, { sessionId })
        }
        aggregateUsage(usage, event)
        const outcome = terminalOutcomeFromEvent(event)
        if (outcome && !terminalStatus) {
          terminalStatus = outcome.status
          terminalError = outcome.error
        }
      }

      const completedAt = this.nowIso()
      return await this.finalizeRun(store, run.id, {
        current,
        sessionId,
        startedAt,
        completedAt,
        status: terminalStatus ?? "succeeded",
        error: terminalStatus === "failed" ? (terminalError ?? "Automation run failed") : null,
        usage,
      })
    } catch (error) {
      const completedAt = this.nowIso()
      const cancelled = isCancellationError(error)
      const status = terminalStatus ?? (cancelled ? "cancelled" : "failed")
      return await this.finalizeRun(store, run.id, {
        current,
        sessionId,
        startedAt,
        completedAt,
        status,
        error: status === "failed" ? (terminalError ?? safeErrorMessage(error)) : null,
        usage,
      })
    }
  }

  private async finalizeRun(store: AutomationStore, runId: string, input: {
    current: AutomationRun
    sessionId: string | null
    startedAt: string | null
    completedAt: string
    status: "succeeded" | "failed" | "cancelled"
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

export function automationPromptInstruction(path: string): string {
  return `Read and carry out the automation prompt in ${path}. Treat that Markdown file as the full user request.`
}

export function automationPromptFilePath(automationId: string): string {
  return `.pi/automation/prompts/${automationId}.md`
}

export function automationSessionTitle(title: string, startedAt: string): string {
  return `autom: ${title} ${startedAt}`
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
