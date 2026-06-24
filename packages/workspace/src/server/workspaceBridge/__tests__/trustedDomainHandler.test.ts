import { describe, expect, test } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import { createTestBridgeContext } from "../testing/harness"
import { WorkspaceBridgeRegistry } from "../registry"
import { defineTrustedDomainBridgeHandler } from "../trustedDomainHandler"

describe("defineTrustedDomainBridgeHandler", () => {
  test("registers and calls a trusted domain operation", async () => {
    const registration = defineTrustedDomainBridgeHandler<{ value: string }, { value: string }>({
      op: "demo.v1.echo",
      version: 1,
      owner: "demo-domain",
      callerClassesAllowed: ["server"],
      requiredCapabilities: ["demo:echo"],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      maxOutputBytes: 1024,
      handler: ({ input }) => ({ value: input.value }),
    })
    const registry = new WorkspaceBridgeRegistry()
    registry.registerHandler(registration.definition, registration.handler)

    const response = await registry.call({ op: "demo.v1.echo", input: { value: "ok" } }, createTestBridgeContext({
      capabilities: ["demo:echo"],
    }))

    expect(response).toMatchObject({ ok: true, output: { value: "ok" } })
  })

  test("rejects missing trusted metadata", () => {
    expect(() => defineTrustedDomainBridgeHandler({
      op: "demo.v1.missing-owner",
      version: 1,
      owner: "",
      callerClassesAllowed: ["server"],
      requiredCapabilities: [],
      inputSchema: { type: "object" },
      maxOutputBytes: 1024,
      handler: () => ({}),
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }))
  })

  test("rejects unversioned ops when policy requires versioning", () => {
    expect(() => defineTrustedDomainBridgeHandler({
      op: "demo.echo",
      version: 1,
      owner: "demo-domain",
      callerClassesAllowed: ["server"],
      requiredCapabilities: [],
      inputSchema: { type: "object" },
      maxOutputBytes: 1024,
      handler: () => ({}),
    })).toThrow(/versioned/)
  })

  test("rejects reserved generic workspace-files ops", () => {
    expect(() => defineTrustedDomainBridgeHandler({
      op: "workspace-files.v1.read",
      version: 1,
      owner: "demo-domain",
      callerClassesAllowed: ["server"],
      requiredCapabilities: [],
      inputSchema: { type: "object" },
      maxOutputBytes: 1024,
      handler: () => ({}),
    })).toThrow(/reserved prefix/)
  })

  test("enforces output byte limit through registry definition", async () => {
    const registration = defineTrustedDomainBridgeHandler({
      op: "demo.v1.large-output",
      version: 1,
      owner: "demo-domain",
      callerClassesAllowed: ["server"],
      requiredCapabilities: [],
      inputSchema: { type: "object" },
      maxOutputBytes: 8,
      handler: () => ({ value: "this output is too large" }),
    })
    const registry = new WorkspaceBridgeRegistry()
    registry.registerHandler(registration.definition, registration.handler)

    const response = await registry.call({ op: "demo.v1.large-output", input: {} }, createTestBridgeContext())

    expect(response).toMatchObject({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.OutputTooLarge },
    })
  })
})
