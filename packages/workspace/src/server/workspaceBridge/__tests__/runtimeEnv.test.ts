import { describe, expect, it } from "vitest"
import {
  WORKSPACE_BRIDGE_DISABLED_ENV,
  WORKSPACE_BRIDGE_TOKEN_ENV,
  WORKSPACE_BRIDGE_URL_ENV,
} from "../../../shared/workspace-bridge-rpc"
import { createWorkspaceBridgeRegistry } from "../registry"
import {
  createWorkspaceBridgeRuntimeEnvContribution,
  type WorkspaceBridgeRuntimePlacement,
} from "../runtimeEnv"

const SECRET = "workspace-bridge-runtime-token-secret-32bytes"

function getEnvFor(options: {
  bridgeUrl: string
  bundle?: Record<string, unknown>
  runtimePlacement?: WorkspaceBridgeRuntimePlacement
}): Record<string, string> {
  const contribution = createWorkspaceBridgeRuntimeEnvContribution({
    workspaceId: "workspace-1",
    runtimeMode: "local",
    registry: createWorkspaceBridgeRegistry(),
    runtimeTokenSecret: SECRET,
    runtimeEnv: { bridgeUrl: options.bridgeUrl, capabilities: ["runtime:echo"] },
    runtimePlacement: options.runtimePlacement,
  })
  expect(contribution).toBeTruthy()
  return contribution!.getEnv({
    workspaceId: "workspace-1",
    workspaceRoot: "/tmp/workspace-1",
    runtimeMode: "local",
    runtimeBundle: options.bundle,
  } as never) as Record<string, string>
}

describe("createWorkspaceBridgeRuntimeEnvContribution placement", () => {
  // These exercise the PRODUCTION code path: ctx.runtimeBundle markers drive
  // remoteness (provider-neutral, replacing the old runtimeMode==="vercel-sandbox").
  it("treats a remote-workspace filesystem bundle as remote and refuses a plaintext non-loopback bridge URL", () => {
    const env = getEnvFor({ bridgeUrl: "http://bridge.test/", bundle: { filesystem: { kind: "remote-workspace" } } })
    expect(env[WORKSPACE_BRIDGE_DISABLED_ENV]).toBe("remote-bridge-url-must-be-https")
    expect(env[WORKSPACE_BRIDGE_TOKEN_ENV]).toBeUndefined()
  })

  it("treats a remote bash bundle as remote and refuses a plaintext non-loopback bridge URL", () => {
    const env = getEnvFor({ bridgeUrl: "http://bridge.test/", bundle: { bash: { kind: "remote" } } })
    expect(env[WORKSPACE_BRIDGE_DISABLED_ENV]).toBe("remote-bridge-url-must-be-https")
  })

  it("injects a token for a local bundle over https", () => {
    const env = getEnvFor({ bridgeUrl: "https://bridge.test/", bundle: {} })
    expect(env[WORKSPACE_BRIDGE_DISABLED_ENV]).toBeUndefined()
    expect(env[WORKSPACE_BRIDGE_URL_ENV]).toBe("https://bridge.test/api/v1/workspace-bridge/call")
    expect(env[WORKSPACE_BRIDGE_TOKEN_ENV]).toBeTruthy()
  })

  it("lets a bundle remote marker override a 'local' runtimePlacement fallback", () => {
    const env = getEnvFor({
      bridgeUrl: "http://bridge.test/",
      bundle: { filesystem: { kind: "remote-workspace" } },
      runtimePlacement: "local",
    })
    expect(env[WORKSPACE_BRIDGE_DISABLED_ENV]).toBe("remote-bridge-url-must-be-https")
  })

  it("uses the runtimePlacement fallback only when the bundle carries no placement markers", () => {
    const env = getEnvFor({ bridgeUrl: "http://bridge.test/", bundle: {}, runtimePlacement: "remote" })
    expect(env[WORKSPACE_BRIDGE_DISABLED_ENV]).toBe("remote-bridge-url-must-be-https")
  })
})
