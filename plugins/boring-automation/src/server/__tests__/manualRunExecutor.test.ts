import type { FastifyRequest } from "fastify"
import type { AgentEvent, WorkspaceAgentDispatcher, WorkspaceAgentDispatcherDispatchInput } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared/error-codes"
import type { Automation, AutomationCreate, AutomationPatch, AutomationRun, AutomationRunBegin, AutomationRunLifecyclePatch } from "../../shared/types"
import { automationSessionTitle, ManualRunExecutor, parseAutomationModel, type VerifiedAutomationActor } from "../manualRunExecutor"
import type { AutomationRunEventPublisher } from "../runEventBus"
import { AutomationStoreError, type AutomationStore, automationNotFound, runLeaseLost, runNotFound } from "../store"

afterEach(() => vi.useRealTimers())

describe("automationSessionTitle", () => {
  it("prefixes the prompt-derived session name with its automation title", () => {
    expect(automationSessionTitle("Daily summary", "  Summarize sales\nInclude a chart  ")).toBe(
      "Automation Daily summary: Summarize sales",
    )
    expect(automationSessionTitle("Daily summary", "  ")).toBe("Automation Daily summary: Run")
    expect(automationSessionTitle("Daily summary", "x".repeat(100))).toHaveLength(80)
  })
})

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
    expect(harness.resolver.runWithWorkspaceAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentTypeId: "default",
      context: harness.actor,
      request,
    }), expect.any(Function))
    expect(harness.dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      actor: { id: harness.actor.userId },
      originSurface: "boring-automation",
    }))
  })

  it("allows a trusted in-process caller to dispatch a fresh child session without a Fastify request", async () => {
    const harness = createHarness()

    await harness.executor.run({ automationId: harness.automation.id, actor: harness.actor })

    expect(harness.actorResolver).not.toHaveBeenCalled()
    expect(harness.resolver.runWithWorkspaceAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentTypeId: "default",
      context: harness.actor,
    }), expect.any(Function))
    expect(harness.dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
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
      dispatchRequestId: run.id,
      dispatchReceipt: expect.objectContaining({ ref: { agentTypeId: "default", sessionId: "session-1" } }),
      status: "succeeded",
    })
    expect(harness.dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      requestId: run.id,
      title: "Automation Daily summary: canonical prompt",
      content: "canonical prompt",
      model: { provider: "anthropic", id: "claude-sonnet" },
    }))
  })

  it("publishes durable lifecycle invalidations without making delivery part of run success", async () => {
    const publish = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("notification unavailable"))
      .mockResolvedValue(undefined)
    const harness = createHarness({ eventPublisher: { publish } })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run.status).toBe("succeeded")
    expect(publish.mock.calls.map(([item]) => item.status)).toEqual(expect.arrayContaining(["queued", "dispatching", "running", "succeeded"]))
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: harness.actor.workspaceId,
      userId: harness.actor.userId,
      automationId: harness.automation.id,
      runId: run.id,
      status: "succeeded",
    }))
  })

  it("heartbeats an active run until its event stream completes", async () => {
    vi.useFakeTimers()
    const release = deferred<void>()
    const dispatch = vi.fn(async (input: { requestId: string }) => ({
      ref: { agentTypeId: "default", sessionId: "session-1" },
      receipt: { accepted: true as const, cursor: 0, disposition: "prompt" as const, clientNonce: input.requestId },
      events: (async function* () {
        await release.promise
        yield event(0, { type: "agent-end", seq: 1, turnId: "turn-1", status: "ok" })
      })(),
    }))
    const dispatcher = {
      dispatch,
      send: vi.fn(),
      interrupt: vi.fn(),
      stop: vi.fn(),
    }
    const harness = createHarness({ resolver: createDirectResolver(dispatcher) })

    const execution = harness.executor.run({ automationId: harness.automation.id, request: harness.request })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(30_000)

    expect(harness.store.heartbeatCount).toBe(1)
    release.resolve()
    await execution
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
      expect.objectContaining({ status: "dispatching", sessionId: null }),
      expect.objectContaining({ status: "running", sessionId: "session-1", dispatchReceipt: expect.any(Object) }),
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
      sessionId: "session-1",
      dispatchReceipt: expect.objectContaining({ ref: { agentTypeId: "default", sessionId: "session-1" } }),
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

  it("returns the durable reconciled run when catch-path finalization loses its lease", async () => {
    const harness = createHarness({ streamError: new Error("stream crashed") })
    const updateRunLifecycle = harness.store.updateRunLifecycle.bind(harness.store)
    vi.spyOn(harness.store, "updateRunLifecycle").mockImplementation(async (runId, patch) => {
      if (patch.status === "failed") {
        const current = harness.store.runs.get(runId)!
        harness.store.runs.set(runId, {
          ...current,
          status: "outcome-unknown",
          completedAt: "2026-07-10T00:05:00.000Z",
          error: "Automation worker lease expired",
        })
        throw runLeaseLost(runId)
      }
      return await updateRunLifecycle(runId, patch)
    })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "outcome-unknown", error: "Automation worker lease expired" })
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
    const resolver = createDirectResolver(createDispatcher([], undefined), new Error("no dispatcher"))
    const harness = createHarness({ resolver })

    const run = await harness.executor.run({ automationId: harness.automation.id, request: harness.request })

    expect(run).toMatchObject({ status: "failed", startedAt: "2026-07-10T00:00:02.000Z", sessionId: null, error: "no dispatcher" })
    expect(harness.store.lifecyclePatches).toEqual([
      expect.objectContaining({ status: "dispatching" }),
      expect.objectContaining({ status: "dispatching", startedAt: "2026-07-10T00:00:02.000Z" }),
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
  eventPublisher?: AutomationRunEventPublisher
  request?: FastifyRequest
  clockDates?: string[]
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve })
  return { promise, resolve }
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
  const resolver = options.resolver ?? createDirectResolver(dispatcher)
  const clock = clockFrom(options.clockDates)
  const executor = new ManualRunExecutor({ agentTypeId: "default", store, dispatcherResolver: resolver, actorResolver, eventPublisher: options.eventPublisher, clock })
  return { store, automation, actor, actorResolver, request, dispatcher, resolver, executor }
}

function createDispatcher(events: AgentEvent[], streamError: unknown): WorkspaceAgentDispatcher & { dispatch: ReturnType<typeof vi.fn> } {
  const sessionId = events[0]?.sessionId ?? "session-1"
  const dispatch = vi.fn(async (input: { requestId: string }) => ({
    ref: { agentTypeId: "default", sessionId },
    receipt: { accepted: true as const, cursor: 0, disposition: "prompt" as const, clientNonce: input.requestId },
    events: (async function* () {
      for (const item of events) yield item
      if (streamError) throw streamError
    })(),
  }))
  const dispatcher: WorkspaceAgentDispatcher & { dispatch: ReturnType<typeof vi.fn> } = {
    dispatch,
    send: vi.fn((input) => (async function* () { yield* (await dispatch({ ...input, requestId: "compat" })).events })()),
    interrupt: vi.fn(async () => ({ accepted: true as const, cursor: 0 })),
    stop: vi.fn(async () => ({ accepted: true as const, cursor: 0, stopped: true, clearedQueue: [] })),
  }
  return dispatcher
}

function createDirectResolver(
  dispatcher: WorkspaceAgentDispatcher & { dispatch: ReturnType<typeof vi.fn> },
  runError?: Error,
): WorkspaceAgentDispatcherResolver & { runWithWorkspaceAgent: ReturnType<typeof vi.fn> } {
  return {
    runWithWorkspaceAgent: vi.fn(async (_input, run) => {
      if (runError) throw runError
      await run({
        workspace: {} as never,
        signal: new AbortController().signal,
        async dispatch(input: WorkspaceAgentDispatcherDispatchInput, onEvent: (event: AgentEvent) => void | Promise<void>, onAccepted?: Parameters<import("@hachej/boring-agent/shared").LeaseBoundWorkspaceAgent["dispatch"]>[2]) {
          const dispatched = await dispatcher.dispatch!(input)
          await onAccepted?.({ ref: dispatched.ref, receipt: dispatched.receipt })
          for await (const item of dispatched.events) await onEvent(item)
          return { ref: dispatched.ref, receipt: dispatched.receipt }
        },
        async interrupt(sessionId: string, _requestId: string) { return await dispatcher.interrupt(sessionId) },
        async stop(sessionId: string, _requestId: string) { return await dispatcher.stop(sessionId) },
      })
    }),
    async resolve() { throw new Error("legacy resolver must not be used") },
  }
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
  heartbeatCount = 0
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
    const id = `run-${this.nextRunId++}`
    const run: AutomationRun = {
      id,
      automationId: input.automationId,
      invocationId: input.invocationId ?? `store:${id}`,
      dispatchRequestId: id,
      dispatchReceipt: null,
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

  async claimRunForDispatch(runId: string): Promise<AutomationRun | null> {
    const run = this.runs.get(runId)
    if (!run) throw runNotFound(runId)
    if (run.status !== "queued") return null
    return await this.updateRunLifecycle(runId, { status: "dispatching" })
  }

  async heartbeatRun(runId: string): Promise<boolean> {
    const run = this.runs.get(runId)
    if (!run) throw runNotFound(runId)
    this.heartbeatCount += 1
    return true
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
