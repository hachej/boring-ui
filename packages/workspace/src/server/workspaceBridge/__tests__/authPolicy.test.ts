import { describe, expect, it } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import {
  createBrowserBridgeAuthPolicy,
  createLocalCliBridgeAuthPolicy,
  type BridgePrincipal,
} from "../authPolicy"
import { createTestBridgeOperationDefinition } from "../testing/harness"

const browserOp = createTestBridgeOperationDefinition({
  op: "example.v1.respond",
  callerClassesAllowed: ["browser"],
  requiredCapabilities: ["example:respond"],
})

const runtimeOnlyOp = createTestBridgeOperationDefinition({
  op: "example.v1.records.write",
  callerClassesAllowed: ["runtime"],
  requiredCapabilities: ["example:records.write"],
})

describe("BridgeAuthPolicy adapters", () => {
  it("allows an authenticated browser caller for an allowed workspace operation", async () => {
    const policy = createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1", email: "u1@example.test" }),
      authorizeWorkspace: ({ workspaceId }) => ({
        allowed: workspaceId === "workspace-1",
        role: "member",
        capabilities: ["example:respond"],
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
      capabilities: ["example:respond"],
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
        capabilities: ["example:respond"],
      }),
    })

    await expect(policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-2",
    })).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.ResourceScopeDenied })

    const unauthenticated = createBrowserBridgeAuthPolicy({
      getPrincipal: () => null,
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["example:respond"] }),
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
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["example:records.write"] }),
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
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["example:respond"] }),
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
      capabilities: ["example:respond"],
    })

    const resolved = await policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "workspace-local",
    })

    expect(resolved.context).toMatchObject({
      callerClass: "browser",
      workspaceId: "workspace-local",
      actor: { actorKind: "human", performedBy: { id: "local", label: "local-cli:user" } },
    })
    expect(resolved.principal).toEqual({ userId: "local" })
  })

  it("can force local CLI browser callers to the single-tenant owner workspace", async () => {
    const policy = createLocalCliBridgeAuthPolicy({
      workspaceId: "default",
      capabilities: ["example:respond"],
      forceOwnerWorkspaceId: true,
    })

    const resolved = await policy.resolve({
      callerClass: "browser",
      definition: browserOp,
      workspaceId: "cosmetic-front-workspace-id",
      sessionId: "session-1",
    })

    expect(resolved.context).toMatchObject({
      callerClass: "browser",
      workspaceId: "default",
      sessionId: "session-1",
    })
    expect(resolved.resourceScope).toMatchObject({ workspaceId: "default", sessionId: "session-1" })
  })

  it("denies local CLI browser callers for a workspace other than the configured one", async () => {
    const policy = createLocalCliBridgeAuthPolicy({
      workspaceId: "workspace-local",
      capabilities: ["example:respond"],
    })

    // resolve() is synchronous for the local-cli policy, so normalize its throw
    // into a rejection before asserting on the stable error code.
    await expect(
      (async () => policy.resolve({
        callerClass: "browser",
        definition: browserOp,
        workspaceId: "workspace-other",
      }))(),
    ).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.ResourceScopeDenied })
  })
})
