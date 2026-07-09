import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FileAutomationStore } from "../fileStore"
import { runAutomationStoreConformance } from "./automationStoreConformance"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boring-automation-store-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("FileAutomationStore conformance", () => {
  runAutomationStoreConformance(() => new FileAutomationStore(dir))
})

describe("FileAutomationStore persistence", () => {
  it("persists automations, prompts, and runs in the workspace .pi automation layout", async () => {
    const store = new FileAutomationStore(dir)
    const automation = await store.createAutomation({ workspaceId: "default" }, {
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "# Prompt\n",
    })
    const run = await store.createRun({ workspaceId: "default" }, {
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "# Prompt\n",
      modelSnapshot: "model-a",
      cronSnapshot: automation.cron,
      timezoneSnapshot: automation.timezone,
    })

    const reloaded = new FileAutomationStore(dir)
    await expect(reloaded.getAutomation({ workspaceId: "default" }, automation.id)).resolves.toMatchObject({ id: automation.id })
    await expect(reloaded.getPrompt({ workspaceId: "default" }, automation.id)).resolves.toBe("# Prompt\n")
    await expect(reloaded.listRuns({ workspaceId: "default" }, automation.id)).resolves.toEqual([expect.objectContaining({ id: run.id })])

    const raw = JSON.parse(await readFile(join(dir, "store.json"), "utf8"))
    expect(raw.automations[automation.id]).toMatchObject({ promptRef: `prompts/${automation.id}.md` })
    await expect(readFile(join(dir, "prompts", `${automation.id}.md`), "utf8")).resolves.toBe("# Prompt\n")
  })
})
