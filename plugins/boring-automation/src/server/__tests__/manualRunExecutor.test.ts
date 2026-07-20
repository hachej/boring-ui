import type { FastifyRequest } from "fastify"
import type { AgentEvent } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcher } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared/error-codes"
import type { Automation, AutomationCreate, AutomationPatch, AutomationRun, AutomationRunBegin, AutomationRunLifecyclePatch } from "../../shared/types"
import { ManualRunExecutor, parseAutomationModel, type VerifiedAutomationActor } from "../manualRunExecutor"
import { AutomationStoreError, type AutomationStore, automationNotFound, runNotFound } from "../store"

describe("parseAutomationModel", () => {
  it("parses explicit provider:model-id syntax and splits on the first colon", () => {
    expect(parseAutomationModel("openai:gpt-5.5")).toEqual({ provider: "openai", id: "gpt-5.5" })
    expect(parseAutomationModel(" openai : gpt:5.5 ")).toEqual({ provider: "openai", id: "gpt:5.5" })
  })

  it("rejects implicit or incomplete model identifiers", () => {
    for (const value of ["", "gpt-5.5", ":gpt-5.5", "openai:", " : gpt-5.5", "openai: "]) {
      expect(() => parseAutomationModel(value)).toThrowError(AutomationStoreError)
      try {
        parseAutomationModel(value)
      } catch (error) {
        expect(error).toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL })
      }
    }
  })
})

