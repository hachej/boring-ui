import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"
import type { FileAutomationStore } from "../fileStore"

/** Shared setup for concrete FileAutomationStore behavior tests. */
export function runFileAutomationStoreBehaviorTests(createStore: () => FileAutomationStore) {
  it("creates, lists, and updates automations", async () => {
    const store = createStore()
    const created = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "Europe/Paris",
      model: "anthropic/claude-sonnet-4",
      prompt: "Summarize the repo.",
    })

    expect(created).toMatchObject({
      title: "Daily summary",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "Europe/Paris",
      model: "anthropic/claude-sonnet-4",
    })
    expect(created).not.toHaveProperty("workspaceId")
    expect(created.promptRef).toBe(`prompts/${created.id}.md`)
    await expect(store.getPrompt(created.id)).resolves.toBe("Summarize the repo.")

    await expect(store.listAutomations()).resolves.toHaveLength(1)
    await expect(store.updateAutomation(created.id, { enabled: false, title: "Morning summary" })).resolves.toMatchObject({
      id: created.id,
      enabled: false,
      title: "Morning summary",
    })
  })

  it("updates canonical prompt bodies", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "initial",
    })

    await store.updatePrompt(automation.id, "updated\nmarkdown")
    await expect(store.getPrompt(automation.id)).resolves.toBe("updated\nmarkdown")
    await expect(store.getAutomation(automation.id)).resolves.toMatchObject({ id: automation.id, promptRef: automation.promptRef })
  })

  it("creates, updates, lists, and finds run metadata", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })

    const run = await store.createRun({
      automationId: automation.id,
      trigger: "manual",
      status: "running",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      startedAt: "2026-07-09T09:00:00.000Z",
    })

    expect(run).not.toHaveProperty("workspaceId")
    expect(run).not.toHaveProperty("cronSnapshot")
    expect(run).not.toHaveProperty("timezoneSnapshot")
    await expect(store.findRunningRun(automation.id)).resolves.toMatchObject({ id: run.id, status: "running" })
    await expect(store.updateRun(run.id, {
      status: "succeeded",
      completedAt: "2026-07-09T09:01:00.000Z",
      durationMs: 60_000,
      totalTokens: 123,
    })).resolves.toMatchObject({ status: "succeeded", durationMs: 60_000, totalTokens: 123 })
    await expect(store.findRunningRun(automation.id)).resolves.toBeNull()
    await expect(store.listRuns(automation.id)).resolves.toEqual([expect.objectContaining({ id: run.id })])
  })

  it("persists every nullable run field as explicit null", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
    })
    const run = await store.createRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
    })

    expect(run).toMatchObject({
      sessionId: null,
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      error: null,
    })
    await expect(store.updateRun(run.id, { sessionId: "session-1", totalTokens: 10, error: "failed" })).resolves.toMatchObject({
      sessionId: "session-1",
      totalTokens: 10,
      error: "failed",
    })
    await expect(store.updateRun(run.id, { sessionId: null, totalTokens: null, error: null })).resolves.toMatchObject({
      sessionId: null,
      totalTokens: null,
      error: null,
    })
  })

  it("deletes automation metadata but leaves run metadata inaccessible through the deleted automation", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })
    await store.createRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
    })

    await store.deleteAutomation(automation.id)
    await expect(store.getAutomation(automation.id)).resolves.toBeNull()
    await expect(store.listRuns(automation.id)).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND,
    })
  })
}
