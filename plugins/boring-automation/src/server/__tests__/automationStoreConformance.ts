import type { AutomationStore } from "../store"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"

export function runAutomationStoreConformance(createStore: () => AutomationStore) {
  const ctx = { workspaceId: "workspace-a" }

  it("creates, lists, updates, and reloads automations", async () => {
    const store = createStore()
    const created = await store.createAutomation(ctx, {
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
      workspaceId: "workspace-a",
    })
    expect(created.promptRef).toBe(`prompts/${created.id}.md`)
    await expect(store.getPrompt(ctx, created.id)).resolves.toBe("Summarize the repo.")

    await expect(store.listAutomations(ctx)).resolves.toHaveLength(1)
    await expect(store.updateAutomation(ctx, created.id, { enabled: false, title: "Morning summary" })).resolves.toMatchObject({
      id: created.id,
      enabled: false,
      title: "Morning summary",
    })
  })

  it("updates prompt bodies without changing automation metadata shape", async () => {
    const store = createStore()
    const automation = await store.createAutomation(ctx, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "initial",
    })

    await store.updatePrompt(ctx, automation.id, "updated\nmarkdown")
    await expect(store.getPrompt(ctx, automation.id)).resolves.toBe("updated\nmarkdown")
    await expect(store.getAutomation(ctx, automation.id)).resolves.toMatchObject({ id: automation.id, promptRef: automation.promptRef })
  })

  it("creates, updates, lists, and finds run metadata", async () => {
    const store = createStore()
    const automation = await store.createAutomation(ctx, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })

    const run = await store.createRun(ctx, {
      automationId: automation.id,
      trigger: "manual",
      status: "running",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: automation.cron,
      timezoneSnapshot: automation.timezone,
      startedAt: "2026-07-09T09:00:00.000Z",
    })

    await expect(store.findRunningRun(ctx, automation.id)).resolves.toMatchObject({ id: run.id, status: "running" })
    await expect(store.updateRun(ctx, run.id, {
      status: "succeeded",
      completedAt: "2026-07-09T09:01:00.000Z",
      durationMs: 60_000,
      totalTokens: 123,
    })).resolves.toMatchObject({ status: "succeeded", durationMs: 60_000, totalTokens: 123 })
    await expect(store.findRunningRun(ctx, automation.id)).resolves.toBeNull()
    await expect(store.listRuns(ctx, automation.id)).resolves.toEqual([expect.objectContaining({ id: run.id })])
  })

  it("enforces workspace scoping for automations and runs", async () => {
    const store = createStore()
    const automation = await store.createAutomation(ctx, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
    })
    const run = await store.createRun(ctx, {
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: automation.cron,
      timezoneSnapshot: automation.timezone,
    })

    await expect(store.getAutomation({ workspaceId: "workspace-b" }, automation.id)).resolves.toBeNull()
    await expect(store.updateAutomation({ workspaceId: "workspace-b" }, automation.id, { title: "Nope" })).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND,
    })
    await expect(store.updateRun({ workspaceId: "workspace-b" }, run.id, { status: "failed" })).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND,
    })
    await expect(store.listRuns({ workspaceId: "workspace-b" }, automation.id)).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND,
    })
  })

  it("fails closed when workspace context is missing", async () => {
    const store = createStore()
    const automation = await store.createAutomation(ctx, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
    })
    const run = await store.createRun(ctx, {
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: automation.cron,
      timezoneSnapshot: automation.timezone,
    })

    await expect(store.getAutomation({}, automation.id)).resolves.toBeNull()
    await expect(store.listAutomations({})).resolves.toEqual([])
    await expect(store.listRuns({}, automation.id)).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND,
    })
    await expect(store.updateRun({}, run.id, { status: "failed" })).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND,
    })
  })

  it("clears nullable run fields", async () => {
    const store = createStore()
    const automation = await store.createAutomation(ctx, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
    })
    const run = await store.createRun(ctx, {
      automationId: automation.id,
      trigger: "manual",
      sessionId: "session-1",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: automation.cron,
      timezoneSnapshot: automation.timezone,
      totalTokens: 10,
    })

    await expect(store.updateRun(ctx, run.id, { sessionId: null, totalTokens: null })).resolves.not.toHaveProperty("sessionId")
    await expect(store.updateRun(ctx, run.id, { error: "failed" })).resolves.toMatchObject({ error: "failed" })
    await expect(store.updateRun(ctx, run.id, { error: null })).resolves.not.toHaveProperty("error")
  })

  it("deletes automation metadata but leaves run metadata inaccessible through the deleted automation", async () => {
    const store = createStore()
    const automation = await store.createAutomation(ctx, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "prompt",
    })
    await store.createRun(ctx, {
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: automation.cron,
      timezoneSnapshot: automation.timezone,
    })

    await store.deleteAutomation(ctx, automation.id)
    await expect(store.getAutomation(ctx, automation.id)).resolves.toBeNull()
    await expect(store.listRuns(ctx, automation.id)).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND,
    })
  })
}
