import { describe, expect, it, vi } from "vitest"
import {
  createHumanInputBridgeHandlers,
  createWorkspaceBridgeRegistry,
  HUMAN_INPUT_OPS,
  InMemoryPendingQuestionStore,
  PendingQuestionRuntime,
  WorkspaceBridgeErrorCode,
  type WorkspaceBridgeCallContext,
} from "@hachej/boring-workspace/server"
import { createAskUserPiExtensionFactory } from "../index"

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer", required: true }] }
type Tool = { name: string; execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<any> }
type RuntimeMode = "direct" | "local" | "vercel-sandbox"

function makeContext(callerClass: WorkspaceBridgeCallContext["callerClass"], capabilities: string[], mode: RuntimeMode, extra: Partial<WorkspaceBridgeCallContext> = {}): WorkspaceBridgeCallContext {
  return {
    callerClass,
    workspaceId: `workspace-${mode}`,
    sessionId: `session-${mode}`,
    tokenId: callerClass === "runtime" ? "runtime-token-secret" : undefined,
    capabilities,
    actor: callerClass === "browser"
      ? { actorKind: "human", performedBy: { id: "human-1", label: "human" } }
      : { actorKind: "agent", performedBy: { id: "agent-1", label: "agent" }, onBehalfOf: { id: "human-1", label: "human" } },
    ...extra,
  }
}

function setup(mode: RuntimeMode, emitUiEffect?: WorkspaceBridgeCallContext["emitUiEffect"]) {
  const logs: string[] = []
  const store = new InMemoryPendingQuestionStore()
  const pendingRuntime = new PendingQuestionRuntime(store)
  const registry = createWorkspaceBridgeRegistry()
  for (const entry of createHumanInputBridgeHandlers({ runtime: pendingRuntime, store })) registry.registerHandler(entry.definition, entry.handler)
  const tools: Tool[] = []
  createAskUserPiExtensionFactory({
    sessionId: () => `session-${mode}`,
    logger: { debug: (message, meta) => logs.push(`${mode}:${message}:${JSON.stringify(redact(meta))}`), warn: vi.fn(), error: vi.fn() },
    callHumanInputRequest: async (input, signal) => {
      logs.push(`${mode}:bridge request:${JSON.stringify(redact({ requestId: input.requestId, toolCallId: input.toolCallId, sessionId: input.sessionId, callerClass: "runtime", actorKind: "agent" }))}`)
      return await registry.call({ op: HUMAN_INPUT_OPS.request, requestId: input.requestId, input }, makeContext("runtime", ["human-input:request"], mode, { signal, emitUiEffect }))
    },
  })({ registerTool: (tool) => { logs.push(`${mode}:extension registration:${tool.name}`); tools.push(tool) } })
  return { registry, store, pendingRuntime, logs, tool: tools[0]! }
}

async function waitForPending(store: InMemoryPendingQuestionStore, sessionId: string) {
  for (let i = 0; i < 100; i++) {
    const pending = await store.getPending(sessionId)
    if (pending) return pending
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("pending question timeout")
}

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, child) => /token|nonce|answer/i.test(key) ? "[REDACTED]" : child))
}

