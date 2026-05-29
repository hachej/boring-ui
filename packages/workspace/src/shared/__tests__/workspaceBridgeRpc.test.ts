import { describe, expect, expectTypeOf, it } from "vitest"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeActorAttribution,
  type BridgeAuthContext,
  type BridgeCallerClass,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeFileAssetPointer,
  type WorkspaceBridgeOperationDefinition,
} from "../workspace-bridge-rpc"

describe("WorkspaceBridge RPC shared contracts", () => {
  it("types a sample operation definition and call response", () => {
    interface Input {
      query: string
    }
    interface Output {
      rows: Array<Record<string, unknown>>
    }

    const definition = {
      op: "macro.v1.sql.query",
      version: 1,
      owner: "macro",
      callerClassesAllowed: ["runtime", "server"],
      requiredCapabilities: ["macro:sql.query"],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: 5_000,
      maxInputBytes: 16_384,
      maxOutputBytes: 262_144,
      idempotencyPolicy: "none",
    } satisfies WorkspaceBridgeOperationDefinition<Input, Output>

    const request = {
      op: definition.op,
      input: { query: "SELECT 1" },
      requestId: "req_test",
    } satisfies WorkspaceBridgeCallRequest<Input>

    const response: WorkspaceBridgeCallResponse<Output> = {
      ok: true,
      op: definition.op,
      requestId: request.requestId,
      output: { rows: [{ value: 1 }] },
    }

    expect(response.output.rows).toHaveLength(1)
    expectTypeOf<BridgeCallerClass>().toEqualTypeOf<
      "browser" | "runtime" | "server"
    >()
  })

  it("keeps actor attribution in trusted auth context, not request bodies", () => {
    const actor = {
      actorKind: "agent",
      performedBy: { label: "agent:macro-sdk", id: "agent_123" },
      onBehalfOf: { label: "user:redacted" },
    } satisfies BridgeActorAttribution

    const auth = {
      callerClass: "runtime",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      pluginId: "macro",
      capabilities: ["macro:catalog.search"],
      actor,
      tokenId: "jti-redacted",
    } satisfies BridgeAuthContext

    const request = {
      op: "macro.v1.catalog.search",
      input: { q: "gdp" },
      requestId: "req_actor",
    } satisfies WorkspaceBridgeCallRequest<{ q: string }>

    expect(auth.actor.actorKind).toBe("agent")
    expect(Object.prototype.hasOwnProperty.call(request, "actor")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(request, "callerClass")).toBe(false)
  })

  it("centralizes bridge error codes and file-asset pointers", () => {
    const error = createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.OpNotFound,
      "Operation is not registered",
    )
    const asset = {
      kind: "file-asset",
      path: "generated/macro/result.parquet",
      contentType: "application/octet-stream",
      byteLength: 42,
      rawUrl: "/api/v1/files/raw?path=generated%2Fmacro%2Fresult.parquet",
    } satisfies WorkspaceBridgeFileAssetPointer

    expect(error).toEqual({
      code: WorkspaceBridgeErrorCode.OpNotFound,
      message: "Operation is not registered",
    })
    expect(asset.kind).toBe("file-asset")
  })
})