describe("ManualRunExecutor", () => {
  it("forwards the verified actor and Fastify request to the dispatcher resolver and sends the actor id", async () => {
    const request = fakeRequest({ requestId: "req-1" })
    const harness = createHarness({ request })

    await harness.executor.run({ automationId: harness.automation.id, request })

    expect(harness.actorResolver).toHaveBeenCalledWith(request)
    expect(harness.resolver.resolve).toHaveBeenCalledWith(harness.actor, { request })
    expect(harness.dispatcher.send).toHaveBeenCalledWith(expect.objectContaining({
      actor: { id: harness.actor.userId },
      originSurface: "boring-automation",
    }))
  })

  it("allows a trusted in-process caller to dispatch a fresh child session without a Fastify request", async () => {
    const harness = createHarness()

    await harness.executor.run({ automationId: harness.automation.id, actor: harness.actor })

    expect(harness.actorResolver).not.toHaveBeenCalled()
    expect(harness.resolver.resolve).toHaveBeenCalledWith(harness.actor, undefined)
    expect(harness.dispatcher.send).toHaveBeenCalledWith(expect.objectContaining({
      actor: { id: harness.actor.userId },
      originSurface: "boring-automation",
    }))
  })

  it("uses canonical prompt and model snapshots from the store", async () => {
    const harness = createHarness({ prompt: "canonical prompt", model: "anthropic:claude-sonnet" })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({
      promptSnapshot: "canonical prompt",
      modelSnapshot: "anthropic:claude-sonnet",
      status: "succeeded",
    })
    expect(harness.dispatcher.send).toHaveBeenCalledWith(expect.objectContaining({
      content: "canonical prompt",
      model: { provider: "anthropic", id: "claude-sonnet" },
    }))
  })

  it("records an executor-owned scheduled occurrence without changing snapshots", async () => {
    const harness = createHarness({ prompt: "scheduled prompt", model: "test:scheduled-model" })
    const run = await harness.executor.run({
      automationId: harness.automation.id,
      request: harness.request,
      trigger: "scheduled",
      scheduledFor: "2026-07-10T09:00:00.000Z",
    })

    expect(run).toMatchObject({
      trigger: "scheduled",
      scheduledFor: "2026-07-10T09:00:00.000Z",
      promptSnapshot: "scheduled prompt",
      modelSnapshot: "test:scheduled-model",
    })
  })

  it("rejects a scheduled run without an occurrence before creating run metadata", async () => {
    const harness = createHarness()
    await expect(harness.executor.run({
      automationId: harness.automation.id,
      request: harness.request,
      trigger: "scheduled",
    })).rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.INVALID_BODY })
    expect(harness.store.runs.size).toBe(0)
  })

  it("records the first streamed session id and succeeds on an ok terminal event", async () => {
    const harness = createHarness({
      events: [
        event(0, { type: "agent-start", seq: 1, turnId: "turn-1" }, "session-1"),
        event(1, { type: "agent-end", seq: 2, turnId: "turn-1", status: "ok" }, "session-1"),
      ],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "succeeded", sessionId: "session-1", error: null })
    expect(harness.store.lifecyclePatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "running", sessionId: null }),
      expect.objectContaining({ sessionId: "session-1" }),
      expect.objectContaining({ status: "succeeded", sessionId: "session-1" }),
    ]))
  })

  it("treats stream exhaustion without a terminal event as success", async () => {
    const harness = createHarness({
      events: [event(0, { type: "message-delta", seq: 1, messageId: "m1", partId: "p1", kind: "text", delta: "done" })],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "succeeded", error: null })
  })

  it("aggregates multiple Pi usage events without losing cache token fields", async () => {
    const harness = createHarness({
      events: [
        event(0, { type: "usage", seq: 1, usage: { input: 3, output: 2, cacheRead: 5, cacheWrite: 7, totalTokens: 17, cost: { total: 0 } } }),
        event(1, { type: "usage", seq: 2, usage: { input: 1, output: 4, cacheRead: 0, cacheWrite: 2, totalTokens: 7, cost: { total: 0 } } }),
        event(2, { type: "agent-end", seq: 3, turnId: "turn-1", status: "ok" }),
      ],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ inputTokens: 18, outputTokens: 6, totalTokens: 24 })
  })

  it("leaves all usage totals null when no usage fields are observed", async () => {
    const harness = createHarness({
      events: [
        event(0, { type: "usage", seq: 1, usage: { totalTokens: 10, cost: { total: 0 } } }),
        event(1, { type: "agent-end", seq: 2, turnId: "turn-1", status: "ok" }),
      ],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null })
  })

  it("preserves partial usage semantics without fabricating missing token fields", async () => {
    const harness = createHarness({
      events: [
        event(0, { type: "usage", seq: 1, usage: { input: 8 } }),
        event(1, { type: "agent-end", seq: 2, turnId: "turn-1", status: "ok" }),
      ],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ inputTokens: 8, outputTokens: null, totalTokens: 8 })
  })

  it("finalizes as failed when the stream fails before the first event", async () => {
    const harness = createHarness({ streamError: new Error("provider unavailable") })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({
      status: "failed",
      sessionId: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      error: "provider unavailable",
    })
  })

  it("finalizes as failed after a session id and partial usage have been observed", async () => {
    const harness = createHarness({
      events: [
        event(0, { type: "agent-start", seq: 1, turnId: "turn-1" }, "session-partial"),
        event(1, { type: "usage", seq: 2, usage: { input: 8 } }, "session-partial"),
      ],
      streamError: new Error("stream crashed"),
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({
      status: "failed",
      sessionId: "session-partial",
      inputTokens: 8,
      outputTokens: null,
      totalTokens: 8,
      error: "stream crashed",
    })
  })

  it("maps aborted terminal events to cancelled runs", async () => {
    const harness = createHarness({
      events: [event(0, { type: "agent-end", seq: 1, turnId: "turn-1", status: "aborted" })],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "cancelled", error: null })
  })

  it("maps cancellation errors to cancelled runs", async () => {
    const error = new Error("operation aborted") as Error & { code: string }
    error.name = "AbortError"
    error.code = "ABORT_ERR"
    const harness = createHarness({ streamError: error })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "cancelled", error: null })
  })

  it("maps error terminal events to failed runs with the terminal message", async () => {
    const harness = createHarness({
      events: [event(0, { type: "error", seq: 1, error: { code: "INTERNAL_ERROR", message: "tool exploded" } })],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "failed", error: "tool exploded" })
  })

  it("truncates safe error messages to a single bounded line", async () => {
    const long = `${"x".repeat(320)}\nsecret second line`
    const harness = createHarness({ streamError: new Error(long) })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run.error).toHaveLength(300)
    expect(run.error).toBe(`${"x".repeat(297)}...`)
  })

  it("uses the injected clock for deterministic duration", async () => {
    const harness = createHarness({
      clockDates: [
        "2026-07-10T00:00:00.000Z",
        "2026-07-10T00:00:10.000Z",
        "2026-07-10T00:00:15.500Z",
      ],
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({
      createdAt: "2026-07-10T00:00:00.000Z",
      startedAt: "2026-07-10T00:00:10.000Z",
      completedAt: "2026-07-10T00:00:15.500Z",
      durationMs: 5_500,
    })
  })

  it("finalizes the queued run when dispatcher resolution fails", async () => {
    const resolver = { resolve: vi.fn(async () => { throw new Error("no dispatcher") }) }
    const harness = createHarness({ resolver })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "failed", startedAt: null, sessionId: null, error: "no dispatcher" })
    expect(harness.store.lifecyclePatches).toEqual([
      expect.objectContaining({ status: "failed", sessionId: null }),
    ])
  })
})

interface HarnessOptions {
  prompt?: string
  model?: string
  events?: AgentEvent[]
  streamError?: unknown
  resolver?: WorkspaceAgentDispatcherResolver
  request?: FastifyRequest
  clockDates?: string[]
}

function createHarness(options: HarnessOptions = {}) {
  const store = new MemoryAutomationStore()
  const automation = store.seedAutomation({ model: options.model ?? "test:gpt-5.5", prompt: options.prompt ?? "canonical prompt" })
  const actor: VerifiedAutomationActor = { workspaceId: "workspace-1", userId: "user-1" }
  const actorResolver = vi.fn(async () => actor)
  const request = options.request ?? fakeRequest()
  const defaultEvents = options.streamError
    ? []
    : [event(0, { type: "agent-end", seq: 1, turnId: "turn-1", status: "ok" })]
  const dispatcher = createDispatcher(options.events ?? defaultEvents, options.streamError)
  const resolver = options.resolver ?? { resolve: vi.fn(async () => dispatcher) }
  const clock = clockFrom(options.clockDates)
  const executor = new ManualRunExecutor({ store, dispatcherResolver: resolver, actorResolver, clock })
  return { store, automation, actor, actorResolver, request, dispatcher, resolver, executor }
}

