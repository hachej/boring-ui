import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceBridgeErrorCode } from "../../../shared/workspace-bridge-rpc"
import { createBrowserBridgeAuthPolicy } from "../authPolicy"
import { InMemoryWorkspaceBridgeIdempotencyStore } from "../idempotency"
import { InMemoryWorkspaceBridgeRuntimeRefreshTokenStore } from "../refreshTokenStore"
import { createWorkspaceBridgeRegistry } from "../registry"
import { mintWorkspaceBridgeRuntimeRefreshToken, mintWorkspaceBridgeRuntimeToken, verifyWorkspaceBridgeRuntimeRefreshToken, verifyWorkspaceBridgeRuntimeToken } from "../runtimeToken"
import { workspaceBridgeHttpRoutes } from "../httpRoutes"
import { assertNoSensitiveBridgeLeaks, createTestBridgeOperationDefinition } from "../testing/harness"

const SECRET = "workspace-bridge-runtime-token-secret-32bytes"
const REFRESH_SECRET = "workspace-bridge-runtime-refresh-secret-32bytes"

async function makeApp() {
  const registry = createWorkspaceBridgeRegistry()
  registry.registerHandler(createTestBridgeOperationDefinition({
    op: "browser.v1.echo",
    callerClassesAllowed: ["browser"],
    requiredCapabilities: ["browser:echo"],
    idempotencyPolicy: "none",
  }), ({ input }) => input)
  registry.registerHandler(createTestBridgeOperationDefinition({
    op: "runtime.v1.echo",
    callerClassesAllowed: ["runtime"],
    requiredCapabilities: ["runtime:echo"],
    idempotencyPolicy: "none",
  }), ({ input }) => input)
  registry.registerHandler(createTestBridgeOperationDefinition({
    op: "runtime.v1.persist",
    callerClassesAllowed: ["runtime"],
    requiredCapabilities: ["runtime:persist"],
    idempotencyPolicy: "required",
  }), ({ input }) => ({ persisted: input }))

  const app = Fastify()
  await app.register(workspaceBridgeHttpRoutes, {
    registry,
    runtimeTokenSecret: SECRET,
    runtimeRefreshTokenSecret: REFRESH_SECRET,
    ownerWorkspaceId: "workspace-1",
    idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
    browserAuthPolicy: createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1" }),
      authorizeWorkspace: () => ({ allowed: true, capabilities: ["browser:echo"] }),
      allowedOrigins: ["https://app.example.test"],
      requireCsrfHeader: true,
    }),
    maxBodyBytes: 4096,
  })
  return app
}

