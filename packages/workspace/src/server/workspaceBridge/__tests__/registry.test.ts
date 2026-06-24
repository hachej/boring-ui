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

  it("rejects malformed operation definitions before registration", () => {
    const registry = createWorkspaceBridgeRegistry()
    const missingMaxInputBytes = createTestBridgeOperationDefinition({ op: "test.v1.malformed" }) as unknown as Record<string, unknown>
    delete missingMaxInputBytes.maxInputBytes
    const nullInputSchema = createTestBridgeOperationDefinition({ op: "test.v1.null-schema" }) as unknown as Record<string, unknown>
    nullInputSchema.inputSchema = null
    const unsupportedKeyword = createTestBridgeOperationDefinition({
      op: "test.v1.unsupported-schema-key",
      inputSchema: { type: "string", minLength: 1 },
    })
    const unsupportedAdditionalPropertiesSchema = createTestBridgeOperationDefinition({
      op: "test.v1.unsupported-additional-properties-schema",
      inputSchema: { type: "object", additionalProperties: { type: "string" } },
    })

    expect(() => registry.registerHandler(missingMaxInputBytes as never, () => ({}))).toThrow(
      expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }),
    )
    expect(() => registry.registerHandler(nullInputSchema as never, () => ({}))).toThrow(
      expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }),
    )
    expect(() => registry.registerHandler(unsupportedKeyword, () => ({}))).toThrow(
      expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }),
    )
    expect(() => registry.registerHandler(unsupportedAdditionalPropertiesSchema, () => ({}))).toThrow(
      expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }),
    )
  })

  it("validates caller classes and capabilities", async () => {
    const registry = createWorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "example.v1.records.read",
        callerClassesAllowed: ["runtime"],
        requiredCapabilities: ["example:records.read"],
      }),
      () => ({ rows: [] }),
    )

    await expect(registry.call(
      { op: "example.v1.records.read", input: {}, requestId: "req_browser" },
      createTestBridgeContext({ callerClass: "browser", capabilities: ["example:records.read"] }),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })

    await expect(registry.call(
      { op: "example.v1.records.read", input: {}, requestId: "req_cap" },
      createTestBridgeContext({ callerClass: "runtime", capabilities: [] }),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CapabilityDenied } })
  })

  it("rejects calls from the wrong workspace unless the op explicitly opts into cross-workspace", async () => {
    const registry = createWorkspaceBridgeRegistry({ ownerWorkspaceId: "workspace-b" })
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "test.v1.tenant-scoped",
        callerClassesAllowed: ["runtime"],
        requiredCapabilities: ["test:read"],
      }),
      () => ({ ok: true }),
    )
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "test.v1.cross-workspace",
        callerClassesAllowed: ["runtime"],
        requiredCapabilities: ["test:read"],
        allowCrossWorkspace: true,
      }),
      () => ({ ok: true }),
    )

    await expect(registry.call(
      { op: "test.v1.tenant-scoped", input: {}, requestId: "req_wrong_workspace" },
      createTestBridgeContext({ callerClass: "runtime", workspaceId: "workspace-a", capabilities: ["test:read"] }),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })

    await expect(registry.call(
      { op: "test.v1.cross-workspace", input: {}, requestId: "req_cross_workspace" },
      createTestBridgeContext({ callerClass: "runtime", workspaceId: "workspace-a", capabilities: ["test:read"] }),
    )).resolves.toMatchObject({ ok: true })
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
      { op: "test.v1.bad-output", input: null, requestId: "req_json_schema_type" },
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

  it("validates nested JSON-schema-shaped schemas", async () => {
    const registry = createWorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "test.v1.json-schema",
        inputSchema: {
          type: "object",
          required: ["record"],
          additionalProperties: false,
          properties: {
            record: {
              type: "object",
              required: ["id", "tags"],
              properties: {
                id: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                status: { type: "string", enum: ["open", "closed"] },
              },
              additionalProperties: false,
            },
          },
        },
        outputSchema: { type: "object" },
      }),
      ({ input }) => input,
    )
    registry.registerHandler(
      createTestBridgeOperationDefinition({
        op: "test.v1.json-schema-const",
        inputSchema: { type: "object", const: { a: 1, b: 2 } },
        outputSchema: { type: "object" },
      }),
      ({ input }) => input,
    )

    const context = createTestBridgeContext()
    await expect(registry.call(
      { op: "test.v1.json-schema", input: { record: { id: "r1", tags: ["a"], status: "open" } }, requestId: "req_json_ok" },
      context,
    )).resolves.toMatchObject({ ok: true })

    await expect(registry.call(
      { op: "test.v1.json-schema-const", input: { b: 2, a: 1 }, requestId: "req_json_const_order" },
      context,
    )).resolves.toMatchObject({ ok: true })

    await expect(registry.call(
      { op: "test.v1.json-schema", input: { record: { tags: ["a"] } }, requestId: "req_json_required" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.SchemaInvalid } })

    await expect(registry.call(
      { op: "test.v1.json-schema", input: { record: { id: "r1", tags: [1] } }, requestId: "req_json_items" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.SchemaInvalid } })

    await expect(registry.call(
      { op: "test.v1.json-schema", input: { record: { id: "r1", tags: [], extra: true } }, requestId: "req_json_extra" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.SchemaInvalid } })

    await expect(registry.call(
      { op: "test.v1.json-schema", input: { record: { id: "r1", tags: [], toString: true } }, requestId: "req_json_proto_extra" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.SchemaInvalid } })

    await expect(registry.call(
      { op: "test.v1.json-schema", input: { record: { id: "r1", tags: [], status: "stale" } }, requestId: "req_json_enum" },
      context,
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.SchemaInvalid } })
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
      createTestBridgeOperationDefinition({ op: "example.v1.prompt.request" }),
      async ({ emitUiEffect: emit }) => {
        await emit?.({ kind: "openPanel", params: { id: "questions", component: "Questions" } })
        return { questionId: "question-1" }
      },
    )

    const response = await registry.call(
      { op: "example.v1.prompt.request", input: {}, requestId: "req_ui" },
      { ...createTestBridgeContext(), emitUiEffect },
    )

    expect(emitUiEffect).toHaveBeenCalledWith({
      kind: "openPanel",
      params: { id: "questions", component: "Questions" },
    })
    expect(response).toMatchObject({ ok: true, output: { questionId: "question-1" } })
  })
})