describe("ask-user bridge integration across runtime modes", () => {
  for (const mode of ["direct", "local", "vercel-sandbox"] as const) {
    it(`completes ask_user lifecycle in ${mode} mode through human-input bridge ops`, async () => {
      const { registry, store, logs, tool } = setup(mode, async (effect) => {
        logs.push(`${mode}:ui effect:${JSON.stringify({ kind: effect.kind, surface: (effect as any).params?.kind })}`)
        return { seq: 1, status: "ok" }
      })
      const resultPromise = tool.execute(`tool-${mode}`, { title: `Question ${mode}`, schema })
      const pending = await waitForPending(store, `session-${mode}`)
      logs.push(`${mode}:pending question:${JSON.stringify({ requestId: pending.requestId, toolCallId: pending.toolCallId, questionId: pending.questionId, sessionId: pending.sessionId, actorKind: pending.actorKind })}`)
      const answer = await registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: pending.questionId, sessionId: pending.sessionId, nonce: pending.nonce, values: { answer: "secret answer" } } }, makeContext("browser", ["human-input:answer"], mode))
      logs.push(`${mode}:browser answer:[REDACTED]`)
      expect(answer).toMatchObject({ ok: true })
      await expect(resultPromise).resolves.toMatchObject({ details: { status: "answered", answer: { values: { answer: "secret answer" } } } })
      logs.push(`${mode}:waiter resolution:answered`)

      const text = JSON.stringify(logs)
      expect(text).toContain("extension registration:ask_user")
      expect(text).toContain("bridge request")
      expect(text).toContain("ui effect")
      expect(text).toContain("pending question")
      expect(text).toContain("browser answer:[REDACTED]")
      expect(text).toContain("waiter resolution:answered")
      expect(text).toContain("callerClass")
      expect(text).toContain("actorKind")
      expect(text).not.toContain("runtime-token-secret")
      expect(text).not.toContain("secret answer")
    })
  }

  it("covers UI unavailable, timeout, abort, cancellation, transcript policy, and tab race", async () => {
    const unavailable = setup("direct", async () => { throw new Error("ui unavailable") })
    await expect(unavailable.tool.execute("tool-ui", { title: "UI", schema })).resolves.toMatchObject({ isError: true, details: { status: "cancelled", reason: "runtime_unavailable" } })

    const timed = setup("local", async () => ({ seq: 1, status: "ok" }))
    await expect(timed.tool.execute("tool-timeout", { title: "Timeout", schema, timeoutMs: 1_000 })).resolves.toMatchObject({ isError: true, details: { status: "cancelled", reason: "timeout" } })

    const aborted = setup("vercel-sandbox", async () => ({ seq: 1, status: "ok" }))
    const controller = new AbortController()
    const abortedPromise = aborted.tool.execute("tool-abort", { title: "Abort", schema }, controller.signal)
    await waitForPending(aborted.store, "session-vercel-sandbox")
    controller.abort()
    await expect(abortedPromise).resolves.toMatchObject({ isError: true, details: { status: "cancelled", reason: "aborted" } })

    const cancelled = setup("direct", async () => ({ seq: 1, status: "ok" }))
    const cancelledPromise = cancelled.tool.execute("tool-cancel", { title: "Cancel", schema })
    const cancelPending = await waitForPending(cancelled.store, "session-direct")
    await expect(cancelled.registry.call({ op: HUMAN_INPUT_OPS.cancel, input: { questionId: cancelPending.questionId, sessionId: cancelPending.sessionId, nonce: cancelPending.nonce, reason: "user_cancelled" } }, makeContext("browser", ["human-input:cancel"], "direct"))).resolves.toMatchObject({ ok: true })
    await expect(cancelledPromise).resolves.toMatchObject({ isError: true, details: { status: "cancelled", reason: "user_cancelled" } })

    const raced = setup("local", async () => ({ seq: 1, status: "ok" }))
    const racedPromise = raced.tool.execute("tool-race", { title: "Race", schema })
    const racePending = await waitForPending(raced.store, "session-local")
    const first = await raced.registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: racePending.questionId, sessionId: racePending.sessionId, nonce: racePending.nonce, values: { answer: "first secret" } } }, makeContext("browser", ["human-input:answer"], "local"))
    const second = await raced.registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: racePending.questionId, sessionId: racePending.sessionId, nonce: racePending.nonce, values: { answer: "second secret" } } }, makeContext("browser", ["human-input:answer"], "local"))
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
    await expect(racedPromise).resolves.toMatchObject({ details: { status: "answered" } })
    await expect(raced.registry.call({ op: HUMAN_INPUT_OPS.transcript, input: { sessionId: "session-local" } }, makeContext("runtime", ["human-input:request"], "local"))).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })
    await expect(raced.registry.call({ op: HUMAN_INPUT_OPS.transcript, input: { sessionId: "session-local" } }, makeContext("server", ["human-input:transcript.read"], "local"))).resolves.toMatchObject({ ok: true, output: { events: expect.any(Array) } })
  })

  it("returns runtime unavailable when no explicit bridge context is provided", async () => {
    const tools: Tool[] = []
    createAskUserPiExtensionFactory()({ registerTool: (tool) => tools.push(tool) })
    await expect(tools[0]!.execute("tool-no-context", { title: "No context", schema })).resolves.toMatchObject({ isError: true, details: { code: "ASK_USER_RUNTIME_UNAVAILABLE" } })
  })
})
