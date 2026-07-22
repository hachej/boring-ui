// @vitest-environment node

import { vi } from "vitest"

vi.mock("@boring/agent/server", () => ({}))

import Fastify from "fastify"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { AskUserStore } from "../askUserStore"
import { AskUserRuntime } from "../askUserRuntime"
import { createAskUserTool } from "../createAskUserTool"
import { createAskUserServerPlugin } from "../askUserServerPlugin"
import { MemoryAskUserStore } from "./testAskUserStore"
import type { UiBridge, UiCommand, UiState } from "@hachej/boring-workspace/server"
import * as workspacePlugin from "@hachej/boring-workspace/plugin"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserQuestion } from "../../shared/types"

function bridge(): UiBridge & { commands: UiCommand[] } {
  let state: UiState | null = null
  const commands: UiCommand[] = []
  return {
    commands,
    async getState() { return state },
    async setState(next) { state = next },
    async postCommand(cmd) { commands.push(cmd); return { seq: commands.length, status: "ok" } },
    subscribeCommands() { return () => undefined },
  }
}

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer" }] }
const pendingWait = { timeout: 30_000 }

async function waitForPendingQuestion(store: AskUserStore, sessionId: string): Promise<AskUserQuestion> {
  const started = Date.now()
  let last: AskUserQuestion | null = null
  while (Date.now() - started < pendingWait.timeout) {
    last = await store.getPending(sessionId)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for pending question for ${sessionId}; last=${JSON.stringify(last)}`)
}

async function fixture() {
  const store = new MemoryAskUserStore()
  const runtime = new AskUserRuntime({ store })
  return { store, runtime }
}

async function waitForRuntimeWaiter(runtime: AskUserRuntime, questionId: string) {
  await vi.waitFor(() => {
    expect(runtime.coordinator.hasWaiter(questionId)).toBe(true)
  }, pendingWait)
}

describe("ask-user Pi tool", () => {
  it("registers one ask_user tool and rejects invalid input immediately", async () => {
    const { runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    expect(tool.name).toBe("ask_user")
    await expect(tool.execute("call", {}, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("returns cancelled tool results as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    await expect(tool.execute("call", { title: "Need input", schema }, AbortSignal.timeout(1))).resolves.toMatchObject({ isError: true })
  })

  it("requires schema for non-obvious multi-field requests instead of making a fake A/B form", async () => {
    const { store, runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    const result = await tool.execute("call", { title: "Details needed", context: "Need name, priority, and notes." }, undefined)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain("schema")
    await expect(store.getPending("s1")).resolves.toBeNull()
  })

  it("returns thrown runtime failures as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: () => { throw new Error("session missing") } })
    await expect(tool.execute("call", { title: "Need input", schema }, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("uses tool execution session id when the harness provides one", async () => {
    const runtime = {
      ask: vi.fn().mockResolvedValue({
        status: "answered",
        questionId: "q1",
        sessionId: "chat-session",
        answer: { questionId: "q1", sessionId: "chat-session", values: { answer: "ok" }, submittedAt: new Date().toISOString() },
      }),
    } as unknown as AskUserRuntime
    const tool = createAskUserTool({ runtime, sessionId: "fallback" })

    await expect(tool.execute("call", { title: "Need input", schema, timeoutMs: 60_000 }, undefined, "chat-session")).resolves.toMatchObject({ details: { status: "answered" } })
    expect(runtime.ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "chat-session" }), undefined)
  })

  it("valid input creates pending question and waits for runtime answer", async () => {
    const { store, runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
    const pendingResult = tool.execute("call", { title: "Need input", schema, artifacts: [artifact], timeoutMs: 60_000 }, undefined)
    const pending = await waitForPendingQuestion(store, "s1")
    expect(pending).toMatchObject({ status: "ready", title: "Need input", artifacts: [artifact] })
    await waitForRuntimeWaiter(runtime, pending.questionId)
    await runtime.submitAnswer(pending.questionId, "s1", { answer: "ok" })
    await expect(pendingResult).resolves.toMatchObject({ details: {
      status: "answered",
      handover: { kind: "boring.handover.operations", operations: [{ action: "upsert", artifact }] },
    } })
  }, 30_000)
})

describe("createAskUserServerPlugin", () => {
  it("exports plugin-owned ask-user bridge handlers and agent tool", async () => {
    const { store, runtime } = await fixture()
    const plugin = createAskUserServerPlugin({ store, runtime, sessionId: "s1" })
    expect(plugin.id).toBe("ask-user")
    expect(plugin.routes).toEqual(expect.any(Function))
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["ask_user", "manage_handover"])
    expect(plugin.agentTools?.filter((tool) => tool.name === "manage_handover")).toHaveLength(1)
    expect(plugin.workspaceBridgeHandlers?.map((entry) => entry.definition.op)).toEqual([
      "ask-user.v1.request",
      "ask-user.v1.answer",
      "ask-user.v1.cancel",
      "ask-user.v1.pending",
      "ask-user.v1.transcript",
    ])
  })

  it("lazily attaches its state publisher to the server bridge before tool execution", async () => {
    const { store, runtime } = await fixture()
    const plugin = createAskUserServerPlugin({ store, runtime, sessionId: "fallback" })
    const liveBridge = bridge()
    const bridgeSpy = vi.spyOn(workspacePlugin, "getWorkspaceUiBridge").mockReturnValue(liveBridge)
    try {
      const tool = plugin.agentTools?.find((candidate) => candidate.name === "ask_user")
      expect(tool).toBeDefined()
      const pendingResult = tool!.execute({ title: "Need live input", schema }, {
        toolCallId: "call-live",
        sessionId: "session-live",
        userId: "user-live",
        abortSignal: new AbortController().signal,
        currentRunStructuredDetails: [],
      })
      const pending = await waitForPendingQuestion(store, "session-live")
      expect(pending.ownerPrincipalId).toBe("user-live")
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: "session-live", status: "ready" },
      }))
      await runtime.cancelQuestion(pending.questionId, "session-live")
      await pendingResult
    } finally {
      bridgeSpy.mockRestore()
    }
  })

  it("publishes persisted pending state when plugin routes attach after server bridge registration", async () => {
    const { store, runtime } = await fixture()
    const pendingResult = runtime.ask({ sessionId: "restart-session", title: "Persisted question", schema, timeoutMs: 60_000 })
    const pending = await waitForPendingQuestion(store, "restart-session")
    const plugin = createAskUserServerPlugin({ store, runtime })
    const liveBridge = bridge()
    const bridgeSpy = vi.spyOn(workspacePlugin, "getWorkspaceUiBridge").mockReturnValue(liveBridge)
    const app = Fastify()
    try {
      await app.register(plugin.routes!)
      await app.ready()
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: "restart-session", status: "ready" },
      }))
      await runtime.cancelQuestion(pending.questionId, "restart-session")
      await pendingResult
    } finally {
      await app.close()
      bridgeSpy.mockRestore()
    }
  })

  it("abandons persisted questions whose blocking waiter was lost on restart", async () => {
    const { store, runtime: previousRuntime } = await fixture()
    const pendingResult = previousRuntime.ask({ sessionId: "orphan-session", title: "Orphaned question", schema })
    const pending = await waitForPendingQuestion(store, "orphan-session")
    const restartedRuntime = new AskUserRuntime({ store })
    const plugin = createAskUserServerPlugin({ store, runtime: restartedRuntime })
    const liveBridge = bridge()
    const bridgeSpy = vi.spyOn(workspacePlugin, "getWorkspaceUiBridge").mockReturnValue(liveBridge)
    const app = Fastify()
    try {
      await app.register(plugin.routes!)
      await app.ready()
      await expect(store.getPending("orphan-session")).resolves.toBeNull()
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ hint: null, hintsBySession: {} }))
      previousRuntime.coordinator.resolveCancelled(pending.questionId, "abandoned")
      await pendingResult
    } finally {
      await app.close()
      bridgeSpy.mockRestore()
    }
  })

  it("reuses the runtime store and rejects split runtime/bridge store ownership", async () => {
    const { store, runtime } = await fixture()
    expect(() => createAskUserServerPlugin({ runtime, sessionId: "s1" })).not.toThrow()
    expect(() => createAskUserServerPlugin({ store: new MemoryAskUserStore(), runtime, sessionId: "s1" }))
      .toThrow(/share one AskUserStore/)
    expect(runtime.store).toBe(store)
  })

  it("rejects legacy route options from JavaScript/config callers instead of silently ignoring them", async () => {
    const { store, runtime } = await fixture()
    expect(() => createAskUserServerPlugin({ store, runtime, routes: {} } as unknown as Parameters<typeof createAskUserServerPlugin>[0])).toThrow(/no longer registers/)
  })

  it("does not register the legacy plugin-owned question command route by default", async () => {
    const { store, runtime } = await fixture()
    const plugin = createAskUserServerPlugin({ store, runtime, sessionId: "s1" })
    const app = Fastify()
    await app.register(plugin.routes!)
    const response = await app.inject({ method: "POST", url: "/api/v1/questions/commands", payload: {} })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it("creates default runtime/store/publisher from workspaceRoot and bridge", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-plugin-defaults-"))
    const ui = bridge()
    const plugin = createAskUserServerPlugin({ workspaceRoot: dir, bridge: ui })
    expect(plugin.id).toBe("ask-user")
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["ask_user", "manage_handover"])
    expect(existsSync(join(dir, ".boring", "ask-user.json"))).toBe(false)
  })
})
