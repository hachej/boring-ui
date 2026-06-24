import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import {
  WorkspaceBridgeClient,
  WorkspaceBridgeClientError,
  WorkspaceBridgeErrorCode,
} from "../../../bridge-client"
import type { WorkspaceBridgeOperationDefinition } from "../../../shared/workspace-bridge-rpc"
import { createBrowserBridgeAuthPolicy } from "../authPolicy"
import { InMemoryWorkspaceBridgeIdempotencyStore } from "../idempotency"
import { createWorkspaceBridgeRegistry } from "../registry"
import { createWorkspaceBridgeRuntimeEnvContribution } from "../runtimeEnv"
import { mintWorkspaceBridgeRuntimeToken } from "../runtimeToken"
import { workspaceBridgeHttpRoutes } from "../httpRoutes"

/**
 * Realistic end-to-end scenario: a DOWNSTREAM app ships a domain SDK on top of
 * WorkspaceBridge. The host registers a domain op with a real schema + scoped
 * capability + idempotency; a sandboxed runtime imports the published
 * WorkspaceBridgeClient, wraps it in a thin domain SDK, and reads its bridge
 * URL/token from the env the host injected. This is the "custom SDK" story the
 * bridge exists for — exercised over the real registry, auth, schema validator,
 * idempotency store, and HTTP transport (no mocks beyond app.inject as fetch).
 */

const CALL_SECRET = "workspace-bridge-runtime-token-secret-32bytes"
const REFRESH_SECRET = "workspace-bridge-runtime-refresh-secret-32bytes"
const WORKSPACE = "workspace-acme"
const CAPABILITY = "example:outputs.write"

interface ExampleOutput {
  id: string
  title: string
  content: string
}

// The host-owned domain operation a downstream product would register.
const OUTPUTS_WRITE: WorkspaceBridgeOperationDefinition = {
  op: "example.v1.outputs.write",
  version: 1,
  owner: "example-app",
  callerClassesAllowed: ["runtime"],
  requiredCapabilities: [CAPABILITY],
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
    },
    required: ["id", "title", "content"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { id: { type: "string" }, revision: { type: "integer" } },
    required: ["id", "revision"],
  },
  timeoutMs: 2_000,
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 4 * 1024,
  idempotencyPolicy: "required",
}

// The thin "dummy SDK" a downstream integrator ships around WorkspaceBridgeClient.
class ExampleOutputsClient {
  private constructor(private readonly bridge: WorkspaceBridgeClient) {}

  static fromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch): ExampleOutputsClient {
    return new ExampleOutputsClient(WorkspaceBridgeClient.fromEnv(env, { fetch: fetchImpl }))
  }

  writeOutput(output: ExampleOutput): Promise<{ id: string; revision: number }> {
    return this.bridge.call("example.v1.outputs.write", output, {
      idempotencyKey: `example-outputs-write:${output.id}`,
    })
  }
}

interface Harness {
  env: Record<string, string>
  fetch: typeof fetch
  store: Map<string, ExampleOutput & { revision: number }>
  writeCalls: () => number
  close: () => Promise<void>
}

