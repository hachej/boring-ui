import { describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ERROR_CODES, type Automation, type AutomationRun } from "../../shared"
import {
  AUTOMATION_TOOL_ERROR_CHARACTER_LIMIT,
  AUTOMATION_TOOL_PROMPT_CHARACTER_LIMIT,
  createAutomationOperations,
  resolveAutomationOperationsForActor,
} from "../operations"
import { AutomationStoreError, type AutomationStore } from "../store"

const NOW = "2026-07-19T00:00:00.000Z"

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "automation-1",
    title: "Daily summary",
    enabled: true,
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "anthropic:claude-sonnet",
    thinkingLevel: "medium",
    promptRef: "prompts/automation-1.md",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "automation-1",
    sessionId: "session-1",
    dispatchReceipt: {
      ref: { agentTypeId: "worker", sessionId: "session-1" }, accepted: true, cursor: 1,
      disposition: "prompt", clientNonce: "run-1",
    },
    status: "succeeded",
    trigger: "manual",
    scheduledFor: null,
    startedAt: NOW,
    completedAt: NOW,
    durationMs: 100,
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
    promptSnapshot: "secret prompt",
    modelSnapshot: "secret:model",
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function storeMock(overrides: Partial<AutomationStore> = {}) {
  const current = automation()
  const store: AutomationStore = {
    listAutomations: vi.fn(async () => [current]),
    getAutomation: vi.fn(async (id) => id === current.id ? current : null),
    createAutomation: vi.fn(async (input) => automation({ title: input.title, enabled: input.enabled ?? true, cron: input.cron, timezone: input.timezone, model: input.model, thinkingLevel: input.thinkingLevel })),
    readSeedManifest: vi.fn(async () => null),
    ensureSeededAutomation: vi.fn(async () => null),
    findExistingSeedKeys: vi.fn(async () => []),
    removeSeededAutomationIfIdle: vi.fn(async () => true),
    updateAutomation: vi.fn(async (_id, patch) => automation(patch)),
    deleteAutomation: vi.fn(async () => {}),
    getPrompt: vi.fn(async () => "prompt"),
    updatePrompt: vi.fn(async () => {}),
    reconcileOrphanedRuns: vi.fn(async () => {}),
    beginRun: vi.fn(async () => run()),
    claimRunForDispatch: vi.fn(async () => run({ status: "dispatching" })),
    heartbeatRun: vi.fn(async () => true),
    preserveAcceptedDispatch: vi.fn(async () => run({ status: "outcome-unknown" })),
    updateRunLifecycle: vi.fn(async () => run()),
    listRuns: vi.fn(async () => [run()]),
    listRecentRuns: vi.fn(async () => [run()]),
    findRunBySessionRef: vi.fn(async (ref) => ref.agentTypeId === "worker" && ref.sessionId === "session-1" ? run() : null),
    ...overrides,
    getRun: overrides.getRun ?? vi.fn(async (_automationId, runId) => runId === "run-1" ? run() : null),
  }
  return store
}

