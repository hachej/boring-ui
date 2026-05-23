import { describe, expect, it } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import {
  BRIDGE_TEST_REDACTION,
  assertNoGenericWorkspaceFilesOps,
  assertNoSensitiveBridgeLeaks,
  createCapturedBridgeLogger,
  createFakeBridgeAuthPolicy,
  createFakeClock,
  createFakeRateLimiter,
  createTestActor,
  createTestAuditContext,
  createTestBridgeContext,
  createTestBridgeOperationDefinition,
  createTestFileAssetPointer,
  createTestRuntimeTokenClaims,
} from "../testing/harness"

describe("WorkspaceBridge test harness", () => {
  it("builds server, browser, and runtime bridge contexts without core auth/db imports", () => {
    const browser = createTestBridgeContext({ callerClass: "browser" })
    const runtime = createTestBridgeContext({ callerClass: "runtime" })
    const server = createTestBridgeContext({ callerClass: "server" })

    expect(browser.actor.actorKind).toBe("human")
    expect(runtime.actor.actorKind).toBe("agent")
    expect(server.actor.actorKind).toBe("system")
  })

  it("fakes auth policy capability/resource resolution and runtime token claims", () => {
    const token = createTestRuntimeTokenClaims({
      jti: "jti-secret-token",
      capabilities: ["macro:catalog.search", "macro:series.data"],
    })
    const policy = createFakeBridgeAuthPolicy({
      resourceScopes: { paths: ["generated/out.json"] },
    })

    const resolved = policy.resolve({ callerClass: "runtime", token })

    expect(resolved.context.tokenId).toBe("jti-secret-token")
    expect(resolved.effectiveCapabilities).toContain("macro:series.data")
    expect(resolved.resourceScopes).toMatchObject({
      workspaceId: "workspace-test",
      sessionId: "session-test",
      pluginId: "plugin-test",
      paths: ["generated/out.json"],
    })
  })

  it("provides actor attribution fixtures for every actor kind", () => {
    expect(createTestActor("human").actorKind).toBe("human")
    expect(createTestActor("agent").actorKind).toBe("agent")
    expect(createTestActor("system").actorKind).toBe("system")
    expect(createTestActor("service").actorKind).toBe("service")

    const requestBody = { actorKind: "system", performedBy: "spoofed" }
    const context = createTestBridgeContext({ callerClass: "browser" })

    expect(requestBody.actorKind).toBe("system")
    expect(context.actor.actorKind).toBe("human")
  })

  it("catches deliberate token, answer, file-content, host-path, payload, bearer, and stack leaks", () => {
    const sensitive = {
      tokens: ["bridge-token-secret"],
      authorizationHeaders: ["Authorization: Bearer bridge-token-secret"],
      answers: ["my private answer"],
      fileContents: ["secret file contents"],
      hostPaths: ["/home/ubuntu/projects/private/file.txt"],
      requestPayloads: ["{\"full\":\"payload\"}"],
    }
    const leaked = [
      "Authorization: Bearer bridge-token-secret",
      "my private answer",
      "secret file contents",
      "/home/ubuntu/projects/private/file.txt",
      "{\"full\":\"payload\"}",
      "Error: boom\n    at handler (/tmp/server.ts:1:1)",
    ].join("\n")

    expect(() => assertNoSensitiveBridgeLeaks(leaked, sensitive)).toThrow(/Bridge log leaked/)

    const logger = createCapturedBridgeLogger(sensitive)
    logger.info("bridge request handled", {
      requestId: "req_1",
      toolCallId: "tool_1",
      questionId: "question_1",
      sessionId: "session_1",
      workspaceId: "workspace_1",
      op: "human-input.v1.answer",
      callerClass: "browser",
      token: "bridge-token-secret",
      answer: "my private answer",
      fileContent: "secret file contents",
      hostPath: "/home/ubuntu/projects/private/file.txt",
      payload: "{\"full\":\"payload\"}",
    })

    const text = logger.text()
    assertNoSensitiveBridgeLeaks(text, sensitive)
    expect(text).toContain("req_1")
    expect(text).toContain("human-input.v1.answer")
    expect(text).toContain(BRIDGE_TEST_REDACTION)
  })

  it("supports sample operation, audit, clock, rate-limit, and file-asset fixtures", () => {
    const op = createTestBridgeOperationDefinition({
      op: "macro.v1.catalog.search",
      callerClassesAllowed: ["browser", "runtime", "server"],
      requiredCapabilities: ["macro:catalog.search"],
      auditCategory: "macro",
    })
    const audit = createTestAuditContext({
      op: op.op,
      callerClass: "runtime",
      actor: createTestActor("agent"),
      auditCategory: "macro",
    })
    const clock = createFakeClock()
    const limiter = createFakeRateLimiter(true)
    const asset = createTestFileAssetPointer({ path: "generated/macro/catalog.json" })

    expect(op.requiredCapabilities).toEqual(["macro:catalog.search"])
    expect(audit).toMatchObject({ op: "macro.v1.catalog.search", callerClass: "runtime" })
    expect(clock.advanceMs(1_000).toISOString()).toBe("2026-01-01T00:00:01.000Z")
    expect(limiter.check("runtime:macro.v1.catalog.search")).toEqual({
      key: "runtime:macro.v1.catalog.search",
      allowed: true,
    })
    expect(asset).toMatchObject({ kind: "file-asset", path: "generated/macro/catalog.json" })
  })

  it("fails fast if a generic workspace-files bridge op is registered", () => {
    expect(() => assertNoGenericWorkspaceFilesOps([
      createTestBridgeOperationDefinition({ op: "macro.v1.series.data" }),
    ])).not.toThrow()

    expect(() => assertNoGenericWorkspaceFilesOps([
      createTestBridgeOperationDefinition({ op: "workspace-files.v1.write" }),
    ])).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }))
  })
})