async function setupHarness(): Promise<Harness> {
  const store = new Map<string, ExampleOutput & { revision: number }>()
  let revision = 0
  let writeCalls = 0

  const registry = createWorkspaceBridgeRegistry({ ownerWorkspaceId: WORKSPACE })
  registry.registerHandler<ExampleOutput, { id: string; revision: number }>(
    OUTPUTS_WRITE as WorkspaceBridgeOperationDefinition<ExampleOutput, { id: string; revision: number }>,
    ({ input }) => {
      writeCalls += 1
      revision += 1
      store.set(input.id, { ...input, revision })
      return { id: input.id, revision }
    },
  )

  const app = Fastify()
  await app.register(workspaceBridgeHttpRoutes, {
    registry,
    runtimeTokenSecret: CALL_SECRET,
    runtimeRefreshTokenSecret: REFRESH_SECRET,
    ownerWorkspaceId: WORKSPACE,
    idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
    browserAuthPolicy: createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1" }),
      authorizeWorkspace: () => ({ allowed: true, capabilities: [CAPABILITY] }),
    }),
  })
  await app.ready()

  // Host injects the runtime env into the sandbox exactly as production does.
  const contribution = createWorkspaceBridgeRuntimeEnvContribution({
    workspaceId: WORKSPACE,
    runtimeMode: "local",
    registry,
    runtimeTokenSecret: CALL_SECRET,
    runtimeRefreshTokenSecret: REFRESH_SECRET,
    runtimeEnv: { bridgeUrl: "http://127.0.0.1/", capabilities: [CAPABILITY] },
  })
  if (!contribution) throw new Error("expected a runtime env contribution")
  const env = await contribution.getEnv({
    workspaceId: WORKSPACE,
    workspaceRoot: "/tmp/workspace-acme",
    runtimeMode: "local",
    runtimeBundle: {} as never,
  }) as Record<string, string>

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString())
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

  return { env, fetch: fetchImpl, store, writeCalls: () => writeCalls, close: () => app.close() }
}

describe("downstream domain SDK over WorkspaceBridge (fromEnv)", () => {
  it("writes a domain output end-to-end through a runtime-injected SDK", async () => {
    const h = await setupHarness()
    try {
      const sdk = ExampleOutputsClient.fromEnv(h.env, h.fetch)

      const result = await sdk.writeOutput({ id: "out-1", title: "Quarterly summary", content: "hello" })

      expect(result).toEqual({ id: "out-1", revision: 1 })
      expect(h.store.get("out-1")).toMatchObject({ title: "Quarterly summary", content: "hello", revision: 1 })
    } finally {
      await h.close()
    }
  })

  it("replays the cached result for a repeated idempotency key (handler runs once)", async () => {
    const h = await setupHarness()
    try {
      const sdk = ExampleOutputsClient.fromEnv(h.env, h.fetch)

      const first = await sdk.writeOutput({ id: "out-7", title: "T", content: "v1" })
      const second = await sdk.writeOutput({ id: "out-7", title: "T", content: "v1" })

      expect(second).toEqual(first)
      expect(h.writeCalls()).toBe(1)
    } finally {
      await h.close()
    }
  })

  it("surfaces a stable CapabilityDenied error when the runtime token lacks the op capability", async () => {
    const h = await setupHarness()
    try {
      // A runtime whose injected token was scoped without the write capability.
      const underScopedEnv = {
        ...h.env,
        BORING_WORKSPACE_BRIDGE_TOKEN: mintWorkspaceBridgeRuntimeToken({
          secret: CALL_SECRET,
          workspaceId: WORKSPACE,
          capabilities: [],
          runtimeId: "local",
        }),
      }
      const sdk = ExampleOutputsClient.fromEnv(underScopedEnv, h.fetch)

      await expect(sdk.writeOutput({ id: "out-9", title: "T", content: "c" }))
        .rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.CapabilityDenied, status: 403 })
      expect(h.store.has("out-9")).toBe(false)
    } finally {
      await h.close()
    }
  })

  it("surfaces a stable SchemaInvalid error for input that violates the op schema", async () => {
    const h = await setupHarness()
    try {
      const sdk = ExampleOutputsClient.fromEnv(h.env, h.fetch)

      // Missing required `content` — rejected by the registry schema validator
      // before the handler runs.
      const promise = sdk.writeOutput({ id: "out-bad", title: "T" } as ExampleOutput)

      await expect(promise).rejects.toBeInstanceOf(WorkspaceBridgeClientError)
      await expect(promise).rejects.toMatchObject({ code: WorkspaceBridgeErrorCode.SchemaInvalid })
      expect(h.writeCalls()).toBe(0)
    } finally {
      await h.close()
    }
  })
})
