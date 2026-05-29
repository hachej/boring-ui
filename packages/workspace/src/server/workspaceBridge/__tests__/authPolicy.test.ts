import { describe, expect, it } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import {
  createBrowserBridgeAuthPolicy,
  createLocalCliBridgeAuthPolicy,
  type BridgePrincipal,
} from "../authPolicy"
import { createTestBridgeOperationDefinition } from "../testing/harness"

const browserOp = createTestBridgeOperationDefinition({
  op: "human-input.v1.answer",
  callerClassesAllowed: ["browser"],
  requiredCapabilities: ["human-input:answer"],
})

const runtimeOnlyOp = createTestBridgeOperationDefinition({
  op: "macro.v1.transform.persist",
  callerClassesAllowed: ["runtime"],
  requiredCapabilities: ["macro:transform.persist"],
})

const transcriptOp = createTestBridgeOperationDefinition({
  op: "human-input.v1.transcript",
  callerClassesAllowed: ["browser", "server"],
  requiredCapabilities: ["human-input:transcript.read"],
})

describe("BridgeAuthPolicy adapters", () => {
  it("allows an authenticated browser caller for an allowed workspace operation", async () => {
    const policy = createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1", email: "u1@example.test" }),
      authorizeWorkspace: ({ workspaceId }) => ({
        allowed: workspaceId === "workspace-1",
        role: "member",
        capabilities: ["human-input:answer"],
      }),
      allowedOrigins: ["https://app.example.test"],
      requireCsrfHeader: true,
    })

    const resolved = await policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      request: {
        headers: {
          origin: "https://app.example.test",
          "x-csrf-token": "csrf-proof",
        },
      },
    })

    expect(resolved.context).toMatchObject({
      callerClass: "browser",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      capabilities: ["human-input:answer"],
      actor: {
        actorKind: "human",
        performedBy: { label: "user:u1@example.test", id: "user-1" },
      },
    })
    expect(resolved.resourceScope).toMatchObject({ workspaceId: "workspace-1", role: "member" })
  })

  it("denies same user for the wrong workspace and unauthenticated requests", async () => {
    const principal: BridgePrincipal = { userId: "user-1" }
    const policy = createBrowserBridgeAuthPolicy({
      getPrincipal: () => principal,
      authorizeWorkspace: ({ workspaceId }) => ({
        allowed: workspaceId === "workspace-1",
        capabilities: ["human-input:answer"],
      }),
    })

    await expect(policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-2",
    })).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.ResourceScopeDenied })

    const unauthenticated = createBrowserBridgeAuthPolicy({
      getPrincipal: () => null,
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["human-input:answer"] }),
    })
    await expect(unauthenticated.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.AuthRequired })
  })

  it("denies browser callers for runtime-only operations", async () => {
    const policy = createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1" }),
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["macro:transform.persist"] }),
    })

    await expect(policy.resolve({
      callerClass: "browser",
      definition: runtimeOnlyOp,
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.CallerNotAllowed })
  })

  it("ignores browser body spoofing for callerClass, workspace, session, and actor attribution", async () => {
    const policy = createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1" }),
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["human-input:answer"] }),
    })
    const body = {
      callerClass: "server",
      workspaceId: "workspace-admin",
      sessionId: "session-admin",
      actor: { actorKind: "system", performedBy: { label: "root" } },
    }

    const resolved = await policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      body,
    })

    expect(resolved.context.callerClass).toBe("browser")
    expect(resolved.context.workspaceId).toBe("workspace-1")
    expect(resolved.context.sessionId).toBe("session-1")
    expect(resolved.context.actor).toMatchObject({
      actorKind: "human",
      performedBy: { id: "user-1" },
    })
  })

  it("supports local CLI/no-auth browser policy without Better Auth or core DB", async () => {
    const policy = createLocalCliBridgeAuthPolicy({
      workspaceId: "workspace-local",
      capabilities: ["human-input:answer"],
    })

    const resolved = await policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-local",
    })

    expect(resolved.context).toMatchObject({
      callerClass: "browser",
      workspaceId: "workspace-local",
      actor: { actorKind: "human", performedBy: { label: "local-cli:user" } },
    })
  })

  it("represents super-admin/debug transcript access while normal browser is denied", async () => {
    const normal = createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1", roles: ["member"] }),
      authorizeWorkspace: () => ({ allowed: true, capabilities: [] }),
    })
    await expect(normal.resolve({
      callerClass: "browser",
      definition: transcriptOp,
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.CapabilityDenied })

    const debug = createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "debug-1", roles: ["debug"] }),
      authorizeWorkspace: () => ({ allowed: true, capabilities: [] }),
    })
    await expect(debug.resolve({
      callerClass: "browser",
      definition: transcriptOp,
      workspaceId: "workspace-1",
    })).resolves.toMatchObject({
      context: { capabilities: ["human-input:transcript.read"] },
    })
  })
})
