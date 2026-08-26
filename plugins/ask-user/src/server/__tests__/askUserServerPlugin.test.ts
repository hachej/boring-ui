// @vitest-environment node

import { vi } from "vitest"

vi.mock("@boring/agent/server", () => ({}))

import Fastify, { type FastifyInstance } from "fastify"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { describe, expect, it } from "vitest"
import type { AskUserStore } from "../askUserStore"
import { AskUserRuntime } from "../askUserRuntime"
import { createAskUserTool } from "../createAskUserTool"
import { createAskUserServerPlugin } from "../askUserServerPlugin"
import { MemoryAskUserStore } from "./testAskUserStore"
import { UI_STATE_INVALIDATION_COMMAND, createInMemoryBridge, uiRoutes, type UiBridge, type UiCommand, type UiState } from "@hachej/boring-workspace/server"
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

type SseEvent = { event: string; data: Record<string, unknown> }

function createSseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ""
  const queue: SseEvent[] = []
  const drain = () => {
    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const event = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim()
      const data = chunk.match(/^data:\s*(.+)$/m)?.[1]
      if (event && data) queue.push({ event, data: JSON.parse(data) as Record<string, unknown> })
    }
  }
  return {
    async next(eventName: string): Promise<SseEvent> {
      while (true) {
        const index = queue.findIndex(({ event }) => event === eventName)
        if (index >= 0) return queue.splice(index, 1)[0]!
        const chunk = await reader.read()
        if (chunk.done) throw new Error(`SSE closed before ${eventName}`)
        buffer += decoder.decode(chunk.value, { stream: true })
        drain()
      }
    },
  }
}

