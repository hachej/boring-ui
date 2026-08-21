import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFactoryAutomationSeedProvider } from "@hachej/boring-agent/server"
import { FileAutomationStore, type FileAutomationStoreOptions } from "../fileStore"
import { runFileAutomationStoreBehaviorTests } from "./automationStoreConformance"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boring-automation-store-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function createStore(options: FileAutomationStoreOptions = {}): FileAutomationStore {
  return new FileAutomationStore(dir, options)
}

function metadataPath(...parts: string[]): string {
  return join(dir, ".pi", "automation", ...parts)
}

function promptPath(automationId: string): string {
  return join(dir, ".agents", "automation", `${automationId}.md`)
}

describe("FileAutomationStore behavior", () => {
  runFileAutomationStoreBehaviorTests(() => createStore())
})

describe("FileAutomationStore persistence", () => {
  it("persists metadata separately from canonical workspace prompt files", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      agentTypeId: "researcher",
      prompt: "# Prompt\n",
    })
    const run = await store.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "# Prompt\n",
      modelSnapshot: "model-a",
      scheduledFor: "2026-07-09T09:00:00.000Z",
    })

    const reloaded = createStore()
    await expect(reloaded.getAutomation(automation.id)).resolves.toMatchObject({ id: automation.id, agentTypeId: "researcher" })
    await expect(reloaded.getPrompt(automation.id)).resolves.toBe("# Prompt\n")
    await expect(reloaded.listRuns(automation.id)).resolves.toEqual([expect.objectContaining({ id: run.id })])

    const raw = JSON.parse(await readFile(metadataPath("store.json"), "utf8"))
    expect(raw.automations[automation.id]).toMatchObject({ promptRef: `.agents/automation/${automation.id}.md` })
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
    await expect(readFile(promptPath(automation.id), "utf8")).resolves.toBe("# Prompt\n")
  })

  it("deletes metadata while preserving prompt Markdown and run records", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Disposable", cron: "0 9 * * *", timezone: "UTC", model: "test:model", prompt: "keep me",
    })
    const run = await store.beginRun({
      automationId: automation.id, trigger: "manual", promptSnapshot: "keep me", modelSnapshot: "test:model",
    })

    await store.deleteAutomation(automation.id)

    await expect(store.getAutomation(automation.id)).resolves.toBeNull()
    await expect(readFile(promptPath(automation.id), "utf8")).resolves.toBe("keep me")
    const raw = JSON.parse(await readFile(metadataPath("store.json"), "utf8"))
    expect(raw.automations).not.toHaveProperty(automation.id)
    expect(raw.runs).toHaveProperty(run.id)
  })

  it("reconciles persisted active runs after host restart before admitting a new run", async () => {
    const firstStore = createStore({ clock: () => new Date("2026-07-10T00:00:00.000Z") })
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

    const restartedStore = createStore({ clock: () => new Date("2026-07-10T00:10:00.000Z") })
    await expect(restartedStore.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "test:gpt-5.5",
    })).rejects.toMatchObject({ code: "BORING_AUTOMATION_RUN_ALREADY_ACTIVE" })
    const runs = await restartedStore.listRuns(automation.id)

    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: orphan.id, status: "outcome-unknown", completedAt: "2026-07-10T00:10:00.000Z", durationMs: 599_000, error: "Automation dispatch outcome is unknown after host restart; the slot remains occupied" }),
    ]))

    await restartedStore.reconcileOrphanedRuns(automation.id)
    await expect(restartedStore.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "replacement",
      modelSnapshot: "test:gpt-5.5",
    })).resolves.toMatchObject({ status: "queued" })
    await expect(restartedStore.listRuns(automation.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: orphan.id,
        status: "failed",
        error: "Automation outcome remained unknown after host restart; releasing the occupied slot",
      }),
    ]))
  })

  it("allows only one dispatcher to claim a queued run", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Claim once", cron: "0 9 * * *", timezone: "UTC", model: "test:model", prompt: "run",
    })
    const run = await store.beginRun({
      automationId: automation.id,
      invocationId: "scheduled:claim-once",
      trigger: "scheduled",
      scheduledFor: "2026-07-10T09:00:00.000Z",
      promptSnapshot: "run",
      modelSnapshot: "test:model",
    })

    const claims = await Promise.all([
      store.claimRunForDispatch(run.id),
      store.claimRunForDispatch(run.id),
    ])

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
    await expect(store.listRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({ id: run.id, status: "dispatching" }),
    ])
  })

  it("leaves a recoverable orphan prompt and unchanged live cache when the metadata commit fails", async () => {
    const store = createStore({
      writer: async (path, content) => {
        if (path === metadataPath("store.json")) throw new Error("injected metadata failure")
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

    const promptFiles = await readdir(join(dir, ".agents", "automation"))
    expect(promptFiles).toHaveLength(1)
    await expect(readFile(join(dir, ".agents", "automation", promptFiles[0]!), "utf8")).resolves.toBe("orphaned prompt")
    await expect(readFile(metadataPath("store.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(store.listAutomations()).resolves.toEqual([])
    await expect(createStore().listAutomations()).resolves.toEqual([])
  })

  it("loads a missing prompt as empty and repairs it through updatePrompt", async () => {
    const store = createStore()
    const automation = await store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "model-a",
      prompt: "initial",
    })
    const path = promptPath(automation.id)
    await unlink(path)

    const reloaded = createStore()
    await expect(reloaded.getPrompt(automation.id)).resolves.toBe("")
    await reloaded.updatePrompt(automation.id, "repaired")
    await expect(reloaded.getPrompt(automation.id)).resolves.toBe("repaired")
    await expect(readFile(path, "utf8")).resolves.toBe("repaired")
  })

})

describe("standing factory automation seeding", () => {
  const workerSeeds = [1, 2, 3].map((slot) => ({ key: `worker-slot-${slot}`, title: `worker-slot-${slot}`, enabled: true, cron: null, timezone: "UTC", model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-worker", promptRef: ".agents/automation/worker-slot.md" }))
  const triageSeed = { key: "triage", title: "triage", enabled: true, cron: null, timezone: "UTC", model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-worker", promptRef: ".agents/automation/triage-slot.md" }

  async function writeSeedFiles() {
    await mkdir(join(dir, ".agents", "automation"), { recursive: true })
    await writeFile(join(dir, ".agents", "automation", "manifest.json"), JSON.stringify({ automations: [
      { key: "orchestrator-tick", title: "orchestrator-tick", enabled: true, cron: "*/10 * * * *", timezone: "UTC", model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-orchestrator", promptRef: ".agents/automation/orchestrator-tick.md" },
    ] }), "utf8")
    await Promise.all([
      writeFile(join(dir, ".agents", "automation", "orchestrator-tick.md"), "orchestrator prompt", "utf8"),
      writeFile(join(dir, ".agents", "automation", "worker-slot.md"), "worker prompt", "utf8"),
      writeFile(join(dir, ".agents", "automation", "triage-slot.md"), "triage prompt", "utf8"),
    ])
  }

  it("merges exactly the generic injected seeds with the manifest and remains idempotent", async () => {
    const { seedStandingAutomations } = await import("../standingAutomations")
    await writeSeedFiles()
    const additionalSeeds = [...workerSeeds, triageSeed]
    await seedStandingAutomations(createStore(), { additionalSeeds })
    await seedStandingAutomations(createStore(), { additionalSeeds })

    const store = createStore()
    const automations = await store.listAutomations()
    expect(automations.map(({ id }) => id).sort()).toEqual([
      "orchestrator-tick", "triage", "worker-slot-1", "worker-slot-2", "worker-slot-3",
    ])
    expect(automations.find(({ id }) => id === "orchestrator-tick")).toMatchObject({
      cron: "*/10 * * * *", promptRef: ".agents/automation/orchestrator-tick.md", agentTypeId: "boring-orchestrator",
    })
    for (const id of ["worker-slot-1", "worker-slot-2", "worker-slot-3"]) {
      expect(automations.find((automation) => automation.id === id)).toMatchObject({
        cron: null, promptRef: ".agents/automation/worker-slot.md", agentTypeId: "boring-worker",
      })
      await expect(store.getPrompt(id)).resolves.toBe("worker prompt")
    }
    await expect(store.getPrompt("triage")).resolves.toBe("triage prompt")
  })

  it("persists policy growth from 3 to 5 with manifest, worker slots, and triage end to end", async () => {
    const { seedStandingAutomations } = await import("../standingAutomations")
    await writeSeedFiles()
    await mkdir(join(dir, ".agents", "factory"), { recursive: true })
    await writeFile(join(dir, ".agents", "factory", "policy.yaml"), "beadle:\n  worker_cap: 3\n", "utf8")
    await seedStandingAutomations(createStore(), {
      seedProvider: createFactoryAutomationSeedProvider({ policyRoot: dir }),
    })
    await writeFile(join(dir, ".agents", "factory", "policy.yaml"), "beadle:\n  worker_cap: 5\n", "utf8")
    await seedStandingAutomations(createStore(), {
      seedProvider: createFactoryAutomationSeedProvider({ policyRoot: dir }),
    })
    expect((await createStore().listAutomations()).map(({ id }) => id).sort()).toEqual([
      "orchestrator-tick", "triage", "worker-slot-1", "worker-slot-2", "worker-slot-3", "worker-slot-4", "worker-slot-5",
    ])
  })

  it("validates injected seeds with the manifest seed schema", async () => {
    const { seedStandingAutomations } = await import("../standingAutomations")
    await writeSeedFiles()
    await expect(seedStandingAutomations(createStore(), {
      additionalSeeds: [{ ...triageSeed, timezone: "not/a-zone" }],
    })).rejects.toThrow()
  })

  it("keeps a surplus seeded slot when its run is active", async () => {
    const { seedStandingAutomations } = await import("../standingAutomations")
    await writeSeedFiles()
    const store = createStore()
    await seedStandingAutomations(store, { additionalSeeds: [...workerSeeds, triageSeed] })
    await store.updateAutomation("worker-slot-3", { title: "renamed-active-worker" })
    await store.beginRun({
      automationId: "worker-slot-3", trigger: "manual", scheduledFor: null,
      promptSnapshot: "worker", modelSnapshot: "openai-codex:gpt-5.6-sol",
    })
    await mkdir(join(dir, ".agents", "factory"), { recursive: true })
    await writeFile(join(dir, ".agents", "factory", "policy.yaml"), "beadle:\n  worker_cap: 2\n", "utf8")
    const warn = vi.fn()
    await seedStandingAutomations(store, {
      seedProvider: createFactoryAutomationSeedProvider({ policyRoot: dir, warn }),
    })
    expect((await store.listAutomations()).map(({ id }) => id).sort()).toContain("worker-slot-3")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("active run"))
  })

  it("retains surplus seeds without the atomic immutable-key store contract", async () => {
    const { seedStandingAutomations } = await import("../standingAutomations")
    await writeSeedFiles()
    const store = createStore()
    await seedStandingAutomations(store, { additionalSeeds: [
      ...workerSeeds,
      { ...workerSeeds[2]!, key: "worker-slot-4", title: "worker-slot-4" },
      triageSeed,
    ] })
    Object.defineProperties(store, {
      findExistingSeedKeys: { value: undefined },
      removeSeededAutomationIfIdle: { value: undefined },
    })
    const deleteAutomation = vi.spyOn(store, "deleteAutomation")
    await mkdir(join(dir, ".agents", "factory"), { recursive: true })
    await writeFile(join(dir, ".agents", "factory", "policy.yaml"), "beadle:\n  worker_cap: 3\n", "utf8")
    const warn = vi.fn()

    await seedStandingAutomations(store, {
      seedProvider: createFactoryAutomationSeedProvider({ policyRoot: dir, warn }),
    })

    expect(deleteAutomation).not.toHaveBeenCalled()
    expect((await store.listAutomations()).map(({ id }) => id)).toContain("worker-slot-4")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("immutable seed keys"))
  })

  it("does not prune an unrelated automation whose mutable title collides with a surplus slot key", async () => {
    const { seedStandingAutomations } = await import("../standingAutomations")
    await writeSeedFiles()
    const store = createStore()
    const unrelated = await store.createAutomation({
      title: "worker-slot-4",
      timezone: "UTC",
      model: "openai-codex:gpt-5.6-sol",
      agentTypeId: "boring-worker",
    })
    await mkdir(join(dir, ".agents", "factory"), { recursive: true })
    await writeFile(join(dir, ".agents", "factory", "policy.yaml"), "beadle:\n  worker_cap: 3\n", "utf8")

    await seedStandingAutomations(store, {
      seedProvider: createFactoryAutomationSeedProvider({ policyRoot: dir }),
    })

    await expect(store.getAutomation(unrelated.id)).resolves.toMatchObject({ title: "worker-slot-4" })
  })
})
