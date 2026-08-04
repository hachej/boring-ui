import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { FileAutomationStore } from "../fileStore"
import { ManualRunExecutor } from "../manualRunExecutor"

async function createStoreRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "boring-automation-mig-del-"))
}

async function seed(store: FileAutomationStore) {
  return await store.createAutomation({
    title: "Restart saga",
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "test:model",
    prompt: "run",
  })
}

describe("ManualRunExecutor durable restart saga", () => {
  it("preserves an accepted addressed receipt and session across restart reconciliation", async () => {
    const root = await createStoreRoot()
    const firstProcess = new FileAutomationStore(root, {
      clock: () => new Date("2026-07-24T00:00:00.000Z"),
    })
    const automation = await seed(firstProcess)
    const admitted = await firstProcess.beginRun({
      automationId: automation.id,
      invocationId: "manual:accepted-before-crash",
      trigger: "manual",
      promptSnapshot: "run",
      modelSnapshot: "test:model",
    })
    await firstProcess.updateRunLifecycle(admitted.id, {
      status: "dispatching",
      startedAt: "2026-07-24T00:00:01.000Z",
      sessionId: "shared",
      dispatchReceipt: {
        ref: { agentTypeId: "beta", sessionId: "shared" },
        accepted: true,
        cursor: 7,
        disposition: "prompt",
        clientNonce: admitted.id,
      },
    })

    const restarted = new FileAutomationStore(root, {
      clock: () => new Date("2026-07-24T00:01:00.000Z"),
    })
    await restarted.reconcileOrphanedRuns(automation.id)

    await expect(restarted.listRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({
        id: admitted.id,
        status: "failed",
        sessionId: "shared",
        dispatchReceipt: expect.objectContaining({ ref: { agentTypeId: "beta", sessionId: "shared" } }),
        error: "Automation host restarted before the run completed",
      }),
    ])
  })

  it("persists the invocation receipt before dispatch and resolves ambiguity without redispatch", async () => {
    const root = await createStoreRoot()
    const firstProcess = new FileAutomationStore(root, {
      clock: () => new Date("2026-07-24T00:00:00.000Z"),
    })
    const automation = await seed(firstProcess)
    const admitted = await firstProcess.beginRun({
      automationId: automation.id,
      invocationId: "manual:invocation-1",
      trigger: "manual",
      promptSnapshot: "run",
      modelSnapshot: "test:model",
    })
    await firstProcess.updateRunLifecycle(admitted.id, {
      status: "dispatching",
      startedAt: "2026-07-24T00:00:01.000Z",
    })

    const durableBeforeRestart = JSON.parse(await readFile(join(root, ".pi", "automation", "store.json"), "utf8"))
    expect(durableBeforeRestart.runs[admitted.id]).toMatchObject({
      id: admitted.id,
      invocationId: "manual:invocation-1",
      dispatchRequestId: admitted.id,
      dispatchReceipt: null,
      status: "dispatching",
    })

    const restarted = new FileAutomationStore(root, {
      clock: () => new Date("2026-07-24T00:01:00.000Z"),
    })
    await restarted.reconcileOrphanedRuns(automation.id)
    const [ambiguous] = await restarted.listRuns(automation.id)
    expect(ambiguous).toMatchObject({
      id: admitted.id,
      status: "outcome-unknown",
      dispatchReceipt: null,
      error: "Automation dispatch outcome is unknown after host restart; it was not retried",
    })

    const dispatch = vi.fn()
    const resolve = vi.fn(async () => ({
      dispatch,
      send: vi.fn(),
      interrupt: vi.fn(),
      stop: vi.fn(),
    }))
    const restartedExecutor = new ManualRunExecutor({
      agentTypeId: "default",
      store: restarted,
      dispatcherResolver: {
        runWithWorkspaceAgent: vi.fn(async () => { throw new Error("unexpected dispatch") }),
        resolve,
      },
      actorResolver: vi.fn(),
    })
    const sameInvocation = await restartedExecutor.run({
      automationId: automation.id,
      invocationId: "manual:invocation-1",
      actor: { workspaceId: "workspace-1", userId: "user-1" },
    })
    expect(sameInvocation.id).toBe(admitted.id)
    expect(sameInvocation.status).toBe("outcome-unknown")
    expect(resolve).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    await expect(restarted.listRuns(automation.id)).resolves.toHaveLength(1)

    const explicitNewRun = await restarted.beginRun({
      automationId: automation.id,
      invocationId: "manual:invocation-2",
      trigger: "manual",
      promptSnapshot: "run again",
      modelSnapshot: "test:model",
    })
    expect(explicitNewRun.id).not.toBe(admitted.id)
  })

  it("returns one durable run receipt for concurrent retries of an invocation", async () => {
    const store = new FileAutomationStore(await createStoreRoot())
    const automation = await seed(store)
    const input = {
      automationId: automation.id,
      invocationId: "scheduled:one",
      trigger: "scheduled" as const,
      scheduledFor: "2026-07-24T09:00:00.000Z",
      promptSnapshot: "run",
      modelSnapshot: "test:model",
    }
    const [first, second] = await Promise.all([store.beginRun(input), store.beginRun(input)])
    expect(first.id).toBe(second.id)
    await expect(store.listRuns(automation.id)).resolves.toHaveLength(1)
  })
})
