import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import {
  DEFAULT_WORKSPACE_BRIDGE_RUNTIME_REFRESH_TOKEN_TTL_MS,
  MAX_WORKSPACE_BRIDGE_RUNTIME_TOKEN_TTL_MS,
  WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE,
  WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
  mintWorkspaceBridgeRuntimeRefreshToken,
  mintWorkspaceBridgeRuntimeToken,
  verifyWorkspaceBridgeRuntimeRefreshToken,
  verifyWorkspaceBridgeRuntimeToken,
} from "../runtimeToken"
import { assertNoSensitiveBridgeLeaks } from "../testing/harness"

const SECRET = "workspace-bridge-runtime-token-secret-32bytes"
const OTHER_SECRET = "workspace-bridge-runtime-token-secret-other"
const NOW = Date.parse("2026-01-01T00:00:00.000Z")

function mint(overrides: Partial<Parameters<typeof mintWorkspaceBridgeRuntimeToken>[0]> = {}) {
  return mintWorkspaceBridgeRuntimeToken({
    secret: SECRET,
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runtimeId: "runtime-1",
    capabilities: ["example:catalog.search", "example:records.read"],
    nowMs: NOW,
    ttlMs: 60_000,
    jti: "jti-1",
    ...overrides,
  })
}

describe("WorkspaceBridge runtime token primitives", () => {
  it("mints and verifies a scoped runtime token", () => {
    const token = mint()
    const verified = verifyWorkspaceBridgeRuntimeToken(token, {
      secret: SECRET,
      nowMs: NOW + 1_000,
      requiredCapabilities: ["example:catalog.search"],
    })

    expect(verified.claims).toMatchObject({
      aud: WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runtimeId: "runtime-1",
      jti: "jti-1",
    })
    expect(verified.authContext).toMatchObject({
      callerClass: "runtime",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      tokenId: "jti-1",
      actor: {
        actorKind: "agent",
        performedBy: { label: "runtime:runtime-1", id: "runtime-1" },
        onBehalfOf: { label: "session:session-1" },
      },
    })
  })

  it("rejects expired, malformed, wrong audience, and wrong signature tokens", () => {
    expect(() => verifyWorkspaceBridgeRuntimeToken(mint({ ttlMs: 1_000 }), {
      secret: SECRET,
      nowMs: NOW + 2_000,
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.ExpiredToken }))

    expect(() => verifyWorkspaceBridgeRuntimeToken("not.a.jwt", {
      secret: SECRET,
      nowMs: NOW,
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidToken }))

    expect(() => verifyWorkspaceBridgeRuntimeToken(mint({ secret: OTHER_SECRET }), {
      secret: SECRET,
      nowMs: NOW,
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidToken }))

    const wrongAudience = mintTamperedPayload({ aud: "other" })
    expect(() => verifyWorkspaceBridgeRuntimeToken(wrongAudience, {
      secret: SECRET,
      nowMs: NOW,
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidToken }))
  })

  it("mints refresh tokens with bounded defaults and call-token ttl claims", () => {
    const refreshToken = mintWorkspaceBridgeRuntimeRefreshToken({
      secret: SECRET,
      workspaceId: "workspace-1",
      capabilities: ["example:records.read"],
      nowMs: NOW,
      tokenTtlMs: 999 * 60_000,
      jti: "refresh-jti",
    })
    const verified = verifyWorkspaceBridgeRuntimeRefreshToken(refreshToken, { secret: SECRET, nowMs: NOW + 1_000 })

    expect(verified.claims).toMatchObject({
      aud: WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE,
      workspaceId: "workspace-1",
      jti: "refresh-jti",
      tokenTtlMs: MAX_WORKSPACE_BRIDGE_RUNTIME_TOKEN_TTL_MS,
    })
    expect((verified.claims.exp - verified.claims.iat) * 1000).toBe(DEFAULT_WORKSPACE_BRIDGE_RUNTIME_REFRESH_TOKEN_TTL_MS)
  })

  it("rejects missing capabilities", () => {
    expect(() => verifyWorkspaceBridgeRuntimeToken(mint(), {
      secret: SECRET,
      nowMs: NOW,
      requiredCapabilities: ["example:query"],
    })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.CapabilityDenied }))
  })

  it("derives actor attribution from token claims, not request bodies", () => {
    const token = mint({ runtimeId: "macro-sdk" })
    const body = {
      actor: { actorKind: "system", performedBy: { label: "spoofed-admin" } },
    }
    const verified = verifyWorkspaceBridgeRuntimeToken(token, {
      secret: SECRET,
      nowMs: NOW,
    })

    expect(body.actor.actorKind).toBe("system")
    expect(verified.authContext.actor).toMatchObject({
      actorKind: "agent",
      performedBy: { label: "runtime:macro-sdk", id: "macro-sdk" },
    })
  })

  it("does not include token values in thrown errors or diagnostics", () => {
    const token = mint()
    let message = ""
    try {
      verifyWorkspaceBridgeRuntimeToken(`${token.slice(0, -2)}xx`, {
        secret: SECRET,
        nowMs: NOW,
      })
    } catch (err) {
      message = JSON.stringify(err)
    }

    assertNoSensitiveBridgeLeaks(message, { tokens: [token] })
    expect(message).toContain(WorkspaceBridgeErrorCode.InvalidToken)
    expect(message).not.toContain(token)
  })
})

function mintTamperedPayload(overrides: Record<string, unknown>): string {
  const token = mint()
  const [header, payload] = token.split(".")
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  const tampered = Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString("base64url")
  return `${header}.${tampered}.${sign(`${header}.${tampered}`)}`
}

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("base64url")
}
