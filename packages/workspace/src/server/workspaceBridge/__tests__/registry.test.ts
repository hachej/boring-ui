import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import { createWorkspaceBridgeRegistry } from "../registry"
import {
  assertNoSensitiveBridgeLeaks,
  createCapturedBridgeLogger,
  createTestBridgeContext,
  createTestBridgeOperationDefinition,
} from "../testing/harness"

describe("WorkspaceBridgeRegistry", () => {
  it("registers and calls a demo operation", async () => {
    const registry = createWorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition<{ text: string }, { text: string }>({
        op: "test.v1.echo",
        inputSchema: z.object({ text: z.string() }),
        outputSchema: z.object({ text: z.string() }),
      }),
      async ({ input }) => ({ text: input.text }),
    )

    const response = await registry.call(
      { op: "test.v1.echo", input: { text: "hello" }, requestId: "req_echo" },
      createTestBridgeContext({ callerClass: "server" }),
    )

    expect(response).toEqual({
      ok: true,
      op: "test.v1.echo",
      requestId: "req_echo",
      output: { text: "hello" },
    })
  })

  it("rejects unknown and duplicate operations with stable errors", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const definition = createTestBridgeOperationDefinition({ op: "test.v1.once" })
    registry.registerHandler(definition, () => ({}))

    await expect(registry.call(
      { op: "test.v1.missing", input: {}, requestId: "req_missing" },
      createTestBridgeContext(),
    )).resolves.toMatchObject({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.OpNotFound },
    })

    expect(() => registry.registerHandler(definition, () => ({}))).toThrow(
      expect.objectContaining({ code: WorkspaceBridgeErrorCode.DuplicateOp }),
    )
  })

  it("validates caller classes and capabilities", async () => {
    const registry = createWorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "macro.v1.series.data",
        callerClassesAllowed: ["runtime"],
        requiredCapabilities: ["macro:series.data"],
      }),
      () => ({ rows: [] }),
    )

    await expect(registry.call(
      { op: "macro.v1.series.data", input: {}, requestId: "req_browser" },
      createTestBridgeContext({ callerClass: "browser", capabilities: ["macro:series.data"] }),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })

    await expect(registry.call(
      { op: "macro.v1.series.data", input: {}, requestId: "req_cap" },
      createTestBridgeContext({ callerClass: "runtime", capabilities: [] }),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CapabilityDenied } })
  })

  it("validates input/output schemas and input/output size limits", async () => {
    const registry = createWorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition<{ value: string }, { value: string }>({
        op: "test.v1.schema",
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        maxInputBytes: 32,
        maxOutputBytes: 32,
      }),
      ({ input }) => ({ value: input.value }),
    )
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "test.v1.bad-output",
        outputSchema: z.object({ value: z.string() }),
      }),
      () => ({ value: 1 }),
    )

    const context = createTestBridgeContext()
    await expect(registry.call(
      { op: "test.v1.schema", input: { value: 1 }, requestId: "req_input_schema" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.SchemaInvalid } })

    await expect(registry.call(
      { op: "test.v1.bad-output", input: {}, requestId: "req_output_schema" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.OutputSchemaInvalid } })

    await expect(registry.call(
      { op: "test.v1.schema", input: { value: "x".repeat(100) }, requestId: "req_input_size" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InputTooLarge } })

    registry.registerHandler(
      createTestBridgeOperationDefinition<{ value: string }, { value: string }>({
        op: "test.v1.big-output",
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        maxInputBytes: 128,
        maxOutputBytes: 32,
      }),
      () => ({ value: "x".repeat(100) }),
    )

    await expect(registry.call(
      { op: "test.v1.big-output", input: { value: "ok" }, requestId: "req_output_size" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.OutputTooLarge } })
  })

  it("enforces timeouts and redacts handler failures", async () => {
    const sensitive = { tokens: ["secret-token"], answers: ["private answer"] }
    const logger = createCapturedBridgeLogger(sensitive)
    const registry = createWorkspaceBridgeRegistry({ logger })
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "test.v1.slow", timeoutMs: 5 }),
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50)),
    )
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "test.v1.fail" }),
      () => {
        throw new Error("secret-token private answer")
      },
    )

    await expect(registry.call(
      { op: "test.v1.slow", input: {}, requestId: "req_timeout" },
      createTestBridgeContext(),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.Timeout } })

    await expect(registry.call(
      { op: "test.v1.fail", input: {}, requestId: "req_fail" },
      createTestBridgeContext(),
    )).resolves.toMatchObject({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.HandlerFailed, message: "Bridge handler failed" },
    })

    const logs = logger.text()
    assertNoSensitiveBridgeLeaks(logs, sensitive)
    expect(logs).toContain("req_fail")
    expect(logs).toContain("test.v1.fail")
    expect(logs).not.toContain("private answer")
    expect(logs).not.toContain("secret-token")
  })

  it("does not leak foreign error codes/messages; canonical bridge errors pass through", async () => {
    const registry = createWorkspaceBridgeRegistry()
    // Foreign error shaped like {code,message} (e.g. Node ENOENT, store errors)
    // must NOT be surfaced verbatim — it maps to a generic HANDLER_FAILED.
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "test.v1.foreign" }),
      () => {
        throw { code: "ENOENT", message: "/host/secret/path not found" }
      },
    )
    // A genuinely canonical bridge error thrown by a handler still passes through.
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "test.v1.canonical" }),
      () => {
        throw { code: WorkspaceBridgeErrorCode.CapabilityDenied, message: "denied" }
      },
    )

    const foreign = await registry.call(
      { op: "test.v1.foreign", input: {}, requestId: "req_foreign" },
      createTestBridgeContext(),
    )
    expect(foreign).toMatchObject({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.HandlerFailed, message: "Bridge handler failed" },
    })
    expect(JSON.stringify(foreign)).not.toContain("ENOENT")
    expect(JSON.stringify(foreign)).not.toContain("/host/secret/path")

    await expect(registry.call(
      { op: "test.v1.canonical", input: {}, requestId: "req_canonical" },
      createTestBridgeContext(),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CapabilityDenied } })
  })

  it("passes emitUiEffect to handlers without treating UI effects as RPC output", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const emitUiEffect = vi.fn(async () => ({ seq: 1, status: "ok" as const }))
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "human-input.v1.request" }),
      async ({ emitUiEffect: emit }) => {
        await emit?.({ kind: "openPanel", params: { id: "questions", component: "Questions" } })
        return { questionId: "question-1" }
      },
    )

    const response = await registry.call(
      { op: "human-input.v1.request", input: {}, requestId: "req_ui" },
      { ...createTestBridgeContext(), emitUiEffect },
    )

    expect(emitUiEffect).toHaveBeenCalledWith({
      kind: "openPanel",
      params: { id: "questions", component: "Questions" },
    })
    expect(response).toMatchObject({ ok: true, output: { questionId: "question-1" } })
  })
})
