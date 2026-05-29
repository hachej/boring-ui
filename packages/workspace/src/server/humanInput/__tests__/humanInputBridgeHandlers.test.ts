import { describe, expect, test } from "vitest"
import { createWorkspaceBridgeRegistry } from "../../workspaceBridge/registry"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import { createCapturedBridgeLogger, createTestBridgeContext, assertNoSensitiveBridgeLeaks } from "../../workspaceBridge/testing/harness"
import { createHumanInputBridgeHandlers, HUMAN_INPUT_OPS } from "../humanInputBridgeHandlers"
import { PendingQuestionRuntime } from "../pendingQuestionRuntime"
import { InMemoryPendingQuestionStore } from "../pendingQuestionStore"

function setup(options: Partial<Parameters<typeof createHumanInputBridgeHandlers>[0]> = {}) {
  const store = options.store ?? new InMemoryPendingQuestionStore()
  const runtime = options.runtime ?? new PendingQuestionRuntime(store)
  const logger = createCapturedBridgeLogger({ answers: ["answer-secret"], tokens: ["runtime-token-secret"], requestPayloads: ["full-payload-secret"] })
  const registry = createWorkspaceBridgeRegistry({ logger })
  for (const entry of createHumanInputBridgeHandlers({ runtime, store, resolveOwnerPrincipalId: options.resolveOwnerPrincipalId })) {
    registry.registerHandler(entry.definition, entry.handler)
  }
  return { store, runtime, registry, logger }
}

const runtimeContext = (extraCaps: string[] = []) => createTestBridgeContext({
  callerClass: "runtime",
  workspaceId: "workspace-1",
  sessionId: "session-1",
  tokenId: "runtime-token-secret",
  capabilities: ["human-input:request", ...extraCaps],
  actor: { actorKind: "agent", performedBy: { id: "agent-1", label: "agent" }, onBehalfOf: { id: "human-1", label: "human" } },
})

const browserContext = (extraCaps: string[] = [], principalId = "human-1") => createTestBridgeContext({
  callerClass: "browser",
  workspaceId: "workspace-1",
  sessionId: "session-1",
  capabilities: extraCaps,
  actor: { actorKind: "human", performedBy: { id: principalId, label: "human" } },
})

