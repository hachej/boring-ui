import { describe, expect, test } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import { defineTrustedDomainBridgeHandler } from "../trustedDomainHandler"
import { WorkspaceBridgeRegistry } from "../registry"
import { assertNoGenericWorkspaceFilesOps, createTestBridgeOperationDefinition } from "../testing/harness"

describe("WorkspaceBridge v1 no generic workspace-files API guardrail", () => {
  test("registered bridge definitions must not include workspace-files.v1 operations", () => {
    const registry = new WorkspaceBridgeRegistry()
    registry.registerHandler(
      createTestBridgeOperationDefinition({ op: "macro.v1.series.data" }),
      () => ({ values: [] }),
    )

    expect(() => assertNoGenericWorkspaceFilesOps(registry.listDefinitions())).not.toThrow()
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
      auditCategory: "system",
      handler: () => ({ content: "not allowed" }),
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }))
  })
})
