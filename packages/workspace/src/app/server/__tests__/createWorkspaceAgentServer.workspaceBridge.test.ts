// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => {
  const captureResolvedEnvironment = vi.fn(async (_options?: unknown) => undefined)
  return {
    captureResolvedEnvironment,
    createAgentHost: vi.fn(async (options: any) => ({
      host: { hostId: "test", describe: vi.fn(), drain: vi.fn(async () => {}), close: vi.fn(async () => {}) },
      gateway: {},
      registerDirectRoutes: vi.fn((projection: { authorizeAgentRequest(request: any): Promise<any> }) => async () => {
        const request = { id: "workspace-bridge-test", url: "/api/v1/agents/default/sessions", headers: {}, query: {} }
        const authorizedScope = await projection.authorizeAgentRequest(request)
        const verifiedClaim = await options.scopeVerifier.verify(authorizedScope)
        const environment = await options.resolveAuthorizedEnvironmentScope({
          authorizedScope,
          verifiedClaim,
          intent: { kind: "agent-binding", requestId: request.id },
        })
        await captureResolvedEnvironment(environment)
      }),
    })),
    provisionRuntimeWorkspace: vi.fn(async () => {}),
    provisionWorkspaceRuntime: vi.fn(async () => undefined),
  }
})

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentHost: agentServerMock.createAgentHost,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
    provisionWorkspaceRuntime: agentServerMock.provisionWorkspaceRuntime,
  }
})

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.captureResolvedEnvironment.mockClear()
  agentServerMock.createAgentHost.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  agentServerMock.provisionWorkspaceRuntime.mockClear()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function mockResolvedEnvironmentOnce(factory: (opts?: unknown) => Promise<unknown>): void {
  agentServerMock.captureResolvedEnvironment.mockImplementationOnce(factory as never)
}