describe("workspaceBridgeHttpRoutes", () => {
  it("handles browser-allowed calls and rejects browser runtime-only calls", async () => {
    const app = await makeApp()
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.test",
        "x-csrf-token": "csrf",
        "x-boring-workspace-id": "workspace-1",
      },
      payload: { op: "browser.v1.echo", input: { value: 1 }, requestId: "req-browser" },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers["cache-control"]).toBe("no-store")
    expect(ok.headers["access-control-allow-origin"]).toBeUndefined()
    expect(ok.json()).toMatchObject({ ok: true, output: { value: 1 } })

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", origin: "https://app.example.test", "x-csrf-token": "csrf" },
      payload: { op: "runtime.v1.echo", input: {} },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })
  })

  it("handles runtime scoped token calls and rejects browser-only ops", async () => {
    const app = await makeApp()
    const token = mintWorkspaceBridgeRuntimeToken({
      secret: SECRET,
      workspaceId: "workspace-1",
      capabilities: ["runtime:echo", "runtime:persist"],
      ttlMs: 60_000,
    })
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      payload: { op: "runtime.v1.echo", input: { value: 2 }, requestId: "req-runtime" },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ ok: true, output: { value: 2 } })

    const browserCapToken = mintWorkspaceBridgeRuntimeToken({
      secret: SECRET,
      workspaceId: "workspace-1",
      capabilities: ["browser:echo"],
      ttlMs: 60_000,
    })
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${browserCapToken}` },
      payload: { op: "browser.v1.echo", input: {} },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })
  })

  it("rejects runtime tokens scoped to another workspace", async () => {
    const app = await makeApp()
    const token = mintWorkspaceBridgeRuntimeToken({
      secret: SECRET,
      workspaceId: "workspace-2",
      capabilities: ["runtime:echo"],
      ttlMs: 60_000,
    })
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      payload: { op: "runtime.v1.echo", input: {} },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
  })

  it("re-mints scoped runtime tokens from sandbox refresh tokens", async () => {
    const app = await makeApp()
    const refreshToken = mintWorkspaceBridgeRuntimeRefreshToken({
      secret: REFRESH_SECRET,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runtimeId: "runtime-1",
      capabilities: ["runtime:echo"],
      ttlMs: 60_000,
      tokenTtlMs: 30_000,
    })
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/token",
      headers: { authorization: `Bearer ${refreshToken}` },
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    const body = response.json()
    expect(body).toMatchObject({ ok: true, token: expect.any(String) })
    const verified = verifyWorkspaceBridgeRuntimeToken(body.token, { secret: SECRET, requiredCapabilities: ["runtime:echo"] })
    const refreshClaims = verifyWorkspaceBridgeRuntimeRefreshToken(refreshToken, { secret: REFRESH_SECRET }).claims
    expect(verified.claims.exp).toBeLessThanOrEqual(refreshClaims.exp)
    expect(verified.authContext).toMatchObject({
      callerClass: "runtime",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      capabilities: ["runtime:echo"],
    })
  })

  it("rejects refresh tokens that expire while async refresh-store checks run", async () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z")
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs)
    try {
      const registry = createWorkspaceBridgeRegistry()
      const app = Fastify()
      await app.register(workspaceBridgeHttpRoutes, {
        registry,
        runtimeTokenSecret: SECRET,
        runtimeRefreshTokenSecret: REFRESH_SECRET,
        getRuntimeRefreshTokenStore: async () => ({
          revoke: async () => {},
          recordUse: async () => {
            dateNow.mockReturnValue(nowMs + 2_000)
            return { allowed: true as const }
          },
        }),
      })
      const refreshToken = mintWorkspaceBridgeRuntimeRefreshToken({
        secret: REFRESH_SECRET,
        workspaceId: "workspace-1",
        capabilities: [],
        nowMs,
        ttlMs: 1_000,
      })

      const response = await app.inject({ method: "POST", url: "/api/v1/workspace-bridge/token", headers: { authorization: `Bearer ${refreshToken}` }, payload: {} })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ExpiredToken } })
    } finally {
      dateNow.mockRestore()
    }
  })

  it("rate-limits and revokes runtime refresh tokens by jti", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const store = new InMemoryWorkspaceBridgeRuntimeRefreshTokenStore()
    const app = Fastify()
    await app.register(workspaceBridgeHttpRoutes, {
      registry,
      runtimeTokenSecret: SECRET,
      runtimeRefreshTokenSecret: REFRESH_SECRET,
      runtimeRefreshTokenStore: store,
      refreshTokenRateLimit: { maxUses: 1, windowMs: 60_000 },
    })
    const refreshToken = mintWorkspaceBridgeRuntimeRefreshToken({
      secret: REFRESH_SECRET,
      workspaceId: "workspace-1",
      capabilities: [],
      ttlMs: 60_000,
      jti: "refresh-jti-1",
    })

    const first = await app.inject({ method: "POST", url: "/api/v1/workspace-bridge/token", headers: { authorization: `Bearer ${refreshToken}` }, payload: {} })
    const second = await app.inject({ method: "POST", url: "/api/v1/workspace-bridge/token", headers: { authorization: `Bearer ${refreshToken}` }, payload: {} })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(429)
    expect(second.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.RateLimited } })

    store.revoke("refresh-jti-1")
    const revoked = await app.inject({ method: "POST", url: "/api/v1/workspace-bridge/token", headers: { authorization: `Bearer ${refreshToken}` }, payload: {} })
    expect(revoked.statusCode).toBe(401)
    expect(revoked.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidToken } })
  })

  it("rejects runtime tokens that try to select another workspace registry", async () => {
    const left = createWorkspaceBridgeRegistry({ ownerWorkspaceId: "workspace-left" })
    const right = createWorkspaceBridgeRegistry({ ownerWorkspaceId: "workspace-right" })
    for (const registry of [left, right]) {
      registry.registerHandler(createTestBridgeOperationDefinition({
        op: "runtime.v1.echo",
        callerClassesAllowed: ["runtime"],
        requiredCapabilities: ["runtime:echo"],
      }), ({ context }) => ({ workspaceId: context.workspaceId }))
    }
    const app = Fastify()
    await app.register(workspaceBridgeHttpRoutes, {
      getRegistry: (request) => request.headers["x-boring-workspace-id"] === "workspace-right" ? right : left,
      getOwnerWorkspaceId: (request) => String(request.headers["x-boring-workspace-id"] ?? "workspace-left"),
      runtimeTokenSecret: SECRET,
    })
    const token = mintWorkspaceBridgeRuntimeToken({
      secret: SECRET,
      workspaceId: "workspace-left",
      capabilities: ["runtime:echo"],
      ttlMs: 60_000,
    })

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-boring-workspace-id": "workspace-right" },
      payload: { op: "runtime.v1.echo", input: {} },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
  })

  it("rejects expired and missing-capability runtime tokens", async () => {
    const app = await makeApp()
    const expired = mintWorkspaceBridgeRuntimeToken({
      secret: SECRET,
      workspaceId: "workspace-1",
      capabilities: ["runtime:echo"],
      ttlMs: -1,
    })
    const expiredRes = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${expired}` },
      payload: { op: "runtime.v1.echo", input: {} },
    })
    expect(expiredRes.statusCode).toBe(401)
    expect(expiredRes.json()).toMatchObject({ error: { code: WorkspaceBridgeErrorCode.ExpiredToken } })

    const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: "workspace-1", capabilities: [] })
    const capRes = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      payload: { op: "runtime.v1.echo", input: {} },
    })
    expect(capRes.statusCode).toBe(403)
    expect(capRes.json()).toMatchObject({ error: { code: WorkspaceBridgeErrorCode.CapabilityDenied } })
  })

  it("covers content-type, CSRF/origin, idempotency, and redacted errors", async () => {
    const app = await makeApp()
    const badType = await app.inject({ method: "POST", url: "/api/v1/workspace-bridge/call", headers: { "content-type": "text/plain" }, payload: "x" })
    expect(badType.statusCode).toBe(415)

    const csrf = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", origin: "https://evil.example.test" },
      payload: { op: "browser.v1.echo", input: {} },
    })
    expect(csrf.statusCode).toBe(401)

    const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: "workspace-1", capabilities: ["runtime:persist"] })
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      payload: { op: "runtime.v1.persist", input: { a: 1 }, idempotencyKey: "idem" },
    })
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      payload: { op: "runtime.v1.persist", input: { a: 1 }, idempotencyKey: "idem" },
    })
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      payload: { op: "runtime.v1.persist", input: { a: 2 }, idempotencyKey: "idem" },
    })
    expect(first.json()).toMatchObject({ ok: true })
    expect(replay.json()).toMatchObject({ ok: true })
    expect(conflict.json()).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ReplayRejected } })
    assertNoSensitiveBridgeLeaks(JSON.stringify(conflict.json()), { tokens: [token], hostPaths: ["/home/ubuntu/private"] })
  })

  it("supports request-scoped registries for multi-workspace hosts", async () => {
    const left = createWorkspaceBridgeRegistry()
    left.registerHandler(createTestBridgeOperationDefinition({ op: "browser.v1.echo", callerClassesAllowed: ["browser"], requiredCapabilities: ["browser:echo"] }), () => ({ workspace: "left" }))
    const right = createWorkspaceBridgeRegistry()
    right.registerHandler(createTestBridgeOperationDefinition({ op: "browser.v1.echo", callerClassesAllowed: ["browser"], requiredCapabilities: ["browser:echo"] }), () => ({ workspace: "right" }))

    const app = Fastify()
    await app.register(workspaceBridgeHttpRoutes, {
      getRegistry: (request) => request.headers["x-boring-workspace-id"] === "right" ? right : left,
      browserAuthPolicy: createBrowserBridgeAuthPolicy({
        getPrincipal: () => ({ userId: "user-1" }),
        authorizeWorkspace: ({ definition }) => ({ allowed: true, capabilities: definition.requiredCapabilities }),
      }),
    })

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json", "x-boring-workspace-id": "right" },
      payload: { op: "browser.v1.echo", input: {} },
    })
    expect(response.json()).toMatchObject({ ok: true, output: { workspace: "right" } })
  })

  it("in-process registry calls do not require the HTTP route", async () => {
    const registry = createWorkspaceBridgeRegistry()
    registry.registerHandler(createTestBridgeOperationDefinition({ op: "example.v1.prompt.request" }), () => ({ questionId: "q1" }))
    await expect(registry.call({ op: "example.v1.prompt.request", input: {} }, {
      callerClass: "server",
      workspaceId: "workspace-1",
      capabilities: [],
      actor: { actorKind: "system", performedBy: { label: "test" } },
    })).resolves.toMatchObject({ ok: true, output: { questionId: "q1" } })
  })
})
