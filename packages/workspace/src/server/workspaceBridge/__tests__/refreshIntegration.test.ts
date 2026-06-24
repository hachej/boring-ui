import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { WorkspaceBridgeClient } from "../../../bridge-client"
import { WORKSPACE_BRIDGE_TOKEN_ENV } from "../../../shared/workspace-bridge-rpc"
import { createBrowserBridgeAuthPolicy } from "../authPolicy"
import { InMemoryWorkspaceBridgeIdempotencyStore } from "../idempotency"
import { createWorkspaceBridgeRegistry } from "../registry"
import { createWorkspaceBridgeRuntimeEnvContribution } from "../runtimeEnv"
import { mintWorkspaceBridgeRuntimeToken } from "../runtimeToken"
import { workspaceBridgeHttpRoutes } from "../httpRoutes"
import { createTestBridgeOperationDefinition } from "../testing/harness"

const SECRET = "workspace-bridge-runtime-token-secret-32bytes"
const REFRESH_SECRET = "workspace-bridge-runtime-refresh-secret-32bytes"

// Closes the producer->consumer seam: runtimeEnv injection (server) -> fromEnv
// (SDK) -> auto-refresh-on-401 against the live /token route. The pieces are
// each unit-tested with mocked fetch elsewhere; this locks them together.
describe("WorkspaceBridgeClient.fromEnv auto-refresh against the live bridge routes", () => {
  it("refreshes an expired call token via the runtimeEnv-injected refresh token and retries the call", async () => {
    const registry = createWorkspaceBridgeRegistry({ ownerWorkspaceId: "workspace-1" })
    registry.registerHandler(createTestBridgeOperationDefinition({
      op: "runtime.v1.echo",
      callerClassesAllowed: ["runtime"],
      requiredCapabilities: ["runtime:echo"],
      idempotencyPolicy: "none",
    }), ({ input }) => input)

    const app = Fastify()
    await app.register(workspaceBridgeHttpRoutes, {
      registry,
      runtimeTokenSecret: SECRET,
      runtimeRefreshTokenSecret: REFRESH_SECRET,
      ownerWorkspaceId: "workspace-1",
      idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
      browserAuthPolicy: createBrowserBridgeAuthPolicy({
        getPrincipal: () => ({ userId: "user-1" }),
        authorizeWorkspace: () => ({ allowed: true, capabilities: ["runtime:echo"] }),
      }),
    })
    await app.ready()

    // Producer: build the runtime env exactly as the host injects it into a sandbox.
    // A loopback http URL keeps the refresh token injectable (isRefreshTokenUrlSafe).
    const contribution = createWorkspaceBridgeRuntimeEnvContribution({
      workspaceId: "workspace-1",
      runtimeMode: "local",
      registry,
      runtimeTokenSecret: SECRET,
      runtimeRefreshTokenSecret: REFRESH_SECRET,
      runtimeEnv: { bridgeUrl: "http://127.0.0.1/", capabilities: ["runtime:echo"] },
    })
    expect(contribution).toBeTruthy()
    const env = await contribution!.getEnv({
      workspaceId: "workspace-1",
      workspaceRoot: "/tmp/workspace-1",
      runtimeMode: "local",
      runtimeBundle: {} as never,
    }) as Record<string, string>
    expect(env.BORING_WORKSPACE_BRIDGE_TOKEN_URL).toContain("/api/v1/workspace-bridge/token")
    expect(env.BORING_WORKSPACE_BRIDGE_REFRESH_TOKEN).toBeTruthy()

    // Force the first /call to 401 so the client MUST exercise the refresh path.
    env[WORKSPACE_BRIDGE_TOKEN_ENV] = mintWorkspaceBridgeRuntimeToken({
      secret: SECRET,
      workspaceId: "workspace-1",
      capabilities: ["runtime:echo"],
      ttlMs: 1_000,
      nowMs: Date.now() - 60_000,
    })

    let tokenRoundTrips = 0
    const injectFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      if (url.pathname.endsWith("/workspace-bridge/token")) tokenRoundTrips += 1
      const res = await app.inject({
        method: (init?.method ?? "GET") as "GET" | "POST",
        url: url.pathname + url.search,
        headers: init?.headers as Record<string, string>,
        payload: init?.body as string,
      })
      return {
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        statusText: "",
        json: async () => res.json(),
      } as unknown as Response
    }) as unknown as typeof fetch

    const client = WorkspaceBridgeClient.fromEnv(env, { fetch: injectFetch })
    const result = await client.call<{ value: number }>("runtime.v1.echo", { value: 7 })

    expect(result).toMatchObject({ value: 7 })
    expect(tokenRoundTrips).toBe(1)

    await app.close()
  })
})