async function capturedRuntimeEnv(): Promise<Record<string, string> | undefined> {
  const [environment] = agentServerMock.captureResolvedEnvironment.mock.calls.at(-1) as unknown as [{
    transformRuntimeBundle?: (bundle: any) => Promise<any> | any
  }]
  const bundle = await environment.transformRuntimeBundle?.({
    workspace: {},
    sandbox: { async exec() { return { stdout: "", stderr: "", exitCode: 0 } } },
  })
  return await bundle?.getRuntimeEnv?.()
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("createWorkspaceAgentServer — WorkspaceBridge RPC composition", () => {
  test("registers a demo handler and calls it through HTTP without shared singleton state", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const workspaceA = { root: await makeTempDir("bridge-compose-a-") }
    const workspaceB = { root: await makeTempDir("bridge-compose-b-") }
    const definition = createTestBridgeOperationDefinition<{ value: string }, { value: string }>({
      op: "test.v1.composed",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: ["test:composed"],
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const appA = await createWorkspaceAgentServer({
      workspaceRoot: workspaceA.root,
      provisionWorkspace: false,
      workspaceBridge: { allowInsecureLocalCliBrowserAuth: true, handlers: [{ definition, handler: ({ input }) => ({ value: `a:${(input as { value: string }).value}` }) }] },
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const appB = await createWorkspaceAgentServer({
      workspaceRoot: workspaceB.root,
      provisionWorkspace: false,
      workspaceBridge: { allowInsecureLocalCliBrowserAuth: true, handlers: [{ definition, handler: ({ input }) => ({ value: `b:${(input as { value: string }).value}` }) }] },
    })

    const callA = await appA.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "test.v1.composed", input: { value: "one" } },
    })
    const callB = await appB.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "test.v1.composed", input: { value: "one" } },
    })

    expect(callA.statusCode).toBe(200)
    expect(callB.statusCode).toBe(200)
    expect(callA.json()).toMatchObject({ ok: true, output: { value: "a:one" } })
    expect(callB.json()).toMatchObject({ ok: true, output: { value: "b:one" } })
    expect((appA as any).__boringWorkspaceBridgeRegistry).not.toBe((appB as any).__boringWorkspaceBridgeRegistry)

    await appA.close()
    await appB.close()
  })

  test("registers WorkspaceBridge handlers contributed by trusted server plugins", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const { defineServerPlugin } = await import("../../../server")
    const definition = createTestBridgeOperationDefinition<{ value: string }, { value: string }>({
      op: "plugin.v1.echo",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: ["plugin:echo"],
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-plugin-handler-"),
      provisionWorkspace: false,
      workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
      plugins: [defineServerPlugin({
        id: "trusted-plugin",
        workspaceBridgeHandlers: [{ definition, handler: ({ input }) => ({ value: `plugin:${(input as { value: string }).value}` }) }],
      })],
    })

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "plugin.v1.echo", input: { value: "one" } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, output: { value: "plugin:one" } })
    await app.close()
  })

  test("rejects workspaceBridgeHandlers from untrusted directory-source server plugins", async () => {
    const workspaceRoot = await makeTempDir("bridge-untrusted-dir-workspace-")
    const dir = await makeTempDir("bridge-untrusted-dir-plugin-")
    await mkdir(join(dir, "src"), { recursive: true })
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "untrusted-bridge-plugin",
      type: "module",
      boring: { server: "./src/server.js" },
    }), "utf8")
    await writeFile(join(dir, "src", "server.js"), `
export default {
  id: "untrusted-bridge-plugin",
  workspaceBridgeHandlers: [{
    definition: {
      op: "plugin.v1.untrusted",
      version: 1,
      owner: "untrusted-plugin",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: [],
      inputSchema: { type: "object" },
      timeoutMs: 1000,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      idempotencyPolicy: "none",
    },
    handler: () => ({ ok: true }),
  }],
}
`, "utf8")

    mockResolvedEnvironmentOnce(async () => Fastify())
    await expect(createWorkspaceAgentServer({
      workspaceRoot,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })).rejects.toThrow(/workspaceBridgeHandlers.*trust: "internal"/)
  })

  test.each(["direct", "local"] as const)("injects WorkspaceBridge runtime env for %s when configured", async (mode) => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const definition = createTestBridgeOperationDefinition({
      op: `test.v1.runtime-env.${mode}`,
      callerClassesAllowed: ["runtime"],
      requiredCapabilities: ["test:runtime-env"],
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir(`bridge-runtime-env-${mode}-`),
      mode,
      provisionWorkspace: false,
      workspaceBridge: {
        allowInsecureLocalCliBrowserAuth: true,
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeEnv: {
          bridgeUrl: "http://localhost:7777",
          allowInsecureHttp: true,
          capabilities: ["test:runtime-env"],
          sessionId: `session-${mode}`,
        },
        handlers: [{ definition, handler: () => ({ ok: true }) }],
      },
    })

    const env = await capturedRuntimeEnv()

    expect(env).toMatchObject({
      BORING_WORKSPACE_BRIDGE_URL: "http://localhost:7777/api/v1/workspace-bridge/call",
      BORING_WORKSPACE_ID: "default",
      BORING_AGENT_SESSION_ID: `session-${mode}`,
    })
    expect(env?.BORING_WORKSPACE_BRIDGE_TOKEN).toEqual(expect.any(String))
    expect(JSON.stringify({ tokenPresent: Boolean(env?.BORING_WORKSPACE_BRIDGE_TOKEN) })).not.toContain(env!.BORING_WORKSPACE_BRIDGE_TOKEN)
    await app.close()
  })



  test("injects WorkspaceBridge refresh token env when refresh secret is configured", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const definition = createTestBridgeOperationDefinition({
      op: "test.v1.runtime-env-refresh",
      callerClassesAllowed: ["runtime"],
      requiredCapabilities: ["test:runtime-env"],
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-refresh-"),
      mode: "direct",
      provisionWorkspace: false,
      workspaceBridge: {
        allowInsecureLocalCliBrowserAuth: true,
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeRefreshTokenSecret: "abcdefghijklmnopqrstuvwxyz1234567890",
        runtimeEnv: {
          bridgeUrl: "http://localhost:7777",
          allowInsecureHttp: true,
          capabilities: ["test:runtime-env"],
        },
        handlers: [{ definition, handler: () => ({ ok: true }) }],
      },
    })

    const env = await capturedRuntimeEnv()

    expect(env).toMatchObject({
      BORING_WORKSPACE_BRIDGE_URL: "http://localhost:7777/api/v1/workspace-bridge/call",
      BORING_WORKSPACE_BRIDGE_TOKEN_URL: "http://localhost:7777/api/v1/workspace-bridge/token",
      BORING_WORKSPACE_ID: "default",
    })
    expect(env?.BORING_WORKSPACE_BRIDGE_TOKEN).toEqual(expect.any(String))
    expect(env?.BORING_WORKSPACE_BRIDGE_REFRESH_TOKEN).toEqual(expect.any(String))
    await app.close()
  })

  test("fails closed for browser bridge calls unless browser auth or dev opt-in is explicit", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const definition = createTestBridgeOperationDefinition({
      op: "test.v1.browser-denied",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: [],
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-explicit-auth-"),
      provisionWorkspace: false,
      workspaceBridge: { handlers: [{ definition, handler: () => ({ ok: true }) }] },
    })

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "test.v1.browser-denied", input: {} },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ ok: false, error: { code: "BRIDGE_AUTH_REQUIRED" } })
    await app.close()
  })

  test("does not inject refresh tokens over plaintext non-loopback HTTP", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const definition = createTestBridgeOperationDefinition({
      op: "test.v1.runtime-env-refresh-http",
      callerClassesAllowed: ["runtime"],
      requiredCapabilities: ["test:runtime-env"],
    })
    mockResolvedEnvironmentOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-refresh-http-"),
      mode: "direct",
      provisionWorkspace: false,
      workspaceBridge: {
        allowInsecureLocalCliBrowserAuth: true,
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeRefreshTokenSecret: "abcdefghijklmnopqrstuvwxyz1234567890",
        runtimeEnv: {
          bridgeUrl: "http://example.test",
          allowInsecureHttp: true,
          capabilities: ["test:runtime-env"],
        },
        handlers: [{ definition, handler: () => ({ ok: true }) }],
      },
    })

    const env = await capturedRuntimeEnv()

    expect(env).toMatchObject({
      BORING_WORKSPACE_BRIDGE_URL: "http://example.test/api/v1/workspace-bridge/call",
      BORING_WORKSPACE_BRIDGE_TOKEN: expect.any(String),
    })
    expect(env?.BORING_WORKSPACE_BRIDGE_TOKEN_URL).toBeUndefined()
    expect(env?.BORING_WORKSPACE_BRIDGE_REFRESH_TOKEN).toBeUndefined()
    await app.close()
  })

  test("disables WorkspaceBridge runtime env when capabilities are omitted", async () => {
    mockResolvedEnvironmentOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-missing-caps-"),
      mode: "direct",
      provisionWorkspace: false,
      workspaceBridge: {
        allowInsecureLocalCliBrowserAuth: true,
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeEnv: {
          bridgeUrl: "http://localhost:7777",
          allowInsecureHttp: true,
        },
      },
    })

    const env = await capturedRuntimeEnv()

    expect(env).toEqual({ BORING_WORKSPACE_BRIDGE_DISABLED: "runtime-capabilities-missing" })
    await app.close()
  })

  test("disables WorkspaceBridge runtime env for remote-placement runtimes without public HTTPS URL", async () => {
    mockResolvedEnvironmentOnce(async () => Fastify())
    const getRuntimeLayoutRoot = vi.fn(() => "/custom-workspace")
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-remote-"),
      runtimeModeAdapter: {
        id: "custom-remote-runtime",
        getRuntimeLayoutRoot,
        workspaceFsCapability: "best-effort",
        async create() { throw new Error("not used by this composition test") },
      },
      provisionWorkspace: false,
      workspaceBridge: {
        allowInsecureLocalCliBrowserAuth: true,
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeEnv: { bridgeUrl: "http://localhost:7777", allowInsecureHttp: true, capabilities: ["test:runtime-env"] },
      },
    })

    const env = await capturedRuntimeEnv()

    expect(env).toEqual({ BORING_WORKSPACE_BRIDGE_DISABLED: "remote-bridge-url-must-be-https" })
    expect(getRuntimeLayoutRoot).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: expect.any(String),
      sessionId: "default",
      workspaceId: "default",
    }))
    expect(JSON.stringify(env)).not.toContain("12345678901234567890123456789012")
    await app.close()
  })

})