function createDispatcher(events: AgentEvent[], streamError: unknown): WorkspaceAgentDispatcher & { send: ReturnType<typeof vi.fn> } {
  const dispatcher: WorkspaceAgentDispatcher & { send: ReturnType<typeof vi.fn> } = {
    send: vi.fn(() => (async function* () {
      for (const item of events) yield item
      if (streamError) throw streamError
    })()),
    interrupt: vi.fn(async () => ({ accepted: true as const, cursor: 0 })),
    stop: vi.fn(async () => ({ accepted: true as const, cursor: 0, stopped: true, clearedQueue: [] })),
  }
  return dispatcher
}

function event(eventIndex: number, chunk: AgentEvent["chunk"], sessionId = "session-1"): AgentEvent {
  return {
    v: 1,
    eventIndex,
    timestamp: eventIndex,
    sessionId,
    chunk,
  }
}

function fakeRequest(extra: Record<string, unknown> = {}): FastifyRequest {
  return { ...extra } as unknown as FastifyRequest
}

function clockFrom(values: string[] = []): () => Date {
  let index = 0
  return () => new Date(values[index++] ?? `2026-07-10T00:00:${String(index).padStart(2, "0")}.000Z`)
}

class MemoryAutomationStore implements AutomationStore {
  readonly automations = new Map<string, Automation>()
  readonly prompts = new Map<string, string>()
  readonly runs = new Map<string, AutomationRun>()
  readonly lifecyclePatches: AutomationRunLifecyclePatch[] = []
  private nextAutomationId = 1
  private nextRunId = 1

  seedAutomation(input: { model: string; prompt: string }): Automation {
    const id = `automation-${this.nextAutomationId++}`
    const now = "2026-07-10T00:00:00.000Z"
    const automation: Automation = {
      id,
      title: "Daily summary",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "UTC",
      model: input.model,
      promptRef: `prompts/${id}.md`,
      createdAt: now,
      updatedAt: now,
    }
    this.automations.set(id, clone(automation))
    this.prompts.set(id, input.prompt)
    return clone(automation)
  }

  async listAutomations(): Promise<Automation[]> {
    return [...this.automations.values()].map(clone)
  }

  async getAutomation(id: string): Promise<Automation | null> {
    const automation = this.automations.get(id)
    return automation ? clone(automation) : null
  }

  async createAutomation(input: AutomationCreate): Promise<Automation> {
    return this.seedAutomation({ model: input.model, prompt: input.prompt ?? "" })
  }

  async updateAutomation(id: string, patch: AutomationPatch): Promise<Automation> {
    const automation = this.automations.get(id)
    if (!automation) throw automationNotFound(id)
    const updated = { ...automation, ...patch, id: automation.id, promptRef: automation.promptRef, createdAt: automation.createdAt }
    this.automations.set(id, clone(updated))
    return clone(updated)
  }

  async deleteAutomation(id: string): Promise<void> {
    this.automations.delete(id)
  }

  async getPrompt(automationId: string): Promise<string> {
    if (!this.automations.has(automationId)) throw automationNotFound(automationId)
    return this.prompts.get(automationId) ?? ""
  }

  async updatePrompt(automationId: string, body: string): Promise<void> {
    if (!this.automations.has(automationId)) throw automationNotFound(automationId)
    this.prompts.set(automationId, body)
  }

  async reconcileOrphanedRuns(_automationId: string): Promise<void> {}

  async beginRun(input: AutomationRunBegin): Promise<AutomationRun> {
    if (!this.automations.has(input.automationId)) throw automationNotFound(input.automationId)
    const now = input.createdAt ?? "2026-07-10T00:00:00.000Z"
    const run: AutomationRun = {
      id: `run-${this.nextRunId++}`,
      automationId: input.automationId,
      sessionId: null,
      status: "queued",
      trigger: input.trigger,
      scheduledFor: input.scheduledFor ?? null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      promptSnapshot: input.promptSnapshot,
      modelSnapshot: input.modelSnapshot,
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    this.runs.set(run.id, clone(run))
    return clone(run)
  }

  async updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun> {
    const run = this.runs.get(runId)
    if (!run) throw runNotFound(runId)
    this.lifecyclePatches.push(clone(patch))
    const updated = { ...run }
    for (const [key, value] of Object.entries(patch) as Array<[keyof AutomationRunLifecyclePatch, AutomationRunLifecyclePatch[keyof AutomationRunLifecyclePatch]]>) {
      if (value !== undefined) (updated as Record<keyof AutomationRunLifecyclePatch, unknown>)[key] = value
    }
    updated.updatedAt = patch.completedAt ?? patch.startedAt ?? run.updatedAt
    this.runs.set(runId, clone(updated))
    return clone(updated)
  }

  async listRuns(automationId: string): Promise<AutomationRun[]> {
    return [...this.runs.values()].filter((run) => run.automationId === automationId).map(clone)
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
