import { describe, expect, it } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import {
  InMemoryWorkspaceBridgeAuditSink,
  SimpleWorkspaceBridgeRateLimitPolicy,
  redactWorkspaceBridgeAuditEvent,
} from "../audit"
import { createWorkspaceBridgeRegistry } from "../registry"
import { assertNoSensitiveBridgeLeaks, createTestBridgeContext, createTestBridgeOperationDefinition } from "../testing/harness"

const definition = createTestBridgeOperationDefinition({
  op: "test.v1.audit",
  callerClassesAllowed: ["server"],
  requiredCapabilities: ["test:audit"],
  timeoutMs: 5,
})

function context(capabilities = ["test:audit"]) {
  return createTestBridgeContext({
    callerClass: "server",
    workspaceId: "workspace-audit",
    sessionId: "session-audit",
    pluginId: "plugin-audit",
    tokenId: "runtime-token-id",
    capabilities,
    actor: {
      actorKind: "service",
      performedBy: { label: "service:test", id: "service-1" },
      onBehalfOf: { label: "user:redacted", id: "user-1" },
    },
  })
}

describe("WorkspaceBridge audit, redaction, and rate-limit primitives", () => {
  it("emits audit for success, denied, failed, timeout, and rate-limited in-process calls", async () => {
    const auditSink = new InMemoryWorkspaceBridgeAuditSink()
    const registry = createWorkspaceBridgeRegistry({ auditSink })
    registry.registerHandler(definition, ({ input }) => input)
    registry.registerHandler(createTestBridgeOperationDefinition({ op: "test.v1.fail" }), () => { throw new Error("boom secret-token") })
    registry.registerHandler(createTestBridgeOperationDefinition({ op: "test.v1.timeout", timeoutMs: 1 }), () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20)))

    await registry.call({ op: definition.op, input: { ok: true }, requestId: "req-success" }, context())
    await registry.call({ op: definition.op, input: { ok: true }, requestId: "req-denied" }, context([]))
    await registry.call({ op: "test.v1.fail", input: {}, requestId: "req-failed" }, context())
    await registry.call({ op: "test.v1.timeout", input: {}, requestId: "req-timeout" }, context())

    const limitedSink = new InMemoryWorkspaceBridgeAuditSink()
    const limited = createWorkspaceBridgeRegistry({
      auditSink: limitedSink,
      rateLimitPolicy: { check: () => ({ allowed: false, retryAfterMs: 100 }) },
    })
    limited.registerHandler(definition, () => ({ ok: true }))
    const rateLimited = await limited.call({ op: definition.op, input: {}, requestId: "req-rate" }, context())

    expect(auditSink.events.map((event) => event.outcome)).toEqual(["success", "denied", "failed", "timeout"])
    expect(rateLimited).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.RateLimited } })
    expect(limitedSink.events).toHaveLength(1)
    expect(limitedSink.events[0]).toMatchObject({ outcome: "rate-limited", rateLimitDecision: "denied" })
  })

  it("redacts token, full payload, file contents, full answers, host paths, stacks, and generated file-asset paths", () => {
    const event = redactWorkspaceBridgeAuditEvent({
      requestId: "req-redact",
      op: "human-input.v1.answer",
      workspaceId: "workspace-audit",
      callerClass: "browser",
      actorKind: "human",
      performedBy: { label: "user:u@example.test", id: "user-1" },
      outcome: "success",
      details: {
        token: "secret-token-value",
        authorization: "Authorization: Bearer secret-token-value",
        answer: "full private answer",
        fileContent: "private file contents",
        hostPath: "/home/ubuntu/projects/private/file.txt",
        stack: "Error: boom\n    at handler (/home/ubuntu/projects/app/server.ts:1:1)",
        payload: { full: "payload" },
        fileAssetPath: "generated/macro/private-output.parquet",
      },
    })
    const text = JSON.stringify(event)
    assertNoSensitiveBridgeLeaks(text, {
      tokens: ["secret-token-value"],
      answers: ["full private answer"],
      fileContents: ["private file contents"],
      hostPaths: ["/home/ubuntu/projects/private/file.txt", "generated/macro/private-output.parquet"],
      requestPayloads: ["{\"full\":\"payload\"}"],
    })
    expect(text).toContain("[REDACTED]")
  })

  it("uses simple rate-limit keys without actor attribution changing limiter semantics", () => {
    const policy = new SimpleWorkspaceBridgeRateLimitPolicy(1, 1_000)
    const keyInput = {
      key: "workspace:session:principal:plugin:runtime:browser:op",
      workspaceId: "workspace",
      sessionId: "session",
      principalId: "principal",
      pluginId: "plugin",
      runtimeId: "runtime",
      callerClass: "browser" as const,
      op: "op",
    }
    expect(policy.check(keyInput)).toMatchObject({ allowed: true })
    expect(policy.check(keyInput)).toMatchObject({ allowed: false })
  })
})
