import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FileAutomationStore } from "../fileStore"
import { runFileAutomationStoreBehaviorTests } from "./automationStoreConformance"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boring-automation-store-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("FileAutomationStore behavior", () => {
  runFileAutomationStoreBehaviorTests(() => new FileAutomationStore(dir))
})

describe("FileAutomationStore persistence", () => {
  it("persists single-workspace automations, prompts, and runs in the .pi automation layout", async () => {
    const store = new FileAutomationStore(dir)
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "# Prompt\n",
    })
    const run = await store.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "# Prompt\n",
      modelSnapshot: "model-a",
      scheduledFor: "2026-07-09T09:00:00.000Z",
    })

    const reloaded = new FileAutomationStore(dir)
    await expect(reloaded.getAutomation(automation.id)).resolves.toMatchObject({ id: automation.id })
    await expect(reloaded.getPrompt(automation.id)).resolves.toBe("# Prompt\n")
    await expect(reloaded.listRuns(automation.id)).resolves.toEqual([expect.objectContaining({ id: run.id })])

    const raw = JSON.parse(await readFile(join(dir, "store.json"), "utf8"))
    expect(raw.automations[automation.id]).toMatchObject({ promptRef: `.pi/automation/prompts/${automation.id}.md` })
    expect(raw.automations[automation.id]).not.toHaveProperty("workspaceId")
    expect(raw.runs[run.id]).toMatchObject({
      sessionId: null,
      scheduledFor: "2026-07-09T09:00:00.000Z",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      error: null,
    })
    expect(raw.runs[run.id]).not.toHaveProperty("workspaceId")
    expect(raw.runs[run.id]).not.toHaveProperty("cronSnapshot")
    expect(raw.runs[run.id]).not.toHaveProperty("timezoneSnapshot")
    await expect(readFile(join(dir, "prompts", `${automation.id}.md`), "utf8")).resolves.toBe("# Prompt\n")
  })

  it("deletes metadata while preserving prompt Markdown and run records", async () => {
    const store = new FileAutomationStore(dir)
    const automation = await store.createAutomation({
      title: "Disposable", cron: "0 9 * * *", timezone: "UTC", model: "test:model", prompt: "keep me",
    })
    const run = await store.beginRun({
      automationId: automation.id, trigger: "manual", promptSnapshot: "keep me", modelSnapshot: "test:model",
    })

    await store.deleteAutomation(automation.id)

    await expect(store.getAutomation(automation.id)).resolves.toBeNull()
    await expect(readFile(join(dir, "prompts", `${automation.id}.md`), "utf8")).resolves.toBe("keep me")
    const raw = JSON.parse(await readFile(join(dir, "store.json"), "utf8"))
    expect(raw.automations).not.toHaveProperty(automation.id)
    expect(raw.runs).toHaveProperty(run.id)
  })

  it("reconciles persisted active runs after host restart before admitting a new run", async () => {
    const firstStore = new FileAutomationStore(dir, { clock: () => new Date("2026-07-10T00:00:00.000Z") })
    const automation = await firstStore.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "test:gpt-5.5",
    })
    const orphan = await firstStore.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "test:gpt-5.5",
    })
    await firstStore.updateRunLifecycle(orphan.id, { status: "running", startedAt: "2026-07-10T00:00:01.000Z" })

    const restartedStore = new FileAutomationStore(dir, { clock: () => new Date("2026-07-10T00:10:00.000Z") })
    const replacement = await restartedStore.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "test:gpt-5.5",
    })
    const runs = await restartedStore.listRuns(automation.id)

    expect(replacement.status).toBe("queued")
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: orphan.id, status: "failed", completedAt: "2026-07-10T00:10:00.000Z", durationMs: 599_000, error: "Automation host restarted before the run completed" }),
      expect.objectContaining({ id: replacement.id, status: "queued" }),
    ]))
  })

  it("leaves a recoverable orphan prompt and unchanged live cache when the metadata commit fails", async () => {
    const store = new FileAutomationStore(dir, {
      writer: async (path, content) => {
        if (path === join(dir, "store.json")) throw new Error("injected metadata failure")
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, "utf8")
      },
    })

    await expect(store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "orphaned prompt",
    })).rejects.toThrow("injected metadata failure")

    const promptFiles = await readdir(join(dir, "prompts"))
    expect(promptFiles).toHaveLength(1)
    await expect(readFile(join(dir, "prompts", promptFiles[0]!), "utf8")).resolves.toBe("orphaned prompt")
    await expect(readFile(join(dir, "store.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(store.listAutomations()).resolves.toEqual([])
    await expect(new FileAutomationStore(dir).listAutomations()).resolves.toEqual([])
  })

  it("loads a missing prompt as empty and repairs it through updatePrompt", async () => {
    const store = new FileAutomationStore(dir)
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "initial",
    })
    const promptPath = join(dir, "prompts", `${automation.id}.md`)
    await unlink(promptPath)

    const reloaded = new FileAutomationStore(dir)
    await expect(reloaded.getPrompt(automation.id)).resolves.toBe("")
    await reloaded.updatePrompt(automation.id, "repaired")
    await expect(reloaded.getPrompt(automation.id)).resolves.toBe("repaired")
    await expect(readFile(promptPath, "utf8")).resolves.toBe("repaired")
  })
})