describe("AutomationOperations", () => {
  it("fails closed before resolving a store when hosted actor context is incomplete", async () => {
    const resolveStore = vi.fn(() => storeMock())

    await expect(resolveAutomationOperationsForActor({ mode: "hosted", resolveStore }, { workspaceId: "workspace-1" }))
      .rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE })
    await expect(resolveAutomationOperationsForActor({ mode: "hosted", resolveStore }, { userId: "user-1" }))
      .rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE })
    expect(resolveStore).not.toHaveBeenCalled()
  })

  it("binds hosted actors exactly and assigns the fixed local actor in local mode", async () => {
    const hostedStore = storeMock()
    const hostedResolver = vi.fn(() => hostedStore)
    const hosted = await resolveAutomationOperationsForActor(
      { mode: "hosted", resolveStore: hostedResolver },
      { workspaceId: " workspace-1 ", userId: " user-1 " },
    )
    expect(hosted.actor).toEqual({ workspaceId: "workspace-1", userId: "user-1" })
    expect(hostedResolver).toHaveBeenCalledWith(hosted.actor)

    const localResolver = vi.fn(() => storeMock())
    const local = await resolveAutomationOperationsForActor(
      { mode: "local", resolveStore: localResolver },
      { workspaceId: "workspace-2", userId: "attacker-controlled-is-ignored" },
    )
    expect(local.actor).toEqual({ workspaceId: "workspace-2", userId: "local" })
    expect(localResolver).toHaveBeenCalledWith(local.actor)
  })

  it("projects bounded automation lists without storage references", async () => {
    const items = Array.from({ length: 3 }, (_, index) => automation({ id: `automation-${index}` }))
    const operations = createAutomationOperations({ store: storeMock({ listAutomations: vi.fn(async () => items) }), actor: { workspaceId: "w", userId: "u" } })

    const result = await operations.list(2)

    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).not.toHaveProperty("promptRef")
    await expect(operations.list(101)).rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.INVALID_BODY })
  })

  it("joins dispatch runs with transcript-redacted session health", async () => {
    const store = storeMock({ listRuns: vi.fn(async () => [run({ status: "running", trigger: "manual" })]) })
    const sessionController = {
      list: vi.fn(async () => [{ ref: { agentTypeId: "worker", sessionId: "session-1" }, title: "[br-1276] worker", status: "running" as const, createdAt: Date.now() - 20_000, updatedAt: Date.now() - 5_000 }]),
      nudge: vi.fn(async () => ({ status: "accepted" as const, receipt: {} as never })),
      cancel: vi.fn(async () => ({ accepted: true as const, cursor: 1, stopped: true, clearedQueue: [] })),
    }
    const operations = createAutomationOperations({ store, actor: { workspaceId: "w", userId: "u" }, defaultAgentTypeId: "default", sessionController })

    const listed = await operations.listDispatchRuns!(10)

    expect(listed.items).toEqual([expect.objectContaining({
      trigger: "manual",
      sessionId: "session-1",
      agentTypeId: "worker",
      sessionTitle: "[br-1276] worker",
      sessionStatus: "running",
      sessionAgeMs: expect.any(Number),
    })])
  })

  it("reports truncation when the storage-bounded fleet query has more rows", async () => {
    const recent = vi.fn(async () => [run({ id: "run-2" }), run({ id: "run-1" })])
    const store = storeMock({ listRecentRuns: recent })
    const operations = createAutomationOperations({ store, actor: { workspaceId: "w", userId: "u" } })

    const listed = await operations.listDispatchRuns!(1)

    expect(recent).toHaveBeenCalledWith(2)
    expect(listed).toMatchObject({ truncated: true, items: [{ id: "run-2" }] })
  })

  it("returns an observable skip when idle admission reports a busy session", async () => {
    const sessionController = {
      list: vi.fn(async () => []),
      nudge: vi.fn(async () => ({ status: "not-idle" as const })),
      cancel: vi.fn(async () => ({ accepted: true as const, cursor: 1, stopped: true, clearedQueue: [] })),
    }
    const operations = createAutomationOperations({ store: storeMock(), actor: { workspaceId: "w", userId: "u" }, defaultAgentTypeId: "default", sessionController })

    await expect(operations.nudge!({ agentTypeId: "worker", sessionId: "session-1" }, "Continue")).resolves.toEqual({
      agentTypeId: "worker",
      sessionId: "session-1",
      skipped: "session-busy",
    })
  })

  it.each([
    Object.assign(new Error("session is not idle"), {
      code: "AGENT_COMMAND_INVALID_STATE",
      statusCode: 409,
      details: { status: "error" },
    }),
    Object.assign(new Error("session runtime binding is not currently published"), {
      code: "AGENT_COMMAND_INVALID_STATE",
      statusCode: 409,
    }),
  ])("preserves non-busy invalid-state failures from automation nudges", async (invalidState) => {
    const sessionController = {
      list: vi.fn(async () => []),
      nudge: vi.fn(async () => { throw invalidState }),
      cancel: vi.fn(async () => ({ accepted: true as const, cursor: 1, stopped: true, clearedQueue: [] })),
    }
    const operations = createAutomationOperations({ store: storeMock(), actor: { workspaceId: "w", userId: "u" }, defaultAgentTypeId: "default", sessionController })

    await expect(operations.nudge!({ agentTypeId: "worker", sessionId: "session-1" }, "Continue")).rejects.toBe(invalidState)
  })

  it("delivers a nudge to an idle session", async () => {
    const sessionController = {
      list: vi.fn(async () => []),
      nudge: vi.fn(async () => ({ status: "accepted" as const, receipt: {} as never })),
      cancel: vi.fn(async () => ({ accepted: true as const, cursor: 1, stopped: true, clearedQueue: [] })),
    }
    const operations = createAutomationOperations({ store: storeMock(), actor: { workspaceId: "w", userId: "u" }, defaultAgentTypeId: "default", sessionController })

    await expect(operations.nudge!({ agentTypeId: "worker", sessionId: "session-1" }, "Continue")).resolves.toEqual({
      agentTypeId: "worker",
      sessionId: "session-1",
      accepted: true,
    })
    expect(sessionController.nudge).toHaveBeenCalledWith("worker", "session-1", "Continue", expect.stringMatching(/^nudge:/))
  })

  it("reports cancel as skipped when the Agent confirms no session was stopped", async () => {
    const sessionController = {
      list: vi.fn(async () => []),
      nudge: vi.fn(async () => ({ status: "accepted" as const, receipt: {} as never })),
      cancel: vi.fn(async () => ({ accepted: true as const, cursor: 1, stopped: false, clearedQueue: [] })),
    }
    const operations = createAutomationOperations({ store: storeMock(), actor: { workspaceId: "w", userId: "u" }, sessionController })

    await expect(operations.cancel!({ agentTypeId: "worker", sessionId: "session-1" })).resolves.toEqual({
      agentTypeId: "worker",
      sessionId: "session-1",
      skipped: "session-not-running",
    })
  })

  it("rejects a colliding session id addressed to the wrong Agent", async () => {
    const operations = createAutomationOperations({
      store: storeMock(),
      actor: { workspaceId: "w", userId: "u" },
      sessionController: {
        list: vi.fn(async () => []),
        nudge: vi.fn(async () => ({ status: "accepted" as const, receipt: {} as never })),
        cancel: vi.fn(async () => ({ accepted: true as const, cursor: 1, stopped: true, clearedQueue: [] })),
      },
    })

    await expect(operations.cancel!({ agentTypeId: "other", sessionId: "session-1" }))
      .rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.SESSION_NOT_FOUND })
  })

  it("caps prompt results and reports the original character count", async () => {
    const prompt = "x".repeat(AUTOMATION_TOOL_PROMPT_CHARACTER_LIMIT + 17)
    const operations = createAutomationOperations({ store: storeMock({ getPrompt: vi.fn(async () => prompt) }), actor: { workspaceId: "w", userId: "u" } })

    const result = await operations.get("automation-1")

    expect(result.prompt.text).toHaveLength(AUTOMATION_TOOL_PROMPT_CHARACTER_LIMIT)
    expect(result.prompt.characterCount).toBe(prompt.length)
    expect(result.prompt.truncated).toBe(true)
    expect(result.automation).not.toHaveProperty("promptRef")
  })

  it("updates prompt and metadata through their canonical store operations", async () => {
    const store = storeMock()
    const operations = createAutomationOperations({ store, actor: { workspaceId: "w", userId: "u" } })

    await operations.update("automation-1", { title: "Updated", prompt: "new prompt" })

    expect(store.updatePrompt).toHaveBeenCalledWith("automation-1", "new prompt")
    expect(store.updateAutomation).toHaveBeenCalledWith("automation-1", { title: "Updated" })
    await expect(operations.update("automation-1", {})).rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.INVALID_BODY })
  })

  it("pauses and resumes using enabled-only metadata patches", async () => {
    const store = storeMock()
    const operations = createAutomationOperations({ store, actor: { workspaceId: "w", userId: "u" } })

    await operations.pause("automation-1")
    await operations.resume("automation-1")

    expect(store.updateAutomation).toHaveBeenNthCalledWith(1, "automation-1", { enabled: false })
    expect(store.updateAutomation).toHaveBeenNthCalledWith(2, "automation-1", { enabled: true })
  })

  it("deletes metadata only and returns stable identifying details", async () => {
    const store = storeMock()
    const operations = createAutomationOperations({ store, actor: { workspaceId: "w", userId: "u" } })

    await expect(operations.delete("automation-1")).resolves.toEqual({ automationId: "automation-1", title: "Daily summary" })
    expect(store.deleteAutomation).toHaveBeenCalledWith("automation-1")
    expect(store.updatePrompt).not.toHaveBeenCalled()
  })

  it("durably admits a detached dispatch as the bound actor without awaiting its worker", async () => {
    const queued = run({ status: "dispatching", trigger: "manual", sessionId: null, startedAt: null, completedAt: null })
    const executor = { start: vi.fn(async () => queued) }
    const actor = { workspaceId: "workspace-1", userId: "user-1" }
    const operations = createAutomationOperations({ store: storeMock(), actor, executor })

    const result = await operations.run("automation-1")

    expect(executor.start).toHaveBeenCalledWith({ automationId: "automation-1", actor, trigger: "manual" })
    expect(result).toMatchObject({ status: "dispatching", trigger: "manual", sessionId: null })
    expect(result).not.toHaveProperty("promptSnapshot")
    expect(result).not.toHaveProperty("modelSnapshot")
  })

  it("fails run before storage mutation when no executor is bound", async () => {
    const store = storeMock()
    const operations = createAutomationOperations({ store, actor: { workspaceId: "w", userId: "u" } })

    await expect(operations.run("automation-1")).rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE })
    expect(store.beginRun).not.toHaveBeenCalled()
  })

  it("bounds and sanitizes run history without snapshots", async () => {
    const runs = [run({ id: "r1" }), run({ id: "r2", error: "first line\nsecret" })]
    const operations = createAutomationOperations({ store: storeMock({ listRuns: vi.fn(async () => runs) }), actor: { workspaceId: "w", userId: "u" } })

    const result = await operations.listRuns("automation-1", 1)

    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).not.toHaveProperty("promptSnapshot")
    expect(result.items[0]).not.toHaveProperty("modelSnapshot")
  })

  it("preserves store not-found errors", async () => {
    const operations = createAutomationOperations({ store: storeMock(), actor: { workspaceId: "w", userId: "u" } })
    await expect(operations.get("missing")).rejects.toBeInstanceOf(AutomationStoreError)
    await expect(operations.get("missing")).rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND })
  })
})
