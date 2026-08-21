import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { AutomationRunLifecyclePatch } from "../../shared/types"
import { DispatchRunExecutor } from "../dispatchRunExecutor"
import { FileAutomationStore } from "../fileStore"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared/error-codes"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

it("keeps the slot occupied when accepted dispatch identity persistence loses the race", async () => {
  const root = await mkdtemp(join(tmpdir(), "boring-automation-occupancy-race-"))
  roots.push(root)
  const store = new FileAutomationStore(root)
  const automation = await store.createAutomation({
    title: "worker-slot-1",
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "openai-codex:gpt-5.6-sol",
    prompt: "claim one bead",
  })

  const update = store.updateRunLifecycle.bind(store)
  let injectIdentityWriteFailure = true
  store.updateRunLifecycle = async (runId: string, patch: AutomationRunLifecyclePatch) => {
    if (injectIdentityWriteFailure && patch.dispatchReceipt) {
      injectIdentityWriteFailure = false
      throw new Error("injected identity persistence failure after acceptance")
    }
    return await update(runId, patch)
  }

  let acceptedWorkerStillRunning = false
  const resolver: WorkspaceAgentDispatcherResolver = {
    async runWithWorkspaceAgent(_input, run) {
      await run({
        workspace: {} as never,
        signal: new AbortController().signal,
        async dispatch(input, _onEvent, onAccepted) {
          acceptedWorkerStillRunning = true
          const ref = { agentTypeId: "boring-worker", sessionId: "accepted-worker" }
          const receipt = {
            accepted: true as const,
            cursor: 1,
            disposition: "prompt" as const,
            clientNonce: input.requestId,
          }
          await onAccepted?.({ ref, receipt })
          throw new Error("dispatch callback unexpectedly returned")
        },
        async listSessions() { return { sessions: [] } },
        async sendIfIdle() { throw new Error("sendIfIdle is not used by occupancy race") },
        async interrupt() { return { accepted: true, cursor: 0 } },
        async stop() { return { accepted: true, cursor: 0, stopped: true, clearedQueue: [] } },
      })
    },
    resolve: vi.fn(async () => { throw new Error("legacy resolver is not used") }),
  }
  const executor = new DispatchRunExecutor({
    agentTypeId: "boring-worker",
    store,
    dispatcherResolver: resolver,
    actorResolver: vi.fn(),
  })

  const ambiguous = await executor.run({
    automationId: automation.id,
    actor: { workspaceId: "workspace-1", userId: "user-1" },
    trigger: "manual",
  })
  expect(acceptedWorkerStillRunning).toBe(true)
  expect(ambiguous).toMatchObject({
    status: "outcome-unknown",
    sessionId: "accepted-worker",
    error: "injected identity persistence failure after acceptance",
  })

  const replacements = await Promise.allSettled([
    store.beginRun({ automationId: automation.id, trigger: "manual", promptSnapshot: "replacement-1", modelSnapshot: automation.model }),
    store.beginRun({ automationId: automation.id, trigger: "manual", promptSnapshot: "replacement-2", modelSnapshot: automation.model }),
  ])
  expect(replacements).toHaveLength(2)
  for (const replacement of replacements) {
    expect(replacement.status).toBe("rejected")
    if (replacement.status === "rejected") {
      expect(replacement.reason).toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE })
    }
  }
  await expect(store.listRuns(automation.id)).resolves.toEqual([
    expect.objectContaining({ id: ambiguous.id, status: "outcome-unknown", sessionId: "accepted-worker" }),
  ])
})