describe("human-input bridge handlers", () => {
  test("request emits a UI effect and waits for browser answer", async () => {
    const { registry, store, logger } = setup()
    const effects: unknown[] = []
    const request = registry.call({
      op: HUMAN_INPUT_OPS.request,
      input: { requestId: "req-1", sessionId: "session-1", payload: { prompt: "full-payload-secret" } },
    }, { ...runtimeContext(), emitUiEffect: async (effect) => { effects.push(effect); return { seq: 1, status: "ok" } } })

    await viWaitFor(async () => expect(await store.getPending("session-1")).toBeTruthy())
    const pending = await store.getPending("session-1")
    expect(effects).toHaveLength(1)
    expect(JSON.stringify(effects[0])).toContain("human-input")

    const answer = await registry.call({
      op: HUMAN_INPUT_OPS.answer,
      input: { questionId: pending!.questionId, sessionId: "session-1", nonce: pending!.nonce, values: { text: "answer-secret" } },
    }, browserContext(["human-input:answer"]))
    expect(answer.ok).toBe(true)
    await expect(request).resolves.toMatchObject({ ok: true, output: { status: "answered", answer: { values: { text: "answer-secret" } } } })
    expect(JSON.stringify(await store.listTranscriptEvents("session-1"))).not.toContain("answer-secret")
    assertNoSensitiveBridgeLeaks(logger.text(), { answers: ["answer-secret"], tokens: ["runtime-token-secret"], requestPayloads: ["full-payload-secret"] })
  })

  test("nonce, session, and one-shot answer validation are pinned", async () => {
    const { registry, store } = setup()
    const q = await new PendingQuestionRuntime(store).createPending({ requestId: "req-nonce", sessionId: "session-1", actor: { actorKind: "agent", onBehalfOf: { id: "human-1", label: "human" } } })

    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: q.questionId, sessionId: "session-1", values: {} } }, browserContext(["human-input:answer"])))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: q.questionId, sessionId: "wrong", nonce: q.nonce, values: {} } }, browserContext(["human-input:answer"])))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: q.questionId, sessionId: "session-1", nonce: "wrong", values: {} } }, browserContext(["human-input:answer"])))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })

    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: q.questionId, sessionId: "session-1", nonce: q.nonce, values: { ok: true } } }, browserContext(["human-input:answer"])))
      .resolves.toMatchObject({ ok: true })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: q.questionId, sessionId: "session-1", nonce: q.nonce, values: { ok: true } } }, browserContext(["human-input:answer"])))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  test("pending, cancel, timeout, and transcript policy are pinned", async () => {
    const { registry, store } = setup()
    const pending = await new PendingQuestionRuntime(store).createPending({ requestId: "req-cancel", sessionId: "session-1", actor: { actorKind: "agent", onBehalfOf: { id: "human-1", label: "human" } } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.pending, input: { sessionId: "session-1" } }, browserContext(["human-input:pending"])))
      .resolves.toMatchObject({ ok: true, output: { pending: { questionId: pending.questionId, nonce: pending.nonce } } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.cancel, input: { questionId: pending.questionId, sessionId: "session-1", nonce: pending.nonce, reason: "user_cancelled" } }, browserContext(["human-input:cancel"])))
      .resolves.toMatchObject({ ok: true, output: { reason: "user_cancelled" } })

    const timeout = registry.call({ op: HUMAN_INPUT_OPS.request, input: { requestId: "req-timeout", sessionId: "session-1", timeoutMs: 1 } }, runtimeContext())
    await expect(timeout).resolves.toMatchObject({ ok: true, output: { status: "cancelled", reason: "timeout" } })

    await expect(registry.call({ op: HUMAN_INPUT_OPS.transcript, input: { sessionId: "session-1" } }, runtimeContext(["human-input:transcript.read"])))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.transcript, input: { sessionId: "session-1" } }, createTestBridgeContext({ callerClass: "server", capabilities: ["human-input:transcript.read"] })))
      .resolves.toMatchObject({ ok: true, output: { events: expect.any(Array) } })
  })

  test("browser principal must own pending questions to view, answer, or cancel", async () => {
    const { registry, store } = setup()
    const pending = await new PendingQuestionRuntime(store).createPending({
      requestId: "req-owner",
      sessionId: "session-1",
      actor: { actorKind: "agent", onBehalfOf: { id: "human-1", label: "human" } },
    })

    await expect(registry.call({ op: HUMAN_INPUT_OPS.pending, input: { sessionId: "session-1" } }, browserContext(["human-input:pending"], "human-2")))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: pending.questionId, sessionId: "session-1", nonce: pending.nonce, values: { ok: true } } }, browserContext(["human-input:answer"], "human-2")))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
    await expect(registry.call({ op: HUMAN_INPUT_OPS.cancel, input: { questionId: pending.questionId, sessionId: "session-1", nonce: pending.nonce, reason: "user_cancelled" } }, browserContext(["human-input:cancel"], "human-2")))
      .resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
  })

  test("owner-less questions fail closed for authenticated browsers but stay open for local no-auth", async () => {
    const { registry, store } = setup()
    const pending = await new PendingQuestionRuntime(store).createPending({
      requestId: "req-noowner",
      sessionId: "session-1",
      actor: { actorKind: "agent" }, // no onBehalfOf.id and no resolver -> no recorded owner
    })
    expect(pending.ownerPrincipalId).toBeFalsy()

    // Authenticated (multi-tenant) browser carries a principal id -> must be rejected.
    await expect(registry.call(
      { op: HUMAN_INPUT_OPS.answer, input: { questionId: pending.questionId, sessionId: "session-1", nonce: pending.nonce, values: { ok: true } } },
      browserContext(["human-input:answer"], "human-2"),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })

    // Local no-auth browser has no principal id -> stays permissive (single-user trusted-local).
    const localBrowser = createTestBridgeContext({
      callerClass: "browser",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      capabilities: ["human-input:answer"],
      actor: { actorKind: "human", performedBy: { label: "local-cli:user" } },
    })
    await expect(registry.call(
      { op: HUMAN_INPUT_OPS.answer, input: { questionId: pending.questionId, sessionId: "session-1", nonce: pending.nonce, values: { ok: true } } },
      localBrowser,
    )).resolves.toMatchObject({ ok: true })
  })

  test("request can resolve owner principal through host callback when runtime actor lacks it", async () => {
    const { registry, store } = setup({ resolveOwnerPrincipalId: (sessionId) => sessionId === "session-1" ? "human-1" : undefined })
    const request = registry.call({
      op: HUMAN_INPUT_OPS.request,
      input: { requestId: "req-callback", sessionId: "session-1", payload: { prompt: "secret" } },
    }, {
      ...createTestBridgeContext({
        callerClass: "runtime",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        capabilities: ["human-input:request"],
        actor: { actorKind: "agent", performedBy: { id: "agent-1", label: "agent" } },
      }),
      emitUiEffect: async () => ({ seq: 1, status: "ok" }),
    })

    await viWaitFor(async () => expect(await store.getPending("session-1")).toMatchObject({ ownerPrincipalId: "human-1" }))
    const pending = await store.getPending("session-1")
    await expect(registry.call({ op: HUMAN_INPUT_OPS.answer, input: { questionId: pending!.questionId, sessionId: "session-1", nonce: pending!.nonce, values: { ok: true } } }, browserContext(["human-input:answer"])))
      .resolves.toMatchObject({ ok: true })
    await expect(request).resolves.toMatchObject({ ok: true, output: { status: "answered" } })
  })

  test("duplicate registration fails clearly", () => {
    const { registry, store, runtime } = setup()
    const [entry] = createHumanInputBridgeHandlers({ runtime, store })
    expect(() => registry.registerHandler(entry.definition, entry.handler)).toThrow(/already registered/)
  })
})

async function viWaitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      await assertion()
      return
    } catch (error) {
      if (Date.now() - started > 1000) throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
