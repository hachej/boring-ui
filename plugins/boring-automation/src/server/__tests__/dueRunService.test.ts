import type { FastifyRequest } from "fastify"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { Automation, AutomationRun } from "../../shared"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"
import { DueRunService } from "../dueRunService"
import { FileAutomationStore } from "../fileStore"
import { AutomationStoreError, type AutomationStore } from "../store"

const NOW = new Date("2026-07-10T09:00:20.000Z")

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    title: "Daily",
    enabled: true,
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "test:model",
    promptRef: "prompts/auto-1.md",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function completedRun(): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    sessionId: "session-1",
    status: "succeeded",
    trigger: "scheduled",
    scheduledFor: "2026-07-10T09:00:00.000Z",
    startedAt: "2026-07-10T09:00:01.000Z",
    completedAt: "2026-07-10T09:00:05.000Z",
    durationMs: 4_000,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    promptSnapshot: "prompt",
    modelSnapshot: "test:model",
    error: null,
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-10T09:00:05.000Z",
  }
}

function storeFor(automations: Automation[], runs: AutomationRun[] = []): AutomationStore {
  return {
    listAutomations: vi.fn(async () => automations),
    reconcileOrphanedRuns: vi.fn(async () => undefined),
    listRuns: vi.fn(async (automationId) => runs.filter((run) => run.automationId === automationId)),
  } as unknown as AutomationStore
}

function request(): FastifyRequest {
  return { ip: "127.0.0.1" } as unknown as FastifyRequest
}

describe("DueRunService", () => {
  it("executes due automations sequentially with the scheduled occurrence", async () => {
    const first = automation({ id: "b" })
    const second = automation({ id: "a" })
    const execute = vi.fn(async (input: { automationId: string; scheduledFor?: string | null }) => ({
      ...completedRun(),
      id: `run-${input.automationId}`,
      automationId: input.automationId,
      scheduledFor: input.scheduledFor ?? null,
    }))
    const service = new DueRunService({ store: storeFor([first, second]), executor: { run: execute } as never, clock: () => NOW })

    const result = await service.runDue(request())

    expect(execute.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ automationId: "a", trigger: "scheduled", scheduledFor: "2026-07-10T09:00:00.000Z" }),
      expect.objectContaining({ automationId: "b", trigger: "scheduled", scheduledFor: "2026-07-10T09:00:00.000Z" }),
    ])
    expect(result.outcomes.map((outcome) => outcome.automationId)).toEqual(["a", "b"])
    expect(result.outcomes.every((outcome) => outcome.kind === "started")).toBe(true)
  })

  it("does not execute disabled, non-current, duplicate, or active decisions", async () => {
    const execute = vi.fn()
    const duplicate = completedRun()
    const active = { ...completedRun(), id: "run-active", automationId: "active", status: "running" as const, scheduledFor: null, completedAt: null }
    const service = new DueRunService({
      store: storeFor([
        automation({ id: "disabled", enabled: false }),
        automation({ id: "not-due", cron: "1 9 * * *" }),
        automation({ id: "auto-1" }),
        automation({ id: "active" }),
      ], [duplicate, active]),
      executor: { run: execute } as never,
      clock: () => NOW,
    })

    const result = await service.runDue(request())

    expect(execute).not.toHaveBeenCalled()
    expect(result.outcomes.map((outcome) => outcome.kind === "skipped" ? outcome.reason : "started")).toEqual(expect.arrayContaining([
      "disabled",
      "not-current-minute",
      "duplicate-scheduled-run",
      "active-run",
    ]))
  })

  it("reconciles a persisted active run after restart before evaluating the next occurrence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boring-due-restart-"))
    try {
      const firstStore = new FileAutomationStore(dir, { clock: () => new Date("2026-07-09T09:00:00.000Z") })
      const saved = await firstStore.createAutomation({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "test:model" })
      const orphan = await firstStore.beginRun({
        automationId: saved.id,
        trigger: "scheduled",
        scheduledFor: "2026-07-09T09:00:00.000Z",
        promptSnapshot: "prompt",
        modelSnapshot: "test:model",
      })
      await firstStore.updateRunLifecycle(orphan.id, { status: "running", startedAt: "2026-07-09T09:00:01.000Z" })

      const restartedStore = new FileAutomationStore(dir, { clock: () => NOW })
      const execute = vi.fn(async () => ({ ...completedRun(), automationId: saved.id }))
      const service = new DueRunService({ store: restartedStore, executor: { run: execute } as never, clock: () => NOW })
      const result = await service.runDue(request())

      expect(execute).toHaveBeenCalledOnce()
      expect(result.outcomes).toEqual([expect.objectContaining({ kind: "started", automationId: saved.id })])
      await expect(restartedStore.listRuns(saved.id)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: orphan.id, status: "failed", error: "Automation host restarted before the run completed" }),
      ]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("continues after one due automation fails and omits prompt snapshots from successful output", async () => {
    const execute = vi.fn(async (input: { automationId: string }) => {
      if (input.automationId === "a") throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL, "bad model")
      return { ...completedRun(), automationId: input.automationId, promptSnapshot: "secret prompt", modelSnapshot: "secret:model" }
    })
    const service = new DueRunService({
      store: storeFor([automation({ id: "a" }), automation({ id: "b" })]),
      executor: { run: execute } as never,
      clock: () => NOW,
    })

    const result = await service.runDue(request())

    expect(result.outcomes).toEqual([
      expect.objectContaining({ kind: "failed", automationId: "a", code: BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL }),
      expect.objectContaining({ kind: "started", automationId: "b" }),
    ])
    expect(result.outcomes[1]).not.toHaveProperty("run.promptSnapshot")
    expect(result.outcomes[1]).not.toHaveProperty("run.modelSnapshot")
  })

  it.each([
    [BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE, "active-run"],
    [BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED, "duplicate-scheduled-run"],
  ] as const)("turns atomic %s races into deterministic skips", async (code, reason) => {
    const execute = vi.fn(async () => { throw new AutomationStoreError(code, "race") })
    const service = new DueRunService({ store: storeFor([automation()]), executor: { run: execute } as never, clock: () => NOW })

    const result = await service.runDue(request())

    expect(result.outcomes).toEqual([expect.objectContaining({ kind: "skipped", reason })])
  })
})