async function openUiCommandSse(app: FastifyInstance, signal: AbortSignal) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/ui/commands/next",
    payloadAsStream: true,
    signal,
  })
  return {
    statusCode: response.statusCode,
    reader: Readable.toWeb(response.stream()).getReader() as ReadableStreamDefaultReader<Uint8Array>,
  }
}

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
    expect(runtime.ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "chat-session", toolCallId: "call" }), undefined)
  })

  it("valid input creates pending question and waits for runtime answer", async () => {
    const { store, runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
    const pendingResult = tool.execute("call", { title: "Need input", schema, artifacts: [artifact], timeoutMs: 60_000 }, undefined)
    const pending = await waitForPendingQuestion(store, "s1")
    expect(pending).toMatchObject({ status: "ready", title: "Need input", toolCallId: "call", artifacts: [artifact] })
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
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["ask_user"])
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
        abortSignal: new AbortController().signal,
      })
      const pending = await waitForPendingQuestion(store, "session-live")
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: "session-live", status: "ready" },
      }))
      await runtime.cancelQuestion(pending.questionId, "session-live")
      await pendingResult
    } finally {
      bridgeSpy.mockRestore()
    }
  })

  it("queues the invalidation for a question raised with no client attached, and delivers it on connect", async () => {
    // The named gap in #873: a requestless ask_user fires from the CLI with no
    // browser anywhere. The existing SSE test attaches its reader first, so it
    // only proves live delivery. Here nothing is listening when the question is
    // raised, and the invalidation must survive until a client shows up.
    const { store, runtime } = await fixture()
    const liveBridge = createInMemoryBridge()
    const plugin = createAskUserServerPlugin({ store, runtime, bridge: liveBridge, sessionId: "fallback" })
    const app = Fastify()
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      await app.register(plugin.routes!)
      await app.register(uiRoutes, { bridge: liveBridge })

      const startupCommands = await vi.waitFor(async () => {
        const commands = await liveBridge.drainCommands!()
        expect(commands).not.toHaveLength(0)
        return commands
      }, pendingWait)
      expect(startupCommands).toEqual([expect.objectContaining({
        kind: UI_STATE_INVALIDATION_COMMAND,
        params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] },
      })])

      const tool = plugin.agentTools!.find((candidate) => candidate.name === "ask_user")!
      const pendingResult = tool.execute({ title: "Raised while nobody watched", schema }, {
        toolCallId: "call-headless",
        sessionId: "session-headless",
        abortSignal: new AbortController().signal,
      })
      const pending = await waitForPendingQuestion(store, "session-headless")
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: "session-headless", status: "ready" },
      }))

      // Only now does a browser connect.
      const response = await openUiCommandSse(app, controller.signal)
      expect(response.statusCode).toBe(200)
      reader = response.reader
      const sse = createSseReader(reader)
      await expect(sse.next("init")).resolves.toMatchObject({ event: "init" })
      await expect(sse.next("command")).resolves.toMatchObject({
        data: { kind: UI_STATE_INVALIDATION_COMMAND, params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] } },
      })

      const state = (await app.inject({ method: "GET", url: "/api/v1/ui/state" })).json<Record<string, unknown>>()
      expect(state[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: "session-headless", status: "ready" },
      })
      expect(JSON.stringify(state)).not.toContain("answerToken")

      await runtime.cancelQuestion(pending.questionId, pending.sessionId)
      await expect(pendingResult).resolves.toMatchObject({ details: { status: "cancelled" } })
    } finally {
      controller.abort()
      await reader?.cancel().catch(() => undefined)
      await app.close()
    }
  })

  it("keeps authoritative pending state recoverable when another client consumed the invalidation", async () => {
    const { store, runtime } = await fixture()
    const liveBridge = createInMemoryBridge()
    const otherClientCommands: UiCommand[] = []
    const disconnectOtherClient = liveBridge.subscribeCommands((command) => {
      otherClientCommands.push(command)
      return true
    })
    const plugin = createAskUserServerPlugin({ store, runtime, bridge: liveBridge, sessionId: "fallback" })
    const app = Fastify()
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      await app.register(plugin.routes!)
      await app.register(uiRoutes, { bridge: liveBridge })
      await vi.waitFor(() => expect(otherClientCommands).not.toHaveLength(0), pendingWait)
      otherClientCommands.length = 0

      const tool = plugin.agentTools!.find((candidate) => candidate.name === "ask_user")!
      const pendingResult = tool.execute({ title: "Missed by reconnecting client", schema }, {
        toolCallId: "call-other-client",
        sessionId: "session-other-client",
        abortSignal: new AbortController().signal,
      })
      const pending = await waitForPendingQuestion(store, "session-other-client")
      await vi.waitFor(() => expect(otherClientCommands).toEqual([expect.objectContaining({
        kind: UI_STATE_INVALIDATION_COMMAND,
        params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] },
      })]), pendingWait)
      await expect(liveBridge.drainCommands!()).resolves.toEqual([])

      // This client connects after the other subscriber accepted the command,
      // so there is nothing to replay. Its init signal drives the frontend's
      // authoritative state refresh covered by the paired front-shell test.
      const response = await openUiCommandSse(app, controller.signal)
      expect(response.statusCode).toBe(200)
      reader = response.reader
      const sse = createSseReader(reader)
      await expect(sse.next("init")).resolves.toMatchObject({ event: "init" })
      const state = (await app.inject({ method: "GET", url: "/api/v1/ui/state" })).json<Record<string, unknown>>()
      expect(state[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: pending.sessionId, status: "ready" },
      })

      await runtime.cancelQuestion(pending.questionId, pending.sessionId)
      await expect(pendingResult).resolves.toMatchObject({ details: { status: "cancelled" } })
    } finally {
      controller.abort()
      await reader?.cancel().catch(() => undefined)
      disconnectOtherClient()
      await app.close()
    }
  })

  it("pushes requestless ask_user lifecycle invalidations over the live UI SSE boundary", async () => {
    const { store, runtime } = await fixture()
    const liveBridge = createInMemoryBridge()
    const plugin = createAskUserServerPlugin({ store, runtime, bridge: liveBridge, sessionId: "fallback" })
    const app = Fastify()
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      await app.register(plugin.routes!)
      await app.register(uiRoutes, { bridge: liveBridge })
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ hint: null, hintsBySession: {} }))

      const response = await openUiCommandSse(app, controller.signal)
      expect(response.statusCode).toBe(200)
      reader = response.reader
      const sse = createSseReader(reader)
      await expect(sse.next("init")).resolves.toMatchObject({ event: "init" })
      await expect(sse.next("command")).resolves.toMatchObject({
        data: { kind: UI_STATE_INVALIDATION_COMMAND, params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] } },
      })

      const tool = plugin.agentTools!.find((candidate) => candidate.name === "ask_user")!
      const pendingResult = tool.execute({ title: "Requestless decision", schema }, {
        toolCallId: "call-requestless",
        sessionId: "session-requestless",
        abortSignal: new AbortController().signal,
      })
      const pending = await waitForPendingQuestion(store, "session-requestless")
      await expect(sse.next("command")).resolves.toMatchObject({
        data: { kind: UI_STATE_INVALIDATION_COMMAND, params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] } },
      })
      const state = (await app.inject({ method: "GET", url: "/api/v1/ui/state" })).json<Record<string, unknown>>()
      expect(state[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hint: { questionId: pending.questionId, sessionId: "session-requestless", status: "ready" },
      })
      expect(JSON.stringify(state)).not.toContain("answerToken")

      await runtime.cancelQuestion(pending.questionId, pending.sessionId)
      await expect(pendingResult).resolves.toMatchObject({ details: { status: "cancelled" } })
      await expect(sse.next("command")).resolves.toMatchObject({
        data: { kind: UI_STATE_INVALIDATION_COMMAND, params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] } },
      })
      await vi.waitFor(async () => expect((await liveBridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ hint: null, hintsBySession: {} }))
    } finally {
      controller.abort()
      try { await reader?.cancel() } catch {}
      await app.close()
    }
  }, 30_000)

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
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["ask_user"])
    expect(existsSync(join(dir, ".boring", "ask-user.json"))).toBe(false)
  })
})
