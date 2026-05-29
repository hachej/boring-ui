import { describe, expect, it } from "vitest"
import { WorkspaceBridgeErrorCode, type WorkspaceBridgeCallResponse } from "../../../shared/workspace-bridge-rpc"
import {
  InMemoryWorkspaceBridgeIdempotencyStore,
  hashNormalizedInput,
  runWithWorkspaceBridgeIdempotency,
} from "../idempotency"
import { createTestBridgeContext, createTestBridgeOperationDefinition } from "../testing/harness"

const nowMs = Date.parse("2026-01-01T00:00:00.000Z")
const auth = createTestBridgeContext({
  workspaceId: "workspace-1",
  sessionId: "session-1",
  pluginId: "macro",
  tokenId: "secret-token-jti",
})
const requiredDefinition = createTestBridgeOperationDefinition<{ value: string }, { ok: boolean }>({
  op: "macro.v1.transform.persist",
  idempotencyPolicy: "required",
})
const answerDefinition = createTestBridgeOperationDefinition({
  op: "human-input.v1.answer",
  idempotencyPolicy: "required",
})

describe("WorkspaceBridge idempotency primitives", () => {
  it("requires an idempotency key for required mutation policies", async () => {
    const store = new InMemoryWorkspaceBridgeIdempotencyStore()
    const result = await store.begin({
      definition: requiredDefinition,
      request: { op: requiredDefinition.op, input: { value: "a" }, requestId: "req-1" },
      auth,
      nowMs,
    })

    expect(result).toMatchObject({
      action: "reject",
      error: { code: WorkspaceBridgeErrorCode.IdempotencyRequired },
    })
  })

  it("replays the previous result for same key and same normalized payload", async () => {
    const store = new InMemoryWorkspaceBridgeIdempotencyStore()
    const request = {
      op: requiredDefinition.op,
      input: { value: "a" },
      requestId: "req-1",
      idempotencyKey: "idem-1",
    }
    const first = await store.begin({ definition: requiredDefinition, request, auth, nowMs })
    expect(first.action).toBe("execute")
    if (first.action !== "execute") throw new Error("expected execute")
    const response: WorkspaceBridgeCallResponse<{ ok: boolean }> = {
      ok: true,
      op: requiredDefinition.op,
      requestId: "req-1",
      output: { ok: true },
    }
    await store.complete({ scopeKey: first.scopeKey, inputHash: first.inputHash, response, nowMs })

    const replay = await store.begin({
      definition: requiredDefinition,
      request: { ...request, input: { value: "a" } },
      auth,
      nowMs: nowMs + 100,
    })

    expect(replay).toMatchObject({ action: "replay", record: { response } })
  })

  it("rejects conflicting replay for same key and different payload", async () => {
    const store = new InMemoryWorkspaceBridgeIdempotencyStore()
    const first = await store.begin({
      definition: requiredDefinition,
      request: { op: requiredDefinition.op, input: { value: "a" }, idempotencyKey: "idem-1" },
      auth,
      nowMs,
    })
    expect(first.action).toBe("execute")

    const conflict = await store.begin({
      definition: requiredDefinition,
      request: { op: requiredDefinition.op, input: { value: "b" }, idempotencyKey: "idem-1" },
      auth,
      nowMs,
    })

    expect(conflict).toMatchObject({
      action: "reject",
      error: { code: WorkspaceBridgeErrorCode.ReplayRejected },
    })
  })

  it("normalizes input hashing independent of object key order", () => {
    expect(hashNormalizedInput({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashNormalizedInput({ b: { d: 3, c: 2 }, a: 1 }),
    )
  })

  it("allows exactly one concurrent execution for the same answer/cancel key", async () => {
    const store = new InMemoryWorkspaceBridgeIdempotencyStore()
    const request = {
      op: answerDefinition.op,
      input: { questionId: "q1", answer: "secret answer" },
      requestId: "req-answer",
      idempotencyKey: "answer-key",
    }
    const [a, b] = await Promise.all([
      store.begin({ definition: answerDefinition, request, auth, nowMs }),
      store.begin({ definition: answerDefinition, request, auth, nowMs }),
    ])

    expect([a.action, b.action].sort()).toEqual(["execute", "replay"])
  })

  it("garbage collects expired records", async () => {
    const store = new InMemoryWorkspaceBridgeIdempotencyStore()
    await store.begin({
      definition: requiredDefinition,
      request: { op: requiredDefinition.op, input: { value: "a" }, idempotencyKey: "idem-ttl" },
      auth,
      nowMs,
      ttlMs: 10,
    })

    expect(await store.gc(nowMs + 11)).toBe(1)
    expect(await store.gc(nowMs + 12)).toBe(0)
  })

  it("disables required mutations with a stable diagnostic when no atomic store exists", async () => {
    const result = await runWithWorkspaceBridgeIdempotency(undefined, {
      definition: requiredDefinition,
      request: { op: requiredDefinition.op, input: { value: "a" }, idempotencyKey: "idem-disabled" },
      auth,
      nowMs,
    }, async () => ({ ok: true, op: requiredDefinition.op, requestId: "req", output: { ok: true } }))

    expect(result).toMatchObject({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.UnsupportedRuntime },
    })
  })

})
