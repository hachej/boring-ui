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
    expect(created.promptRef).toBe(`.pi/automation/prompts/${created.id}.md`)
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

  it("begins, updates, and lists run metadata", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })

    const run = await store.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      createdAt: "2026-07-09T09:00:00.000Z",
    })

    expect(run).toMatchObject({ status: "queued", startedAt: null })
    expect(run).not.toHaveProperty("workspaceId")
    expect(run).not.toHaveProperty("cronSnapshot")
    expect(run).not.toHaveProperty("timezoneSnapshot")
    await expect(store.updateRunLifecycle(run.id, {
      status: "running",
      startedAt: "2026-07-09T09:00:01.000Z",
      sessionId: "session-1",
    })).resolves.toMatchObject({ status: "running", startedAt: "2026-07-09T09:00:01.000Z", sessionId: "session-1" })
    await expect(store.updateRunLifecycle(run.id, {
      status: "succeeded",
      completedAt: "2026-07-09T09:01:00.000Z",
      durationMs: 59_000,
      totalTokens: 123,
    })).resolves.toMatchObject({ status: "succeeded", durationMs: 59_000, totalTokens: 123 })
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
    const run = await store.beginRun({
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
    await expect(store.updateRunLifecycle(run.id, { sessionId: "session-1", totalTokens: 10, error: "failed" })).resolves.toMatchObject({
      sessionId: "session-1",
      totalTokens: 10,
      error: "failed",
    })
    await expect(store.updateRunLifecycle(run.id, { sessionId: null, totalTokens: null, error: null })).resolves.toMatchObject({
      sessionId: null,
      totalTokens: null,
      error: null,
    })
  })

  it("admits one active run per automation atomically", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })

    const attempts = await Promise.allSettled([
      store.beginRun({ automationId: automation.id, trigger: "manual", promptSnapshot: "prompt-1", modelSnapshot: "model-a" }),
      store.beginRun({ automationId: automation.id, trigger: "manual", promptSnapshot: "prompt-2", modelSnapshot: "model-a" }),
    ])

    const fulfilled = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.beginRun>>> => result.status === "fulfilled")
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE })
    await expect(store.listRuns(automation.id)).resolves.toHaveLength(1)
  })

  it("atomically records each scheduled occurrence at most once", async () => {
    const store = createStore()
    const automation = await store.createAutomation({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "test:model" })
    const scheduledFor = "2026-07-10T09:00:00.000Z"
    const first = await store.beginRun({
      automationId: automation.id,
      trigger: "scheduled",
      scheduledFor,
      promptSnapshot: "prompt",
      modelSnapshot: "test:model",
    })
    await store.updateRunLifecycle(first.id, { status: "succeeded", completedAt: "2026-07-10T09:01:00.000Z" })

    await expect(store.beginRun({
      automationId: automation.id,
      trigger: "scheduled",
      scheduledFor,
      promptSnapshot: "prompt",
      modelSnapshot: "test:model",
    })).rejects.toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED })
    await expect(store.beginRun({
      automationId: automation.id,
      trigger: "scheduled",
      scheduledFor: "2026-07-11T09:00:00.000Z",
      promptSnapshot: "prompt",
      modelSnapshot: "test:model",
    })).resolves.toMatchObject({ trigger: "scheduled", scheduledFor: "2026-07-11T09:00:00.000Z" })
  })

  it("allows active runs for different automations and readmits after terminal status", async () => {
    const store = createStore()
    const first = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })
    const second = await store.createAutomation({
      title: "Weekly summary",
      cron: "0 9 * * 1",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })

    const [firstRun, secondRun] = await Promise.all([
      store.beginRun({ automationId: first.id, trigger: "manual", promptSnapshot: "prompt", modelSnapshot: "model-a" }),
      store.beginRun({ automationId: second.id, trigger: "manual", promptSnapshot: "prompt", modelSnapshot: "model-a" }),
    ])
    expect(firstRun.automationId).toBe(first.id)
    expect(secondRun.automationId).toBe(second.id)

    await store.updateRunLifecycle(firstRun.id, { status: "succeeded", completedAt: "2026-07-09T09:01:00.000Z", durationMs: 60_000 })
    await expect(store.beginRun({ automationId: first.id, trigger: "manual", promptSnapshot: "again", modelSnapshot: "model-a" }))
      .resolves.toMatchObject({ automationId: first.id, status: "queued" })
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
    await store.beginRun({
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
