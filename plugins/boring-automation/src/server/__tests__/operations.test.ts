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
    updateAutomation: vi.fn(async (_id, patch) => automation(patch)),
    deleteAutomation: vi.fn(async () => {}),
    getPrompt: vi.fn(async () => "prompt"),
    updatePrompt: vi.fn(async () => {}),
    updatePromptIfCurrent: vi.fn(async () => current),
    reconcileOrphanedRuns: vi.fn(async () => {}),
    beginRun: vi.fn(async () => run()),
    updateRunLifecycle: vi.fn(async () => run()),
    listRuns: vi.fn(async () => [run()]),
    ...overrides,
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

  it("runs as the bound actor and returns a safe finalized run, including failed outcomes", async () => {
    const failed = run({ status: "failed", error: `provider failed ${"x".repeat(500)}\nsecret second line` })
    const executor = { run: vi.fn(async () => failed) }
    const actor = { workspaceId: "workspace-1", userId: "user-1" }
    const operations = createAutomationOperations({ store: storeMock(), actor, executor })

    const result = await operations.run("automation-1")

    expect(executor.run).toHaveBeenCalledWith({ automationId: "automation-1", actor })
    expect(result.status).toBe("failed")
    expect(result.error).toHaveLength(AUTOMATION_TOOL_ERROR_CHARACTER_LIMIT)
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
