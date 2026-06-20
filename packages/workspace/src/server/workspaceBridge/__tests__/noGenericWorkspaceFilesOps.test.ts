import { describe, expect, test } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import { defineTrustedDomainBridgeHandler } from "../trustedDomainHandler"
import { WorkspaceBridgeRegistry } from "../registry"
import { assertNoGenericWorkspaceFilesOps, createTestBridgeOperationDefinition } from "../testing/harness"

describe("WorkspaceBridge v1 no generic workspace-files API guardrail", () => {
  test("registered bridge definitions must not include workspace-files.v1 operations", () => {
    const registry = new WorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "example.v1.records.read" }),
      () => ({ values: [] }),
    )

    expect(() => assertNoGenericWorkspaceFilesOps(registry.listDefinitions())).not.toThrow()
    expect(() => registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "workspace-files.v1.read" }),
      () => ({ content: "not allowed" }),
    )).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }))
  })

  test("trusted domain helper also rejects workspace-files.v1 operations", () => {
    expect(() => defineTrustedDomainBridgeHandler({
      op: "workspace-files.v1.read",
      version: 1,
      owner: "files",
      callerClassesAllowed: ["server"],
      requiredCapabilities: ["files:read"],
      inputSchema: { type: "object" },
      maxOutputBytes: 1024,
      handler: () => ({ content: "not allowed" }),
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }))
  })
})
